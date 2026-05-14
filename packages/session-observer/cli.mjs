#!/usr/bin/env node
// session-observer — read-only PoC.
// Reads Claude Code transcripts under ~/.claude/projects/<encoded-cwd>/<uuid>.jsonl
// and produces human-readable summaries of "what each agent did, in general".
//
// Commands:
//   list                          most recent sessions across all projects
//   show <uuid-prefix>            full timeline of a single session
//   summary <uuid-prefix>         one-screen summary of a single session
//   agents [--since=DAYS]         subagent invocations across all sessions

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { parseArgs } from 'node:util';

const PROJECTS_DIR = join(homedir(), '.claude/projects');

// ---------- helpers ----------

// The Claude Code encoding (`/` → `-`) is ambiguous to decode (real `-` in path names
// collide with the separator). So we prefer reading the real cwd from the first event
// in the file. We only fall back to a best-effort string when reading fails.
const fallbackProjectName = (name) =>
  name.startsWith('-') ? '/' + name.slice(1).replace(/-/g, '/') : name;

function readCwdFromSession(filepath) {
  try {
    const text = readFileSync(filepath, 'utf8');
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line);
        if (e.cwd) return e.cwd;
      } catch {
        // skip
      }
      // Don't scan the whole file just to find cwd.
      // The cwd is always in one of the first few events.
      break;
    }
    // If first line had no cwd, scan a few more lines.
    let i = 0;
    for (const line of text.split('\n')) {
      if (++i > 20) break;
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line);
        if (e.cwd) return e.cwd;
      } catch {
        // skip
      }
    }
  } catch {
    // file unreadable
  }
  return null;
}

const pad = (s, n) => String(s).padEnd(n).slice(0, n);

const truncate = (s, n) => (s.length <= n ? s : s.slice(0, n - 1) + '…');

const fmtDuration = (ms) => {
  if (!ms || ms < 0) return '—';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
};

const fmtTokens = (n) => {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return (n / 1000).toFixed(1) + 'K';
  return (n / 1_000_000).toFixed(2) + 'M';
};

// Rough cost estimate using Anthropic public list prices.
// Opus 4.x: $15/MTok input, $75/MTok output, $1.50/MTok cache read, $18.75/MTok cache write
// Sonnet 4.x: $3/MTok input, $15/MTok output, $0.30/MTok cache read, $3.75/MTok cache write
// We default to Opus pricing for opus models, Sonnet for everything else.
const estimateCostUSD = (model, t) => {
  const isOpus = model && model.includes('opus');
  const px = isOpus
    ? { in: 15, out: 75, cr: 1.5, cw: 18.75 }
    : { in: 3, out: 15, cr: 0.3, cw: 3.75 };
  return (
    (t.input * px.in + t.output * px.out + t.cacheRead * px.cr + t.cacheCreate * px.cw) /
    1_000_000
  );
};

// ---------- session reader ----------

function* readSessionLines(filepath) {
  const text = readFileSync(filepath, 'utf8');
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      yield JSON.parse(line);
    } catch {
      // skip malformed lines
    }
  }
}

function summarizeSession(filepath) {
  let firstTs = null;
  let lastTs = null;
  const userPrompts = [];
  let assistantTurns = 0;
  const toolCounts = new Map();
  const subagents = [];
  const skills = new Set();
  const plugins = new Set();
  let model = null;
  let gitBranch = null;
  let cwd = null;
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 };
  const filesEdited = new Set();
  const filesRead = new Set();
  const filesWritten = new Set();
  const bashCmds = [];
  let aiTitle = null;
  let permissionMode = null;
  let entrypoint = null;

  for (const e of readSessionLines(filepath)) {
    if (e.timestamp) {
      if (!firstTs || e.timestamp < firstTs) firstTs = e.timestamp;
      if (!lastTs || e.timestamp > lastTs) lastTs = e.timestamp;
    }
    if (e.cwd && !cwd) cwd = e.cwd;
    if (e.gitBranch && !gitBranch) gitBranch = e.gitBranch;
    if (e.entrypoint && !entrypoint) entrypoint = e.entrypoint;
    if (e.attributionSkill) skills.add(e.attributionSkill);
    if (e.attributionPlugin) plugins.add(e.attributionPlugin);
    if (e.type === 'ai-title' && e.aiTitle) aiTitle = e.aiTitle;
    if (e.type === 'permission-mode' && e.permissionMode) permissionMode = e.permissionMode;

    if (e.type === 'user' && e.message?.content && typeof e.message.content === 'string') {
      const c = e.message.content;
      if (!c.startsWith('<command-') && !c.startsWith('<local-command-')) {
        userPrompts.push({ ts: e.timestamp, text: c });
      }
    }

    if (e.type === 'assistant' && e.message?.content) {
      assistantTurns++;
      if (e.message.model) model = e.message.model;
      const u = e.message.usage;
      if (u) {
        tokens.input += u.input_tokens ?? 0;
        tokens.output += u.output_tokens ?? 0;
        tokens.cacheRead += u.cache_read_input_tokens ?? 0;
        tokens.cacheCreate += u.cache_creation_input_tokens ?? 0;
      }
      for (const block of e.message.content) {
        if (block.type !== 'tool_use') continue;
        const name = block.name;
        toolCounts.set(name, (toolCounts.get(name) ?? 0) + 1);

        if (name === 'Agent') {
          subagents.push({
            ts: e.timestamp,
            type: block.input?.subagent_type ?? 'general-purpose',
            desc: block.input?.description ?? '',
          });
        } else if (name === 'Edit' || name === 'MultiEdit') {
          if (block.input?.file_path) filesEdited.add(block.input.file_path);
        } else if (name === 'Write') {
          if (block.input?.file_path) filesWritten.add(block.input.file_path);
        } else if (name === 'Read') {
          if (block.input?.file_path) filesRead.add(block.input.file_path);
        } else if (name === 'Bash') {
          bashCmds.push({
            ts: e.timestamp,
            cmd: block.input?.command ?? '',
            desc: block.input?.description ?? '',
          });
        }
      }
    }
  }

  return {
    sid: basename(filepath, '.jsonl'),
    file: filepath,
    cwd,
    gitBranch,
    entrypoint,
    firstTs,
    lastTs,
    durationMs: firstTs && lastTs ? new Date(lastTs).getTime() - new Date(firstTs).getTime() : 0,
    model,
    permissionMode,
    aiTitle,
    userPrompts,
    assistantTurns,
    toolCounts,
    subagents,
    skills: [...skills],
    plugins: [...plugins],
    tokens,
    filesEdited: [...filesEdited],
    filesWritten: [...filesWritten],
    filesRead: [...filesRead],
    bashCmds,
  };
}

// ---------- find / enumerate ----------

function enumerateSessions({ project, sinceDays } = {}) {
  let projDirs;
  try {
    projDirs = readdirSync(PROJECTS_DIR);
  } catch {
    return [];
  }
  const cutoff = sinceDays ? Date.now() - sinceDays * 86400000 : 0;
  const rows = [];
  for (const p of projDirs) {
    if (project && !p.toLowerCase().includes(project.toLowerCase())) continue;
    let files;
    try {
      files = readdirSync(join(PROJECTS_DIR, p));
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const full = join(PROJECTS_DIR, p, f);
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      if (cutoff && stat.mtime.getTime() < cutoff) continue;
      const realCwd = readCwdFromSession(full) ?? fallbackProjectName(p);
      rows.push({
        sid: basename(f, '.jsonl'),
        projectDir: realCwd,
        mtime: stat.mtime,
        sizeBytes: stat.size,
        path: full,
      });
    }
  }
  rows.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  return rows;
}

function findSessionByPrefix(prefix) {
  const all = enumerateSessions();
  return all.find((s) => s.sid.startsWith(prefix)) ?? null;
}

// ---------- commands ----------

function cmdList({ project, sinceDays, limit }) {
  const rows = enumerateSessions({ project, sinceDays });
  if (rows.length === 0) {
    console.log('No sessions found.');
    return;
  }
  console.log(
    pad('SESSION', 10) +
      pad('PROJECT', 50) +
      pad('WHEN', 18) +
      pad('SIZE', 8),
  );
  console.log('─'.repeat(86));
  const shown = rows.slice(0, limit);
  for (const r of shown) {
    const when = r.mtime.toISOString().replace('T', ' ').slice(0, 16);
    const sizeKB = Math.round(r.sizeBytes / 1024) + 'K';
    console.log(
      pad(r.sid.slice(0, 8), 10) +
        pad(r.projectDir, 50) +
        pad(when, 18) +
        pad(sizeKB.padStart(6), 8),
    );
  }
  if (rows.length > shown.length) {
    console.log(`\n…and ${rows.length - shown.length} more (use --limit=N to see more)`);
  }
}

function cmdSummary(idPrefix) {
  const found = findSessionByPrefix(idPrefix);
  if (!found) {
    console.error(`No session matches "${idPrefix}"`);
    process.exit(1);
  }
  const s = summarizeSession(found.path);
  const cost = estimateCostUSD(s.model, s.tokens);
  const start = s.firstTs ? new Date(s.firstTs).toISOString().replace('T', ' ').slice(0, 19) : '?';
  const end = s.lastTs ? new Date(s.lastTs).toISOString().replace('T', ' ').slice(0, 16) : '?';

  const line = (k, v) => console.log(`  ${pad(k, 12)} ${v}`);

  console.log(`\n📋 Session ${s.sid.slice(0, 8)}  ${s.aiTitle ? `— ${s.aiTitle}` : ''}`);
  console.log('─'.repeat(72));
  line('When:', `${start} → ${end}  (${fmtDuration(s.durationMs)})`);
  line('Project:', s.cwd ?? '(unknown)');
  if (s.gitBranch) line('Branch:', s.gitBranch);
  if (s.model) line('Model:', s.model);
  if (s.entrypoint) line('Entry:', s.entrypoint);
  if (s.permissionMode) line('Perm mode:', s.permissionMode);
  if (s.plugins.length) line('Plugins:', s.plugins.join(', '));
  if (s.skills.length) line('Skills:', s.skills.join(', '));

  console.log(`\n📊 Activity`);
  console.log('─'.repeat(72));
  line('Prompts:', `${s.userPrompts.length} user`);
  line('Turns:', `${s.assistantTurns} assistant`);
  const totalTools = [...s.toolCounts.values()].reduce((a, b) => a + b, 0);
  const toolBreakdown =
    [...s.toolCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([n, c]) => `${n}×${c}`)
      .join('  ') || '(none)';
  line('Tool calls:', `${totalTools}    ${toolBreakdown}`);

  console.log(`\n💰 Tokens`);
  console.log('─'.repeat(72));
  line('Input:', fmtTokens(s.tokens.input));
  line('Output:', fmtTokens(s.tokens.output));
  line('Cache read:', fmtTokens(s.tokens.cacheRead));
  line('Cache write:', fmtTokens(s.tokens.cacheCreate));
  line('≈ Cost:', `$${cost.toFixed(2)} USD (rough estimate)`);

  if (s.subagents.length > 0) {
    console.log(`\n🤖 Sub-agents invoked (${s.subagents.length})`);
    console.log('─'.repeat(72));
    const byType = new Map();
    for (const a of s.subagents) {
      if (!byType.has(a.type)) byType.set(a.type, []);
      byType.get(a.type).push(a);
    }
    for (const [type, calls] of [...byType.entries()].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`  ${type} (${calls.length}×)`);
      for (const c of calls.slice(0, 3)) {
        const t = c.ts ? new Date(c.ts).toISOString().slice(11, 16) : '?';
        console.log(`    [${t}]  ${truncate(c.desc, 60)}`);
      }
      if (calls.length > 3) console.log(`    … and ${calls.length - 3} more`);
    }
  }

  if (s.userPrompts.length > 0) {
    console.log(`\n💬 User prompts (showing ${Math.min(s.userPrompts.length, 8)} of ${s.userPrompts.length})`);
    console.log('─'.repeat(72));
    for (const p of s.userPrompts.slice(0, 8)) {
      const t = p.ts ? new Date(p.ts).toISOString().slice(11, 16) : '?';
      console.log(`  [${t}]  ${truncate(p.text.replace(/\s+/g, ' '), 64)}`);
    }
  }

  if (s.filesEdited.length || s.filesWritten.length) {
    console.log(`\n📝 Files modified`);
    console.log('─'.repeat(72));
    for (const f of s.filesWritten) console.log(`  +  ${f}`);
    for (const f of s.filesEdited) console.log(`  ~  ${f}`);
  }

  if (s.bashCmds.length > 0) {
    const byDesc = new Map();
    for (const b of s.bashCmds) {
      const k = b.desc || b.cmd.split(/\s+/)[0];
      byDesc.set(k, (byDesc.get(k) ?? 0) + 1);
    }
    const top = [...byDesc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    console.log(`\n⚙️  Bash patterns (${s.bashCmds.length} total)`);
    console.log('─'.repeat(72));
    for (const [k, c] of top) console.log(`  ${pad(String(c) + '×', 5)} ${truncate(k, 64)}`);
  }

  console.log();
}

function cmdShow(idPrefix) {
  const found = findSessionByPrefix(idPrefix);
  if (!found) {
    console.error(`No session matches "${idPrefix}"`);
    process.exit(1);
  }
  console.log(`Timeline for ${found.sid.slice(0, 8)} (${found.projectDir})`);
  console.log('─'.repeat(72));
  for (const e of readSessionLines(found.path)) {
    const t = e.timestamp ? new Date(e.timestamp).toISOString().slice(11, 19) : '         ';
    if (e.type === 'user' && typeof e.message?.content === 'string') {
      const c = e.message.content;
      if (c.startsWith('<command-') || c.startsWith('<local-command-')) {
        const m = c.match(/<command-name>([^<]+)</);
        console.log(`[${t}] CMD     ${m ? m[1] : '(meta)'}`);
      } else {
        console.log(`[${t}] USER    ${truncate(c.replace(/\s+/g, ' '), 60)}`);
      }
    } else if (e.type === 'user' && Array.isArray(e.message?.content)) {
      for (const b of e.message.content) {
        if (b.type === 'tool_result') {
          const len =
            typeof b.content === 'string'
              ? b.content.length
              : Array.isArray(b.content)
                ? JSON.stringify(b.content).length
                : 0;
          console.log(`[${t}] RESULT  ${b.is_error ? '❌' : '✓ '} ${len}B`);
        }
      }
    } else if (e.type === 'assistant' && Array.isArray(e.message?.content)) {
      for (const b of e.message.content) {
        if (b.type === 'thinking') {
          console.log(`[${t}] THINK   ${truncate((b.thinking ?? '').replace(/\s+/g, ' '), 60)}`);
        } else if (b.type === 'text') {
          console.log(`[${t}] TEXT    ${truncate((b.text ?? '').replace(/\s+/g, ' '), 60)}`);
        } else if (b.type === 'tool_use') {
          let info = '';
          if (b.name === 'Bash') info = b.input?.description || b.input?.command?.slice(0, 60) || '';
          else if (b.name === 'Read' || b.name === 'Edit' || b.name === 'Write')
            info = b.input?.file_path ?? '';
          else if (b.name === 'Agent')
            info = `[${b.input?.subagent_type ?? '?'}] ${b.input?.description ?? ''}`;
          else info = JSON.stringify(b.input).slice(0, 60);
          console.log(`[${t}] TOOL    ${pad(b.name, 10)} ${truncate(info, 50)}`);
        }
      }
    }
  }
}

function cmdAgents({ sinceDays }) {
  const sessions = enumerateSessions({ sinceDays });
  const byType = new Map();
  for (const sess of sessions) {
    const s = summarizeSession(sess.path);
    for (const a of s.subagents) {
      if (!byType.has(a.type)) byType.set(a.type, []);
      byType.get(a.type).push({ ...a, project: sess.projectDir, sid: sess.sid });
    }
  }
  const sorted = [...byType.entries()].sort((a, b) => b[1].length - a[1].length);
  if (sorted.length === 0) {
    console.log(
      `No subagent invocations found${sinceDays ? ` in the last ${sinceDays} day(s)` : ''}.`,
    );
    return;
  }
  console.log(`Subagent invocations${sinceDays ? ` (last ${sinceDays} days)` : ''}\n`);
  for (const [type, calls] of sorted) {
    console.log(`▸ ${type}  —  ${calls.length} invocation${calls.length === 1 ? '' : 's'}`);
    for (const c of calls.slice(0, 5)) {
      const t = c.ts ? new Date(c.ts).toISOString().slice(0, 16).replace('T', ' ') : '?';
      const proj = basename(c.project);
      console.log(`    [${t}] ${pad(proj, 24)} ${truncate(c.desc, 50)}`);
    }
    if (calls.length > 5) console.log(`    … and ${calls.length - 5} more`);
    console.log();
  }
}

// ---------- main ----------

function usage() {
  console.log(`session-observer — read-only PoC for Claude Code transcripts

Usage:
  node cli.mjs list      [--project=NAME] [--since=DAYS] [--limit=N]
  node cli.mjs summary   <session-uuid-prefix>
  node cli.mjs show      <session-uuid-prefix>
  node cli.mjs agents    [--since=DAYS]

Examples:
  node cli.mjs list --since=7 --limit=10
  node cli.mjs list --project=legal-advisor
  node cli.mjs summary 3badeb29
  node cli.mjs agents --since=30
`);
}

const { values, positionals } = parseArgs({
  options: {
    project: { type: 'string' },
    since: { type: 'string' },
    limit: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
  allowPositionals: true,
  strict: false,
});

if (values.help || positionals.length === 0) {
  usage();
  process.exit(0);
}

const opts = {
  project: values.project,
  sinceDays: values.since ? Number(values.since) : undefined,
  limit: values.limit ? Number(values.limit) : 20,
};

const [cmd, arg] = positionals;
try {
  switch (cmd) {
    case 'list':
      cmdList(opts);
      break;
    case 'summary':
      if (!arg) {
        console.error('Missing session id prefix.');
        process.exit(1);
      }
      cmdSummary(arg);
      break;
    case 'show':
      if (!arg) {
        console.error('Missing session id prefix.');
        process.exit(1);
      }
      cmdShow(arg);
      break;
    case 'agents':
      cmdAgents(opts);
      break;
    default:
      usage();
      process.exit(1);
  }
} catch (err) {
  console.error('Error:', err.message);
  process.exit(1);
}

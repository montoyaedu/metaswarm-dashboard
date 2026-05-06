// `metaswarm-dashboard collect` — orchestrates beads-reader + metrics +
// writer for one or all configured projects (per plan WU-3).

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join as pathJoin } from 'node:path';

import {
  type DailySnapshot,
  type WeeklySnapshot,
} from '@metaswarm-dashboard/types/snapshots';

import { type BeadsExecutor, readHostBeads } from '../beads-reader.js';
import { type Config, loadConfig, type ProjectEntry } from '../config.js';
import {
  computeMetrics,
  isUtcMonday,
  isoWeekKey,
  previousIsoWeekKey,
  utcDayKey,
} from '../metrics.js';
import { configFile, dataDir, defaultEnv, type PathsEnv } from '../paths.js';
import {
  type WriterFsHooks,
  atomicWriteJson,
  dailySnapshotPath,
  weeklySnapshotPath,
} from '../writer.js';

/**
 * Returns true when at least one `YYYY-MM-DD.json` daily snapshot file
 * exists under `<dataDir>/projects/<name>/daily/` whose ISO-week matches
 * `priorWeek`. Used to set `WeeklySnapshot.complete` (per WU-3.10).
 */
function priorWeekHasAnyDailySnapshot(
  dataDirPath: string,
  projectName: string,
  priorWeek: string,
): boolean {
  const dailyDir = pathJoin(dataDirPath, 'projects', projectName, 'daily');
  if (!existsSync(dailyDir)) return false;
  let entries: string[];
  /* v8 ignore start — readdir failure on a path we just confirmed exists is rare; fallback prevents crash. */
  try {
    entries = readdirSync(dailyDir);
  } catch {
    return false;
  }
  /* v8 ignore stop */
  for (const name of entries) {
    const m = /^(\d{4}-\d{2}-\d{2})\.json$/.exec(name);
    if (!m) continue;
    const dayKeyStr = m[1]!;
    const day = new Date(`${dayKeyStr}T00:00:00Z`);
    if (isoWeekKey(day) === priorWeek) return true;
  }
  return false;
}

export const HELP_DESCRIPTION =
  'Read .beads/ from configured projects and write per-project snapshots';

export const HELP_EXAMPLES = [
  'metaswarm-dashboard collect --all',
  'metaswarm-dashboard collect --project foo',
];

export function buildCollectHelpText(): string {
  return [
    `Description: ${HELP_DESCRIPTION}`,
    '',
    'Options:',
    '  --project <name>   collect a single project from config.yaml',
    '  --all              collect every project in config.yaml',
    '',
    'Examples:',
    ...HELP_EXAMPLES.map((e) => `  ${e}`),
  ].join('\n');
}

export interface RunCollectOptions {
  project?: string;
  all?: boolean;
  /** Inject `now` for fake-timer tests. */
  now?: Date;
  env?: PathsEnv;
  /** Inject the bd executor (used in tests). */
  execute?: BeadsExecutor;
  /** Inject fs hooks (used in tests). */
  writerFs?: WriterFsHooks;
  readerFs?: { existsSync: typeof existsSync; readFileSync: typeof readFileSync };
  /** Inject the config loader (used in tests). */
  loadConfigImpl?: typeof loadConfig;
  /** stdout/stderr writers (test injection). */
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
}

export interface RunCollectResult {
  exitCode: number;
  projectsProcessed: string[];
  projectsSkipped: { name: string; reason: string }[];
  warnings: string[];
}

/**
 * Run the collect subcommand. Returns a structured result and writes
 * one summary line per project to stdout. Exit code is 0 even when
 * individual projects are skipped (per plan WU-3.{5,6,7}).
 */
export async function runCollect(opts: RunCollectOptions = {}): Promise<RunCollectResult> {
  const env = opts.env ?? defaultEnv();
  const stdout = opts.stdout ?? ((line: string) => process.stdout.write(`${line}\n`));
  const stderr = opts.stderr ?? ((line: string) => process.stderr.write(`${line}\n`));
  const now = opts.now ?? new Date();
  const dayKey = utcDayKey(now);

  // Resolve config + data dir.
  const cfgPath = configFile(env);
  let cfg: Config;
  try {
    const loader = opts.loadConfigImpl ?? loadConfig;
    cfg = loader(cfgPath, { env, ...(opts.readerFs ? { read: (p: string) => opts.readerFs!.readFileSync(p, 'utf8') } : {}) });
  } catch (err) {
    const error = err as Error;
    stderr(`metaswarm-dashboard collect: ${error.message}`);
    return { exitCode: 1, projectsProcessed: [], projectsSkipped: [], warnings: [] };
  }

  const dataPath = dataDir(env);
  const result: RunCollectResult = {
    exitCode: 0,
    projectsProcessed: [],
    projectsSkipped: [],
    warnings: [],
  };

  // Resolve which projects to process.
  let projects: ProjectEntry[];
  if (opts.project !== undefined) {
    const found = cfg.projects.find((p) => p.name === opts.project);
    if (!found) {
      stderr(`metaswarm-dashboard collect: unknown project '${opts.project}' (not in config.yaml)`);
      return { ...result, exitCode: 1 };
    }
    projects = [found];
  } else if (opts.all) {
    projects = cfg.projects;
  } else {
    stderr('metaswarm-dashboard collect: pass --project <name> or --all');
    return { ...result, exitCode: 1 };
  }

  for (const project of projects) {
    const read = await readHostBeads(project.path, {
      ...(opts.execute ? { execute: opts.execute } : {}),
      ...(opts.readerFs ? { fs: opts.readerFs } : {}),
    });
    if (read.skipped) {
      stdout(`[skip] ${project.name}: ${read.skipReason ?? 'no .beads/'}`);
      result.projectsSkipped.push({ name: project.name, reason: read.skipReason ?? '' });
      continue;
    }
    for (const w of read.warnings) {
      stdout(`[warn] ${project.name}: ${w}`);
      result.warnings.push(`${project.name}: ${w}`);
    }
    const { agents, totals } = computeMetrics(read.rows, now);

    const daily: DailySnapshot = {
      schemaVersion: 1,
      projectName: project.name,
      generatedAt: now.toISOString(),
      dayKey,
      agents,
      totals,
      prsMergedLast7d: null,
    };
    const writerFs = opts.writerFs;
    atomicWriteJson(
      dailySnapshotPath(dataPath, project.name, dayKey),
      JSON.stringify(daily, null, 2),
      writerFs,
    );

    if (isUtcMonday(now)) {
      const priorWeek = previousIsoWeekKey(now);
      const priorWeekHasDaily = priorWeekHasAnyDailySnapshot(
        dataPath,
        project.name,
        priorWeek,
      );
      const weekly: WeeklySnapshot = {
        schemaVersion: 1,
        projectName: project.name,
        generatedAt: now.toISOString(),
        isoWeek: priorWeek,
        agents,
        totals,
        prsMergedLast7d: null,
        complete: priorWeekHasDaily,
      };
      atomicWriteJson(
        weeklySnapshotPath(dataPath, project.name, priorWeek),
        JSON.stringify(weekly, null, 2),
        writerFs,
      );
    }

    const summary =
      `[ok]   ${project.name}: ${agents.length} agents, ` +
      `${totals.totalCompletedTasksLast7d} completed last 7d ` +
      `(prsMergedLast7d: degraded — null in MVP, see README)`;
    stdout(summary);
    result.projectsProcessed.push(project.name);

    // Acknowledge the daily key + week key so unused-import is silenced when
    // running on non-Monday only.
    void isoWeekKey;
  }

  return result;
}

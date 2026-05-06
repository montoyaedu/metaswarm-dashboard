// Snapshot reader: reads `<dataDir>/projects/<name>/daily/YYYY-MM-DD.json`
// using the DailySnapshot Zod schema from @metaswarm-dashboard/types.
// Per plan WU-4.1, .2, .6.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  DailySnapshot,
  type DailySnapshot as DailySnapshotT,
} from '@metaswarm-dashboard/types/snapshots';

export interface SnapshotReaderFsHooks {
  existsSync: typeof existsSync;
  readFileSync: typeof readFileSync;
  readdirSync: typeof readdirSync;
  statSync: typeof statSync;
}

const defaultHooks: SnapshotReaderFsHooks = { existsSync, readFileSync, readdirSync, statSync };

const DAILY_FILE_RE = /^(\d{4}-\d{2}-\d{2})\.json$/;

export class SnapshotReader {
  constructor(
    private readonly dataDir: string,
    private readonly fs: SnapshotReaderFsHooks = defaultHooks,
    private readonly logger: (msg: string) => void = (msg) => {
      process.stderr.write(`[snapshot-reader] ${msg}\n`);
    },
  ) {}

  /** Names of directories under `<dataDir>/projects/` that have ≥1 daily snapshot. */
  listProjects(): string[] {
    const projectsRoot = join(this.dataDir, 'projects');
    if (!this.fs.existsSync(projectsRoot)) return [];
    let entries: string[];
    try {
      entries = this.fs.readdirSync(projectsRoot);
    } catch (err) {
      this.logger(`failed to read projects/: ${(err as Error).message}`);
      return [];
    }
    const names: string[] = [];
    for (const name of entries) {
      const dailyDir = join(projectsRoot, name, 'daily');
      if (!this.fs.existsSync(dailyDir)) continue;
      let dailyEntries: string[];
      try {
        dailyEntries = this.fs.readdirSync(dailyDir);
      } catch {
        continue;
      }
      if (dailyEntries.some((f) => DAILY_FILE_RE.test(f))) names.push(name);
    }
    names.sort();
    return names;
  }

  /** Lex-greatest YYYY-MM-DD daily snapshot, parsed via Zod. Returns null if none. */
  latestDaily(projectName: string): DailySnapshotT | null {
    const dailyDir = join(this.dataDir, 'projects', projectName, 'daily');
    if (!this.fs.existsSync(dailyDir)) return null;
    let entries: string[];
    try {
      entries = this.fs.readdirSync(dailyDir);
    } catch (err) {
      this.logger(`failed to read ${dailyDir}: ${(err as Error).message}`);
      return null;
    }
    const dailyKeys = entries
      .map((name) => DAILY_FILE_RE.exec(name)?.[1])
      .filter((k): k is string => typeof k === 'string')
      .sort();
    if (dailyKeys.length === 0) return null;
    const latest = dailyKeys[dailyKeys.length - 1]!;
    return this.readDaily(projectName, latest);
  }

  /** Returns up to `limit` most-recent daily snapshots (newest first). */
  recentDaily(projectName: string, limit: number): DailySnapshotT[] {
    const dailyDir = join(this.dataDir, 'projects', projectName, 'daily');
    if (!this.fs.existsSync(dailyDir)) return [];
    let entries: string[];
    try {
      entries = this.fs.readdirSync(dailyDir);
    } catch (err) {
      this.logger(`failed to read ${dailyDir}: ${(err as Error).message}`);
      return [];
    }
    const dailyKeys = entries
      .map((name) => DAILY_FILE_RE.exec(name)?.[1])
      .filter((k): k is string => typeof k === 'string')
      .sort()
      .reverse() // newest first
      .slice(0, limit);
    const out: DailySnapshotT[] = [];
    for (const key of dailyKeys) {
      const snap = this.readDaily(projectName, key);
      if (snap !== null) out.push(snap);
    }
    return out;
  }

  /** Read + parse a single daily snapshot. Returns null on missing or invalid. */
  readDaily(projectName: string, dayKey: string): DailySnapshotT | null {
    const path = join(this.dataDir, 'projects', projectName, 'daily', `${dayKey}.json`);
    if (!this.fs.existsSync(path)) return null;
    let raw: string;
    try {
      raw = this.fs.readFileSync(path, 'utf8');
    } catch (err) {
      this.logger(`failed to read ${path}: ${(err as Error).message}`);
      return null;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.logger(`invalid JSON in ${path}`);
      return null;
    }
    const result = DailySnapshot.safeParse(parsed);
    if (!result.success) {
      this.logger(`schema mismatch in ${path}: ${result.error.message}`);
      return null;
    }
    return result.data;
  }
}

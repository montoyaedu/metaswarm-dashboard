// Atomic snapshot writer (per plan WU-3.{1,3,16}).
//
// Writes JSON to a temp file under the same directory, then renames into
// place. On rename failure, removes the temp and propagates a clear error.
// Re-running the same UTC day overwrites idempotently.

import { mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface WriterFsHooks {
  mkdirSync: typeof mkdirSync;
  writeFileSync: typeof writeFileSync;
  renameSync: typeof renameSync;
  unlinkSync: typeof unlinkSync;
}

const defaultFsHooks: WriterFsHooks = {
  mkdirSync,
  writeFileSync,
  renameSync,
  unlinkSync,
};

export class WriterError extends Error {
  constructor(message: string, public override readonly cause?: unknown) {
    super(message);
    this.name = 'WriterError';
  }
}

/**
 * Atomically write `data` (already-serialized JSON string) to `targetPath`.
 *
 * Steps: mkdir parent → writeFile to `<target>.tmp` → rename to target.
 * On failure, the temp file is unlinked. Idempotent across calls with the
 * same target path (the rename overwrites).
 */
export function atomicWriteJson(
  targetPath: string,
  data: string,
  fs: WriterFsHooks = defaultFsHooks,
): void {
  const tempPath = `${targetPath}.tmp`;
  fs.mkdirSync(dirname(targetPath), { recursive: true });
  try {
    fs.writeFileSync(tempPath, data, 'utf8');
  } catch (err) {
    throw new WriterError(`failed to write temp file ${tempPath}`, err);
  }
  try {
    fs.renameSync(tempPath, targetPath);
  } catch (err) {
    // Try to clean up the temp; ignore secondary failure.
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // ignore
    }
    throw new WriterError(`failed to rename ${tempPath} → ${targetPath}`, err);
  }
}

/** Compose the daily snapshot path for a project under the data dir. */
export function dailySnapshotPath(
  dataDir: string,
  projectName: string,
  dayKey: string,
): string {
  return join(dataDir, 'projects', projectName, 'daily', `${dayKey}.json`);
}

/** Compose the weekly snapshot path for a project under the data dir. */
export function weeklySnapshotPath(
  dataDir: string,
  projectName: string,
  weekKey: string,
): string {
  return join(dataDir, 'projects', projectName, 'weekly', `${weekKey}.json`);
}

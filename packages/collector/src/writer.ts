// Snapshot path composition for the collector.
//
// The atomic writer (`atomicWriteJson`, `WriterError`, `WriterFsHooks`) was
// lifted to `@metaswarm-dashboard/types/fs-utils` in sessions-spike WU-1
// (design §5.3). It is re-exported here so the collector's existing call
// sites keep importing from `./writer.js` with zero behaviour change.

import { join } from 'node:path';

export {
  WriterError,
  atomicWriteJson,
  type WriterFsHooks,
} from '@metaswarm-dashboard/types/fs-utils';

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

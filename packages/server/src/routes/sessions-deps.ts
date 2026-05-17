// Dependency contracts for the v4-5 session read routes (sessions-spike
// WU v4-5). These narrow interfaces are the type-checked seam between
// `buildServer` and the route handlers: production wires the real
// `discoverSessions` / `readSessionRating` / parse-score cache; tests wire
// stubs over temp trees.

import type { SessionRef } from '@metaswarm-dashboard/sessions';
import type { Config } from '@metaswarm-dashboard/types/config';
import type { CalibrationSummary } from '@metaswarm-dashboard/types/ratings';
import type { SessionRating } from '@metaswarm-dashboard/types/ratings';

import type { TranscriptCache } from '../data/transcript-cache.js';

/** Dependencies the `/api/sessions` + `/api/sessions/:p/:s` handlers need. */
export interface SessionsRouteDeps {
  /** The loaded dashboard config (its `projects[].path` are absolute). */
  config: Config;
  /** The transcripts root scanned by discovery. */
  transcriptsDir: string;
  /** The datalake root holding persisted ratings. */
  dataDir: string;
  /** Live discovery — maps the config to path-level `SessionRef`s. */
  discoverSessions: (config: Config, transcriptsDir: string) => SessionRef[];
  /** Read a persisted rating, or `null` when the session is unrated. */
  readSessionRating: (
    dataDir: string,
    projectName: string,
    sessionId: string,
  ) => SessionRating | null;
  /** The mtime/size-keyed parse + score cache. */
  cache: TranscriptCache;
}

/** Dependencies the `/api/calibration` handler needs. */
export interface CalibrationRouteDeps {
  /** The datalake root walked for `*.rating.json` files. */
  dataDir: string;
  /** Aggregate every persisted rating into a `CalibrationSummary`. */
  aggregateCalibration: (dataDir: string, now: Date) => CalibrationSummary;
  /** Injected clock for a deterministic `generatedAt`. */
  now: () => Date;
}

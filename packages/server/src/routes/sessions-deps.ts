// Dependency contracts for the v4-5 session read routes (sessions-spike
// WU v4-5). These narrow interfaces are the type-checked seam between
// `buildServer` and the route handlers: production wires the real
// `discoverSessions` / `readSessionRating` / parse-score cache; tests wire
// stubs over temp trees.

import type { SessionRef } from '@metaswarm-dashboard/sessions';
import type { Config } from '@metaswarm-dashboard/types/config';
import type { CalibrationSummary } from '@metaswarm-dashboard/types/ratings';
import type { SessionRating } from '@metaswarm-dashboard/types/ratings';

import type { CostService } from '../data/cost-service.js';
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
  /**
   * sessions-spike v5-7 (design §7): the cost service. The session routes use
   * it to attach `aiTitle` / `costUsd` / `hasUnpriced` to each `SessionSummary`
   * and `cost: SessionCost` to the detail response.
   */
  cost: CostService;
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

/**
 * Dependencies the `PUT /api/sessions/:project/:sessionId/rating` handler
 * needs (sessions-spike WU v4-6, design §7 / §8.1). The narrow interface is
 * the type-checked seam between `buildServer` and the write handler.
 */
export interface WriteRatingRouteDeps {
  /** The loaded dashboard config (its `projects[].path` are absolute). */
  config: Config;
  /** The transcripts root scanned by discovery. */
  transcriptsDir: string;
  /** The datalake root the rating is persisted under. */
  dataDir: string;
  /** Live discovery — maps the config to path-level `SessionRef`s. */
  discoverSessions: (config: Config, transcriptsDir: string) => SessionRef[];
  /**
   * The mtime/size-keyed parse + score cache — the handler re-derives
   * `rubricAtRating` server-side from the live transcript via this cache.
   */
  cache: TranscriptCache;
  /** Persist a validated `SessionRating`; returns the path written. */
  writeSessionRating: (rating: SessionRating, dataDir: string) => string;
  /** Injected clock for a deterministic `ratedAt`. */
  now: () => Date;
  /**
   * Advisory footgun check — logs a warning if `dataDir` sits inside a git
   * working tree (design §8.3). Called on every successful write.
   */
  warnIfDataDirInGit: (dataDir: string) => void;
}

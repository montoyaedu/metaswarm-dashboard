// Calibration aggregator (sessions-spike WU v4-5, design §4 / §7).
//
// `aggregateCalibration` walks every persisted `*.rating.json` in the
// datalake and reduces the operator's verdicts into a per-`RubricKey`
// agreement tally — the rubric is advisory, and this is the only honest
// measure of how often it matched the operator (design §5 / §10).
//
// Layout walked: `<dataDir>/projects/<project>/sessions/ratings/*.rating.json`
// (the day-independent rating layout, design §13).
//
// Per `OperatorVerdict`:
//   - verdict `na` or `unsure`            → `naOrUnsure` (excluded from ratio)
//   - else == the matching rubric verdict → `agree`
//   - else                                → `disagree`
// `agreementRatio = agree / (agree + disagree)`, or `null` when the
// denominator is 0. An empty datalake yields a valid all-zero summary.
//
// Filesystem hooks are injectable so the live datalake walk is unit-coverable.

import {
  readdirSync as nodeReaddirSync,
  readFileSync as nodeReadFileSync,
} from 'node:fs';
import { join } from 'node:path';

import {
  CalibrationSummary,
  SessionRating,
} from '@metaswarm-dashboard/types/ratings';
import type { KpiAgreement } from '@metaswarm-dashboard/types/ratings';
import { RubricKey } from '@metaswarm-dashboard/types/sessions';

/** The 9 `RubricKey`s, in enum declaration order. */
export const RUBRIC_KEYS: readonly RubricKey[] = RubricKey.options;

/** The fixed suffix of a persisted rating file. */
const RATING_FILE_SUFFIX = '.rating.json';

/**
 * Injectable filesystem hooks for the aggregator. Defaults to `node:fs`.
 * Tests point these at a temp datalake so the walk is fully covered.
 */
export interface CalibrationFsHooks {
  /** List a directory's entries. */
  readdirSync: (dir: string) => string[];
  /** Read a file as a UTF-8 string. */
  readFileSync: (path: string) => string;
}

const DEFAULT_FS: CalibrationFsHooks = {
  readdirSync: (dir) => nodeReaddirSync(dir),
  readFileSync: (path) => nodeReadFileSync(path, 'utf8'),
};

/** Mutable per-KPI tally, finalized into a `KpiAgreement`. */
interface Tally {
  agree: number;
  disagree: number;
  naOrUnsure: number;
}

/** List a directory's entries, or `[]` if it does not exist / is unreadable. */
function safeReaddir(fs: CalibrationFsHooks, dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

/**
 * Read + validate one `*.rating.json`. Returns `null` when the file is
 * unreadable, not JSON, or fails the `SessionRating` schema — a malformed
 * rating must not abort the whole aggregation.
 */
function readRatingFile(fs: CalibrationFsHooks, path: string): SessionRating | null {
  let raw: string;
  try {
    raw = fs.readFileSync(path);
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = SessionRating.safeParse(parsed);
  return result.success ? result.data : null;
}

/**
 * Collect every valid `SessionRating` in the datalake by walking
 * `<dataDir>/projects/*​/sessions/ratings/*.rating.json`.
 */
function collectRatings(fs: CalibrationFsHooks, dataDir: string): SessionRating[] {
  const ratings: SessionRating[] = [];
  const projectsRoot = join(dataDir, 'projects');
  for (const project of safeReaddir(fs, projectsRoot)) {
    const ratingsDir = join(projectsRoot, project, 'sessions', 'ratings');
    for (const entry of safeReaddir(fs, ratingsDir)) {
      if (!entry.endsWith(RATING_FILE_SUFFIX)) {
        continue;
      }
      const rating = readRatingFile(fs, join(ratingsDir, entry));
      if (rating !== null) {
        ratings.push(rating);
      }
    }
  }
  return ratings;
}

/**
 * Aggregate every `SessionRating` in the datalake into a `CalibrationSummary`.
 *
 * @param dataDir - The datalake root (`<dataDir>/projects/...`).
 * @param now - Injected clock for a deterministic `generatedAt`.
 * @param fs - Optional filesystem hooks (defaults to `node:fs`).
 */
export function aggregateCalibration(
  dataDir: string,
  now: Date,
  fs: CalibrationFsHooks = DEFAULT_FS,
): CalibrationSummary {
  const ratings = collectRatings(fs, dataDir);

  // One tally per RubricKey, seeded at zero so an unrated KPI still appears.
  const tallies = new Map<RubricKey, Tally>();
  for (const key of RUBRIC_KEYS) {
    tallies.set(key, { agree: 0, disagree: 0, naOrUnsure: 0 });
  }

  for (const rating of ratings) {
    // Index the frozen rubric's items by key for O(1) per-verdict lookup.
    const rubricByKey = new Map(
      rating.rubricAtRating.items.map((item) => [item.key, item.verdict]),
    );
    for (const verdict of rating.verdicts) {
      // `verdict.key` is a `RubricKey` and `tallies` is seeded for every
      // `RubricKey` above, so the lookup always resolves.
      const tally = tallies.get(verdict.key)!;
      if (verdict.verdict === 'na' || verdict.verdict === 'unsure') {
        tally.naOrUnsure++;
        continue;
      }
      const rubricVerdict = rubricByKey.get(verdict.key);
      if (rubricVerdict !== undefined && rubricVerdict === verdict.verdict) {
        tally.agree++;
      } else {
        tally.disagree++;
      }
    }
  }

  // Build one `KpiAgreement` per seeded tally — the map preserves the
  // RUBRIC_KEYS insertion order, so `perKpi` is in enum declaration order.
  const perKpi: KpiAgreement[] = [];
  for (const [key, tally] of tallies) {
    const rated = tally.agree + tally.disagree;
    perKpi.push({
      key,
      agree: tally.agree,
      disagree: tally.disagree,
      naOrUnsure: tally.naOrUnsure,
      total: rated + tally.naOrUnsure,
      agreementRatio: rated === 0 ? null : tally.agree / rated,
    });
  }

  return {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    ratedSessionCount: ratings.length,
    perKpi,
  };
}

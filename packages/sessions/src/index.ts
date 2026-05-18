// Public surface for @metaswarm-dashboard/sessions.
//
// Re-exports the package's stable API so consumers (the v4 server, the SPA's
// build) import from `@metaswarm-dashboard/sessions` rather than deep-importing
// internal module paths.
export { resolveProjectForCwd } from './cost/attribution.js';
export type { AttributionFsHooks } from './cost/attribution.js';
export { CANONICAL_MODEL_ALIASES, costFor } from './cost/calculator.js';
export { discoverCodexRuns, readCodexRollout } from './cost/codex-reader.js';
export type { CodexReaderFsHooks, CodexWalkOptions } from './cost/codex-reader.js';
export { discoverGeminiRuns } from './cost/ledger-reader.js';
export type {
  LedgerReaderFsHooks,
  LedgerReaderOptions,
} from './cost/ledger-reader.js';
export { loadPricingTable, pricingTableHash } from './cost/pricing.js';
export { computeSessionCost } from './cost/session-cost.js';
export { parseTranscript, parseTranscriptUsage } from './jsonl-reader.js';
export type { AssistantUsageRecord, JsonlReaderFsHooks } from './jsonl-reader.js';
export { ratingPath, readSessionRating, writeSessionRating } from './rating-store.js';
export type { RatingStoreFsHooks, RatingWriterFsHooks } from './rating-store.js';
export { scoreTimeline } from './rubric/index.js';
export { discoverSessions, encodeTranscriptDirName } from './transcript-discovery.js';
export type { SessionRef } from './transcript-discovery.js';

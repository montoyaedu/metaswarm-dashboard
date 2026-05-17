// Public surface for @metaswarm-dashboard/sessions.
//
// Re-exports the package's stable API so consumers (the v4 server, the SPA's
// build) import from `@metaswarm-dashboard/sessions` rather than deep-importing
// internal module paths. WU v4-6 later adds `writeSessionRating`.
export { parseTranscript } from './jsonl-reader.js';
export { scoreTimeline } from './rubric/index.js';
export { discoverSessions, encodeTranscriptDirName } from './transcript-discovery.js';
export type { SessionRef } from './transcript-discovery.js';

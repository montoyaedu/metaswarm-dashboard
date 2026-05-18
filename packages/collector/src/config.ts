// YAML config loader (per plan §2.3 / WU-2.4).
//
// The loader (`loadConfig`, `Config`, `ProjectEntry`, `ConfigError`,
// `LoadConfigOptions`) was lifted to `@metaswarm-dashboard/types/config` in
// sessions-spike WU v4-2 (design §3.5) so the v4 server can reuse it without
// deep-importing collector internals. It is re-exported here so the
// collector's existing call sites (`cli/collect.ts`, the config tests) keep
// importing from `./config.js` with zero behaviour change.

export { Config, ConfigError, ProjectEntry, loadConfig } from '@metaswarm-dashboard/types/config';
export type { LoadConfigOptions } from '@metaswarm-dashboard/types/config';

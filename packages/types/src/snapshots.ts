import { z } from 'zod';

// Snapshot Zod schemas (per plan §2.3). Populated fully in WU-3 — for now this
// skeleton lets the WU-1 sanity tests prove the runtime artifact (Zod schema)
// is reachable through the @metaswarm-dashboard/types/snapshots subpath
// import.

export const Marker = z.object({
  schemaVersion: z.literal(1),
});

export type MarkerType = z.infer<typeof Marker>;

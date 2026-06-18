import type { RunRecord } from "@test-cabinet/run-record";
import { runs as snapshotRuns } from "virtual:tcab-snapshot";

// The published gallery dataset. It is the backend's public R2 snapshot, fetched
// at build time by `vite-plugin-snapshot` and inlined into the bundle (see
// design/v0.2.0-contracts.md §3). The site ships fully static — it never queries
// the backend or R2 at runtime. The dataset is empty in dev and when no snapshot
// URL is configured.
//
// What the gallery actually shows is assembled by `useRuns` — in dev it also
// merges in produced-but-unpublished runs from disk (served by the `localRuns`
// Vite plugin), and falls back to `sampleRuns` only when nothing else exists.
export const runs: RunRecord[] = snapshotRuns;

import type { RunRecord } from "@test-cabinet/run-record";
import runsData from "./runs.json";

// The published gallery dataset. `tcab publish` appends each published run's
// record to `runs.json`, and the site renders whatever is present. It starts
// empty and is the single source of truth for published runs.
//
// What the gallery actually shows is assembled by `useRuns` — in dev it also
// merges in produced-but-unpublished runs from disk (served by the `localRuns`
// Vite plugin), and falls back to `sampleRuns` only when nothing else exists.
export const runs: RunRecord[] = runsData as RunRecord[];

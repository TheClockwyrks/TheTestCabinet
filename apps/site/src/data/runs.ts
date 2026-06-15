import type { RunRecord } from "@test-cabinet/run-record";
import runsData from "./runs.json";

// The gallery dataset. This is the published run-record dataset the site is
// built from: `tcab publish` appends each published run's record to
// `runs.json`, and the site renders whatever is present. It starts empty and is
// the single source of truth for the gallery — there is no bundled sample data.
export const runs: RunRecord[] = runsData as RunRecord[];

export function findRun(runId: string): RunRecord | undefined {
  return runs.find((run) => run.id === runId);
}

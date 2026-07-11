import type { WorkerClient } from "../../../client/clients";
import type { InProgressRun, LaunchConfig } from "../../../client/types";

// One run to launch: the backend launch config plus the display identity to track
// it under while it is in flight (its runId is filled in on success). The tracking
// identity is passed explicitly (rather than derived from `config`) so a caller can
// show the raw model id it collected, not the provider-resolved id `config` carries.
export interface LaunchItem {
  config: LaunchConfig;
  track: Omit<InProgressRun, "runId" | "state">;
}

// The result of one launch, aligned by index to the input `items`. `runId` is set
// on success (and is what a caller links to the live monitor); `error` on failure.
export interface LaunchItemResult {
  runId?: string;
  error?: string;
}

// Launch a batch of runs sequentially, each isolated in its own try/catch so a
// single failure never aborts the rest — every item reports its own success or
// error, returned in input order. On success the run is registered with the runs
// runtime so the active-run list shows it immediately, before the data source
// picks it up as a produced run.
//
// This is the shared fan-out both the new-run form (combinations × runs-each) and
// the coverage matrix (a cell's still-missing runs) drive, so the two never drift
// on how a run is enqueued, tracked, and reported.
export async function launchBatch(
  worker: { client: WorkerClient },
  token: string | null,
  track: (run: InProgressRun) => void,
  items: LaunchItem[],
): Promise<LaunchItemResult[]> {
  const results: LaunchItemResult[] = [];
  for (const item of items) {
    try {
      const runId = await worker.client.launchRun(item.config, token);
      track({ ...item.track, runId, state: "running" });
      results.push({ runId });
    } catch (e) {
      results.push({ error: String(e) });
    }
  }
  return results;
}

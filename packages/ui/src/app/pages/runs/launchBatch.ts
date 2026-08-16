import type { WorkerClient } from "../../../client/clients";
import type {
  InProgressRun,
  LaunchConfig,
  LaunchOrigin,
} from "../../../client/types";

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

// Launch a batch of runs in a single request (`POST /jobs/batch`): the whole set
// is enqueued server-side in one round-trip, and the backend isolates each run so a
// single bad one never aborts the rest — every item reports its own success or
// error, returned in input order. On success the run is registered with the runs
// runtime so the active-run list shows it immediately, before the data source picks
// it up as a produced run. A transport-level failure (the request itself throwing)
// fails every item uniformly, preserving the per-item result shape.
//
// This is the shared fan-out both the new-run form (combinations × runs-each) and
// the coverage matrix (a cell's still-missing runs) drive, so the two never drift
// on how a run is enqueued, tracked, and reported.
//
// `origin` attributes the whole batch to the plan or ladder that asked for it. It
// matters beyond bookkeeping: a job with no origin is outside every scoped halt, so
// runs launched on a plan's behalf without one produce a plan that visibly refuses
// to stop. It is optional precisely so a hand-launch from the new-run form keeps
// `null` and stays outside any plan's halt, which is the correct default.
export async function launchBatch(
  worker: { client: WorkerClient },
  token: string | null,
  track: (run: InProgressRun) => void,
  items: LaunchItem[],
  origin?: LaunchOrigin | null,
): Promise<LaunchItemResult[]> {
  if (items.length === 0) return [];
  let acks: LaunchItemResult[];
  try {
    acks = await worker.client.launchRunBatch(
      items.map((item) => item.config),
      token,
      origin,
    );
  } catch (e) {
    // The batch request itself failed (network, 401, 5xx) — no run was enqueued.
    // Report the same error for every item so callers still get one result each.
    return items.map(() => ({ error: String(e) }));
  }
  return items.map((item, i) => {
    const ack = acks[i];
    if (ack?.runId) {
      // A just-enqueued run is `queued` on the backend, not yet `running` — it may
      // even be held back to `pending` if its harness is at its parallelism cap.
      // Show the honest initial phase; the active-list reconcile advances it
      // (queued → pending/starting → running) as the backend reports each
      // transition.
      track({ ...item.track, runId: ack.runId, state: "queued" });
      return { runId: ack.runId };
    }
    return { error: ack?.error ?? "run was not enqueued" };
  });
}

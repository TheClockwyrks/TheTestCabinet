import type { InProgressRun } from "../../client/types";

// One worker's answer when asked to enumerate its active runs: either the runs it
// is currently executing, or a failure to reach it at all. A failure is NOT the
// same as "no active runs" — a worker we could not question tells us nothing about
// its runs, which is why the two cases are distinguished here.
export type ActiveRunsResult =
  | { ok: true; runs: InProgressRun[] }
  | { ok: false };

// The reconciliation plan: which active runs are newly seen (track them) and which
// tracked runs have finished (remove them).
export interface Reconciliation {
  /** Active runs not already in the in-progress list — add these. */
  toTrack: InProgressRun[];
  /** Tracked run ids that no worker still reports as active — remove these. */
  toRemove: string[];
}

// Reconcile the tracked in-progress runs against every worker's authoritative
// active set (`GET /jobs/active`, which lists queued/dispatched/running jobs).
//
// The completion push (`GET /notifications`, SSE) is deliberately live-only: the
// backend replays no backlog, so a completion that fires while the push channel is
// between connections — a reconnect gap, an EventSource that errored and has not
// re-established, or the console simply not being subscribed at that instant — is
// never delivered. The run then stays stranded in the in-progress list, which is
// pruned only by those push events, until a manual page refresh re-seeds it from
// the active list. This performs that re-seed automatically: a run a worker newly
// reports is tracked; a tracked run no worker still reports has finished and is
// pruned.
//
// Pruning requires a COMPLETE picture. If any worker could not be reached, its
// runs are unaccounted for, so nothing is pruned this pass (only additions are
// returned) — dropping a run merely because the worker holding it was momentarily
// unreachable would be worse than the stale entry we are trying to fix.
export function reconcileActiveRuns(
  inProgress: InProgressRun[],
  results: ActiveRunsResult[],
): Reconciliation {
  const complete = results.every((result) => result.ok);

  const activeRunIds = new Set<string>();
  for (const result of results) {
    if (result.ok) {
      for (const run of result.runs) activeRunIds.add(run.runId);
    }
  }

  // Track runs not already present. Seed `seen` with the current list so a run two
  // workers both report (or one already tracked) is not added twice.
  const seen = new Set(inProgress.map((run) => run.runId));
  const toTrack: InProgressRun[] = [];
  for (const result of results) {
    if (!result.ok) continue;
    for (const run of result.runs) {
      if (!seen.has(run.runId)) {
        seen.add(run.runId);
        toTrack.push(run);
      }
    }
  }

  const toRemove = complete
    ? inProgress
        .filter((run) => !activeRunIds.has(run.runId))
        .map((run) => run.runId)
    : [];

  return { toTrack, toRemove };
}

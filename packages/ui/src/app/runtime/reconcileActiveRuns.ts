import type { InProgressRun } from "../../client/types";

// One worker's answer when asked to enumerate its active runs: either the runs it
// is currently executing, or a failure to reach it at all. A failure is NOT the
// same as "no active runs" — a worker we could not question tells us nothing about
// its runs, which is why the two cases are distinguished here.
export type ActiveRunsResult =
  | { ok: true; runs: InProgressRun[] }
  | { ok: false };

// One tracked run the authoritative active set has moved on from — patch it in
// place (without reordering the list, which re-tracking would do).
//
// `state` is always carried, even when only the start changed, so applying an entry
// is one patch either way. `startedAt` is carried only when the active set names a
// start the tracked copy does not already show: a report that simply omits one must
// never erase a start the row already learned from the event stream.
export interface TrackedRunUpdate {
  runId: string;
  state: InProgressRun["state"];
  startedAt?: string;
}

// The reconciliation plan: which active runs are newly seen (track them), which
// tracked runs advanced their phase (update them), and which have finished
// (remove them).
export interface Reconciliation {
  /** Active runs not already in the in-progress list — add these. */
  toTrack: InProgressRun[];
  /** Tracked runs whose reported phase or start differs from what we show. */
  toUpdate: TrackedRunUpdate[];
  /** Tracked run ids that no worker still reports as active — remove these. */
  toRemove: string[];
}

// Reconcile the tracked in-progress runs against every worker's authoritative
// active set (`GET /jobs/active`, which lists every in-flight job — queued,
// pending, dispatched, starting, or running).
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
// runs are unaccounted for, so nothing is pruned this pass (only additions and
// updates are returned) — dropping a run merely because the worker holding it was
// momentarily unreachable would be worse than the stale entry we are trying to fix.
//
// Updating a run's phase, unlike pruning, does not need a complete picture: it only
// touches runs a reachable worker still reports, so a launched run tracked
// optimistically as "running" is corrected to its true phase ("queued", "pending",
// "starting") on the next poll instead of showing "running" the whole time. The
// run's start is repaired the same way and for the same reason — a row optimistically
// tracked at launch, or seeded from an event that predates the run starting, has no
// start of its own to tick a duration from until the active set hands it one.
export function reconcileActiveRuns(
  inProgress: InProgressRun[],
  results: ActiveRunsResult[],
): Reconciliation {
  const complete = results.every((result) => result.ok);

  // The authoritative row per active run id. First worker to report a run wins,
  // matching the track-order dedup below (a run lives on one worker anyway).
  const reported = new Map<string, InProgressRun>();
  for (const result of results) {
    if (!result.ok) continue;
    for (const run of result.runs) {
      if (!reported.has(run.runId)) reported.set(run.runId, run);
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

  // Refresh the phase — and the start — of runs already tracked that the active set
  // has moved on from. A run the console locally marked "failed" (a terminal phase
  // the wire never reports) is left alone: it is on its way out of the list, not to
  // be resurrected.
  const toUpdate: TrackedRunUpdate[] = [];
  for (const run of inProgress) {
    if (run.state === "failed") continue;
    const active = reported.get(run.runId);
    if (!active) continue;
    // Only a start the active set actually names, and only when it says something
    // the row does not already show. Falling back the other way — treating an absent
    // start as `null` and patching that in — would blank a started row every time a
    // report omitted the field, which is exactly what an older backend does.
    const startedAt =
      active.startedAt && active.startedAt !== run.startedAt
        ? active.startedAt
        : undefined;
    if (active.state === run.state && startedAt === undefined) continue;
    toUpdate.push({
      runId: run.runId,
      state: active.state,
      ...(startedAt !== undefined ? { startedAt } : {}),
    });
  }

  // `reported`'s keys are exactly the run ids some reachable worker still reports.
  const activeRunIds = new Set(reported.keys());
  const toRemove = complete
    ? inProgress
        .filter((run) => !activeRunIds.has(run.runId))
        .map((run) => run.runId)
    : [];

  return { toTrack, toUpdate, toRemove };
}

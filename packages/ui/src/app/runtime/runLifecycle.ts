import type { InProgressRun, RunLifecycleEvent } from "../../client/types";
import { runPhase } from "../../client/runPhase";

// What one run-lifecycle event asks the in-flight list to do.
//
// `track` adds a run (and moves it to the head of the list); `update` patches an
// existing row's phase *without* reordering; `remove` drops a finished run, with
// `refresh` saying whether the produced-run listings also went stale; `ignore` is a
// well-formed event the list has nothing to do with.
export type RunListAction =
  | { kind: "track"; run: InProgressRun }
  | { kind: "update"; runId: string; state: InProgressRun["state"] }
  | { kind: "remove"; runId: string; refresh: boolean }
  | { kind: "ignore" };

// Decide what one run-lifecycle event does to the in-flight list.
//
// Pure, and separated from the component that applies it for the same reason
// `reconcileActiveRuns` is: the interesting part is the decision, not the plumbing,
// and the decision has enough cases to be worth pinning down directly.
export function runListAction(
  event: RunLifecycleEvent,
  inProgress: InProgressRun[],
): RunListAction {
  if (event.kind === "finished") {
    // Only a cancellation asks for a refresh here. Every other way a run ends also
    // raises a completion notification, and the notification path refreshes on
    // that — doing it in both places would re-query every listing twice per
    // finished run. A cancel deliberately raises no notification (it is an
    // operator action, not a failure to alert on), so this is its only signal.
    return {
      kind: "remove",
      runId: event.runId,
      refresh: event.state === "canceled",
    };
  }

  // A non-terminal event whose state this console does not recognize. Dropping it
  // is safe: the periodic reconcile against the active list is what ultimately
  // decides what is in flight, and it reads the same states from the same backend.
  const phase = runPhase(event.state);
  if (!phase) return { kind: "ignore" };

  const run: InProgressRun = {
    runId: event.runId,
    testCaseSlug: event.testCaseSlug,
    testCaseVersion: event.testCaseVersion,
    variant: event.variant,
    harnessSlug: event.harnessSlug,
    modelId: event.modelId,
    state: phase,
  };

  if (event.kind === "enqueued") return { kind: "track", run };

  // A `state-changed` for a run this console has never seen still belongs in the
  // list — it was enqueued while the topic was off, or before this session began.
  // Tracking it here is the same repair the reconcile would eventually make, just
  // sooner, and the event carries everything the row needs.
  if (!inProgress.some((existing) => existing.runId === event.runId)) {
    return { kind: "track", run };
  }

  // A run already in the list is patched in place rather than re-tracked, because
  // tracking moves a run to the head — and a run must not jump around the list as
  // it advances through its phases.
  return { kind: "update", runId: event.runId, state: phase };
}

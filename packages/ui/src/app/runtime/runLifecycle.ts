import type { InProgressRun, RunLifecycleEvent } from "../../client/types";
import { runPhase } from "../../client/runPhase";

// What one run-lifecycle event asks the in-flight list to do.
//
// `track` adds a run (and moves it to the head of the list); `update` patches an
// existing row's phase *without* reordering; `remove` drops a finished run, with
// `refresh` saying whether the produced-run listings also went stale; `ignore` is a
// well-formed event the list has nothing to do with.
//
// An `update` carries `startedAt` only when the event actually named one, so it stays
// a patch of what this event knows: every event up to `dispatched` reports no start,
// and a row that already learned when its run began must not be walked back to a dash
// by one of them. It carries `detail` when the row's reason changes: `detail`
// belongs to the `storing` phase alone, so it is the driver's reason while the run
// is there and null once it has left.
export type RunListAction =
  | { kind: "track"; run: InProgressRun }
  | {
      kind: "update";
      runId: string;
      state: InProgressRun["state"];
      startedAt?: string;
      detail?: string | null;
    }
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
    // Carried so a row seeded from an event is filtered by the same identity as one
    // seeded from the active list: a listing narrowed to one coverage cell drops a
    // live row whose engine it cannot see.
    engine: event.engine ?? null,
    // Same reason as the engine: the row a gg event seeds is named by the
    // configuration it was launched from, and without this it falls back to the
    // representative primary-slot model — a different name for the same run
    // depending on whether the event or the active list got here first.
    ggPreset: event.ggPreset ?? null,
    // Null until the run reaches `starting`, which is what an enqueued run's row
    // shows as a dash rather than as a duration counting from nothing.
    startedAt: event.startedAt ?? null,
    state: phase,
    ...(phase === "storing" ? { detail: event.detail ?? null } : {}),
  };

  if (event.kind === "enqueued") return { kind: "track", run };

  // A `state-changed` for a run this console has never seen still belongs in the
  // list — it was enqueued while the topic was off, or before this session began.
  // Tracking it here is the same repair the reconcile would eventually make, just
  // sooner, and the event carries everything the row needs.
  const existing = inProgress.find((row) => row.runId === event.runId);
  if (!existing) return { kind: "track", run };

  // A run already in the list is patched in place rather than re-tracked, because
  // tracking moves a run to the head — and a run must not jump around the list as
  // it advances through its phases. The start rides along because the transition
  // into `starting` is exactly when it first exists: patching the phase alone would
  // leave a row that has been in the list since it was enqueued permanently unable
  // to say when its run began.
  return {
    kind: "update",
    runId: event.runId,
    state: phase,
    ...(event.startedAt ? { startedAt: event.startedAt } : {}),
    ...detailPatch(existing, phase, event.detail),
  };
}

// The reason a row carries: the driver's account of the failed upload while the
// run is `storing`, and nothing in any other phase, where an event's detail says
// something else or nothing at all.
export function storingDetail(
  phase: InProgressRun["state"],
  detail: string | null | undefined,
): string | null {
  return phase === "storing" ? (detail ?? null) : null;
}

// The patch that brings a tracked row's reason in line with what a source just
// reported for it: empty when the row already shows that reason.
export function detailPatch(
  tracked: InProgressRun,
  phase: InProgressRun["state"],
  detail: string | null | undefined,
): { detail?: string | null } {
  const next = storingDetail(phase, detail);
  return next === (tracked.detail ?? null) ? {} : { detail: next };
}

import { describe, expect, it } from "vitest";
import type { InProgressRun, RunLifecycleEvent } from "../../client/types";
import { runListAction } from "./runLifecycle";

function tracked(
  runId: string,
  state: InProgressRun["state"] = "running",
): InProgressRun {
  return {
    runId,
    testCaseSlug: "siege",
    testCaseVersion: "v1.0.0",
    variant: "base",
    harnessSlug: "claude",
    modelId: "claude-opus-4-8",
    state,
  };
}

function event(
  kind: RunLifecycleEvent["kind"],
  state: RunLifecycleEvent["state"],
  runId = "a",
): RunLifecycleEvent {
  return {
    kind,
    runId,
    testCaseSlug: "siege",
    testCaseVersion: "v1.0.0",
    variant: "base",
    harnessSlug: "claude",
    modelId: "claude-opus-4-8",
    state,
  };
}

describe("runListAction", () => {
  it("tracks a newly enqueued run", () => {
    expect(runListAction(event("enqueued", "queued"), [])).toEqual({
      kind: "track",
      run: tracked("a", "queued"),
    });
  });

  it("patches a tracked run in place as it advances", () => {
    // Deliberately `update`, not `track`: tracking moves a run to the head of the
    // list, and a run must not jump around as it moves through its phases.
    expect(
      runListAction(event("state-changed", "running"), [
        tracked("a", "starting"),
        tracked("b"),
      ]),
    ).toEqual({ kind: "update", runId: "a", state: "running" });
  });

  it("maps a dispatched run onto the spinning-up phase", () => {
    expect(
      runListAction(event("state-changed", "dispatched"), [
        tracked("a", "queued"),
      ]),
    ).toEqual({ kind: "update", runId: "a", state: "starting" });
  });

  it("surfaces a held-back run as pending", () => {
    // The dispatcher moves runs between queued and pending as capacity frees up,
    // and an operator watching a capped queue is waiting to see exactly this.
    expect(
      runListAction(event("state-changed", "pending"), [
        tracked("a", "queued"),
      ]),
    ).toEqual({ kind: "update", runId: "a", state: "pending" });
  });

  it("tracks a state change for a run it has never seen", () => {
    // Enqueued while the topic was off, or before this session began. The event
    // carries everything the row needs, so adopting it here is the same repair the
    // reconcile would make later.
    expect(
      runListAction(event("state-changed", "running"), [tracked("b")]),
    ).toEqual({ kind: "track", run: tracked("a", "running") });
  });

  it("removes a finished run without refreshing, when it also raised an alert", () => {
    // A succeeded/failed run raises a completion notification, and that path does
    // the refresh. Refreshing here too would re-query every listing twice per run.
    for (const state of ["succeeded", "failed"] as const) {
      expect(runListAction(event("finished", state), [tracked("a")])).toEqual({
        kind: "remove",
        runId: "a",
        refresh: false,
      });
    }
  });

  it("removes a canceled run and refreshes, because nothing else will", () => {
    // A cancellation deliberately raises no notification — it is an operator
    // action, not a failure to alert on — so this is the only signal the produced
    // listings have gone stale.
    expect(
      runListAction(event("finished", "canceled"), [tracked("a")]),
    ).toEqual({
      kind: "remove",
      runId: "a",
      refresh: true,
    });
  });

  it("removes a finished run it was not tracking", () => {
    // A run enqueued elsewhere can finish before this console ever saw it start.
    // Removing an absent run is a no-op, and reporting it uniformly keeps the
    // caller from having to special-case it.
    expect(runListAction(event("finished", "succeeded"), [])).toEqual({
      kind: "remove",
      runId: "a",
      refresh: false,
    });
  });

  it("ignores a non-terminal state it does not recognize", () => {
    // Forward compatibility: a state a newer backend introduced is left to the
    // reconcile against the active list rather than guessed at.
    const unknown = {
      ...event("state-changed", "queued"),
      state: "quarantined" as RunLifecycleEvent["state"],
    };
    expect(runListAction(unknown, [tracked("a")])).toEqual({ kind: "ignore" });
  });
});

import { describe, expect, it } from "vitest";
import type { InProgressRun, RunLifecycleEvent } from "../../client/types";
import { runListAction } from "./runLifecycle";

// The identity fields an event names and the row it seeds must agree on, so both
// helpers take them and default them the way a run with none of them reads.
interface Identity {
  engine?: string | null;
  ggPreset?: string | null;
  startedAt?: string | null;
}

function tracked(
  runId: string,
  state: InProgressRun["state"] = "running",
  identity: Identity = {},
): InProgressRun {
  return {
    runId,
    testCaseSlug: "siege",
    testCaseVersion: "v1.0.0",
    variant: "base",
    harnessSlug: "claude",
    modelId: "claude-opus-4-8",
    engine: identity.engine ?? null,
    ggPreset: identity.ggPreset ?? null,
    startedAt: identity.startedAt ?? null,
    state,
  };
}

function event(
  kind: RunLifecycleEvent["kind"],
  state: RunLifecycleEvent["state"],
  runId = "a",
  identity: Identity = {},
): RunLifecycleEvent {
  return {
    kind,
    runId,
    testCaseSlug: "siege",
    testCaseVersion: "v1.0.0",
    variant: "base",
    harnessSlug: "claude",
    modelId: "claude-opus-4-8",
    // Spread only what the caller named: the wire omits these fields rather than
    // sending nulls, and a row must be seeded correctly from an event that does.
    ...identity,
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

  it("carries the engine the event named onto the row it seeds", () => {
    // The engine is a segment of a run's coverage cell, and a row seeded from an
    // event is filtered by the same identity as one seeded from the active list —
    // a rung listing its own live runs drops a row whose engine it cannot see.
    expect(
      runListAction(
        event("enqueued", "queued", "a", { engine: "simple-2d" }),
        [],
      ),
    ).toEqual({
      kind: "track",
      run: tracked("a", "queued", { engine: "simple-2d" }),
    });
  });

  it("names a gg row by the configuration the event reported", () => {
    // A gg run has no single harness model — `modelId` is only its representative
    // primary-slot binding — so a row that loses the configuration name is displayed
    // as a bare model id until the reconcile happens to re-seed it from the active
    // list, and then silently renames itself.
    expect(
      runListAction(
        event("enqueued", "queued", "a", { ggPreset: "deep-research" }),
        [],
      ),
    ).toEqual({
      kind: "track",
      run: tracked("a", "queued", { ggPreset: "deep-research" }),
    });
  });

  it("seeds a run that has not started with no start at all", () => {
    // An enqueued run has been running for no time; the row shows a dash, and there
    // is no synthetic start for a duration to begin ticking from.
    const { run } = runListAction(event("enqueued", "queued"), []) as {
      run: InProgressRun;
    };
    expect(run.startedAt).toBeNull();
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

  it("patches the start onto a row that was already in the list when it began", () => {
    // The transition into `starting` is the first event that has a start to report,
    // and by then the row has usually been tracked since it was enqueued. Patching
    // the phase alone would leave it permanently unable to say when its run began —
    // and it must stay an `update`, because re-tracking would jump it to the head.
    expect(
      runListAction(
        event("state-changed", "starting", "a", {
          startedAt: "2026-09-06T00:02:00Z",
        }),
        [tracked("a", "queued")],
      ),
    ).toEqual({
      kind: "update",
      runId: "a",
      state: "starting",
      startedAt: "2026-09-06T00:02:00Z",
    });
  });

  it("leaves a known start alone when an event reports none", () => {
    // Every event up to `dispatched` omits the field. Patching an absent start in
    // would blank a row that already knows when its run began.
    expect(
      runListAction(event("state-changed", "pending"), [
        tracked("a", "queued", { startedAt: "2026-09-06T00:02:00Z" }),
      ]),
    ).toEqual({ kind: "update", runId: "a", state: "pending" });
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

import { describe, expect, it } from "vitest";
import type { InProgressRun } from "../../client/types";
import {
  reconcileActiveRuns,
  type ActiveRunsResult,
} from "./reconcileActiveRuns";

function run(
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

const ok = (...runs: InProgressRun[]): ActiveRunsResult => ({ ok: true, runs });
const failed: ActiveRunsResult = { ok: false };

describe("reconcileActiveRuns", () => {
  it("prunes a tracked run no worker still reports as active", () => {
    // The core bug: a completion whose push was never delivered leaves the run in
    // the list; the active set no longer contains it, so it must be pruned.
    const { toTrack, toRemove } = reconcileActiveRuns(
      [run("a"), run("b")],
      [ok(run("a"))],
    );
    expect(toTrack).toEqual([]);
    expect(toRemove).toEqual(["b"]);
  });

  it("tracks an active run not yet in the list", () => {
    const { toTrack, toRemove } = reconcileActiveRuns(
      [run("a")],
      [ok(run("a"), run("c"))],
    );
    expect(toTrack.map((r) => r.runId)).toEqual(["c"]);
    expect(toRemove).toEqual([]);
  });

  it("does nothing when the list already matches the active set", () => {
    const { toTrack, toRemove } = reconcileActiveRuns(
      [run("a"), run("b")],
      [ok(run("a"), run("b"))],
    );
    expect(toTrack).toEqual([]);
    expect(toRemove).toEqual([]);
  });

  it("prunes every tracked run when no worker reports any active", () => {
    // The reported symptom: a whole batch finishes with no push delivered.
    const { toRemove } = reconcileActiveRuns(
      [run("a"), run("b"), run("c")],
      [ok()],
    );
    expect(toRemove.sort()).toEqual(["a", "b", "c"]);
  });

  it("never prunes when a worker is unreachable (incomplete picture)", () => {
    // Worker 0 reports only `a`; worker 1 is unreachable and might be holding `b`.
    // `b` must NOT be dropped on an incomplete picture — but a genuinely new run
    // from the reachable worker is still added.
    const { toTrack, toRemove } = reconcileActiveRuns(
      [run("a"), run("b")],
      [ok(run("a"), run("d")), failed],
    );
    expect(toRemove).toEqual([]);
    expect(toTrack.map((r) => r.runId)).toEqual(["d"]);
  });

  it("unions active runs across workers before pruning", () => {
    // `a` is active on worker 0, `b` on worker 1; neither should be pruned.
    const { toTrack, toRemove } = reconcileActiveRuns(
      [run("a"), run("b"), run("gone")],
      [ok(run("a")), ok(run("b"))],
    );
    expect(toRemove).toEqual(["gone"]);
    expect(toTrack).toEqual([]);
  });

  it("does not double-track a run two workers both report", () => {
    const { toTrack } = reconcileActiveRuns([], [ok(run("a")), ok(run("a"))]);
    expect(toTrack.map((r) => r.runId)).toEqual(["a"]);
  });

  it("updates a tracked run whose reported phase has advanced", () => {
    // The reported symptom: a run launched (and optimistically shown "queued", or
    // stale-"running") is actually held back at the harness cap or spinning up. The
    // active list is authoritative, so its phase must flow through to the tracked run.
    const { toTrack, toUpdate, toRemove } = reconcileActiveRuns(
      [run("a", "queued"), run("b", "running")],
      [ok(run("a", "pending"), run("b", "starting"))],
    );
    expect(toTrack).toEqual([]);
    expect(toRemove).toEqual([]);
    expect(toUpdate).toEqual([
      { runId: "a", state: "pending" },
      { runId: "b", state: "starting" },
    ]);
  });

  it("emits no update when the reported phase is unchanged", () => {
    const { toUpdate } = reconcileActiveRuns(
      [run("a", "starting")],
      [ok(run("a", "starting"))],
    );
    expect(toUpdate).toEqual([]);
  });

  it("updates phases even on an incomplete picture (unlike pruning)", () => {
    // A phase update only touches runs a reachable worker still reports, so it is
    // safe to apply even when another worker is unreachable and nothing is pruned.
    const { toUpdate, toRemove } = reconcileActiveRuns(
      [run("a", "queued"), run("b", "running")],
      [ok(run("a", "running")), failed],
    );
    expect(toRemove).toEqual([]);
    expect(toUpdate).toEqual([{ runId: "a", state: "running" }]);
  });

  it("never resurrects a run the console locally marked failed", () => {
    // "failed" is a terminal phase the wire never reports; a late active-list echo
    // must not flip it back to a live phase.
    const { toUpdate } = reconcileActiveRuns(
      [run("a", "failed")],
      [ok(run("a", "running"))],
    );
    expect(toUpdate).toEqual([]);
  });
});

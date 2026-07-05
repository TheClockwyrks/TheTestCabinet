import { describe, expect, it } from "vitest";
import type { InProgressRun } from "../../client/types";
import { reconcileActiveRuns, type ActiveRunsResult } from "./reconcileActiveRuns";

function run(runId: string): InProgressRun {
  return {
    runId,
    testCaseSlug: "siege",
    variant: "base",
    harnessSlug: "claude",
    modelId: "claude-opus-4-8",
    state: "running",
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
    const { toTrack, toRemove } = reconcileActiveRuns([run("a")], [ok(run("a"), run("c"))]);
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
    const { toRemove } = reconcileActiveRuns([run("a"), run("b"), run("c")], [ok()]);
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
});

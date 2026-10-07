import { describe, expect, it } from "vitest";
import type { InProgressRun } from "../../client/types";
import {
  reconcileActiveRuns,
  type ActiveRunsResult,
} from "./reconcileActiveRuns";

function run(
  runId: string,
  state: InProgressRun["state"] = "running",
  startedAt?: string,
): InProgressRun {
  return {
    runId,
    testCaseSlug: "siege",
    testCaseVersion: "v1.0.0",
    variant: "base",
    harnessSlug: "claude",
    modelId: "claude-opus-4-8",
    // Omitted rather than nulled when unnamed, which is how the wire reports a run
    // that has not started and how an older backend reports every run.
    ...(startedAt ? { startedAt } : {}),
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

  it("picks up a start the tracked copy never saw", () => {
    // A row tracked optimistically at launch, or seeded from an event raised before
    // the run started, has no start of its own — and a duration cannot tick from a
    // dash. The active list is authoritative, so its start flows through even though
    // the phase it reports is the one already shown.
    const { toUpdate } = reconcileActiveRuns(
      [run("a", "running")],
      [ok(run("a", "running", "2026-09-06T00:02:00Z"))],
    );
    expect(toUpdate).toEqual([
      { runId: "a", state: "running", startedAt: "2026-09-06T00:02:00Z" },
    ]);
  });

  it("repairs the phase and the start in one patch", () => {
    const { toUpdate } = reconcileActiveRuns(
      [run("a", "queued")],
      [ok(run("a", "running", "2026-09-06T00:02:00Z"))],
    );
    expect(toUpdate).toEqual([
      { runId: "a", state: "running", startedAt: "2026-09-06T00:02:00Z" },
    ]);
  });

  it("never blanks a start the active list simply omits", () => {
    // An older backend reports no start on any row. Treating that as "the run has
    // not started" would erase, once per poll, the start the event stream delivered.
    const { toUpdate } = reconcileActiveRuns(
      [run("a", "running", "2026-09-06T00:02:00Z")],
      [ok(run("a", "running"))],
    );
    expect(toUpdate).toEqual([]);
  });

  it("emits no update when the reported phase and start are unchanged", () => {
    const { toUpdate } = reconcileActiveRuns(
      [run("a", "starting", "2026-09-06T00:02:00Z")],
      [ok(run("a", "starting", "2026-09-06T00:02:00Z"))],
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

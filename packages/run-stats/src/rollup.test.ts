import { describe, expect, it } from "vitest";
import type { RunState } from "@test-cabinet/run-record";
import type { RunSummary } from "@test-cabinet/run-record/snapshot";
import type { Rating } from "@test-cabinet/run-record/review";
import { rollupRuns } from "./rollup";

interface RunOverrides {
  id?: string;
  state?: RunState;
  rating?: Rating | null;
  reviewCount?: number;
  score?: RunSummary["score"];
  slug?: string;
  harness?: string;
  startedAt?: string;
  finishedAt?: string;
  runTimeSeconds?: number;
  uncachedInput?: number | null;
  cachedInput?: number | null;
  output?: number | null;
  reasoning?: number | null;
  comparable?: number | null;
  actual?: number | null;
}

// A minimal published summary card. Only the fields the rollup reads are
// meaningful; the rest satisfy the contract shape.
function run(overrides: RunOverrides = {}): RunSummary {
  const {
    id = "run_1",
    state = "completed",
    rating = "great",
    reviewCount = 1,
    score = null,
    slug = "carom",
    harness = "claude-code",
    startedAt = "2026-08-01T00:00:00Z",
    finishedAt = "2026-08-01T00:10:00Z",
    runTimeSeconds = 600,
    uncachedInput = 100,
    cachedInput = 50,
    output = 25,
    reasoning = null,
    comparable = 0.5,
    actual = 0.5,
  } = overrides;
  return {
    id,
    publishedAt: finishedAt,
    startedAt,
    finishedAt,
    subject: {
      testCaseSlug: slug,
      testCaseVersion: "v1.0.0",
      testType: "end-to-end",
      variant: "base",
      harnessSlug: harness as RunSummary["subject"]["harnessSlug"],
      harnessVersion: null,
      modelId: "some-model",
    },
    caseName: "Carom",
    metrics: {
      runTimeSeconds,
      tokens: { uncachedInput, cachedInput, output, reasoning },
      cost: { comparable, actual },
    },
    validationLoaded: true,
    state,
    rating,
    reviewCount,
    score,
    links: { sourceRepo: null, playableBuild: null },
  };
}

describe("rollupRuns", () => {
  it("is empty but well-formed for no runs", () => {
    const rollup = rollupRuns([]);
    expect(rollup.runs).toBe(0);
    expect(rollup.runIds).toEqual([]);
    // Every state and rating key is present, so a caller can index without a
    // fallback even when nothing has been rolled up.
    expect(rollup.outcomes.completed).toBe(0);
    expect(rollup.outcomes.infrastructure).toBe(0);
    expect(rollup.ratings.flawless).toBe(0);
    expect(rollup.completionRate).toBeNull();
    expect(rollup.score).toBeNull();
    expect(rollup.firstRunAt).toBeNull();
    expect(rollup.lastRunAt).toBeNull();
  });

  it("counts outcomes across every state, not just the displayed ones", () => {
    const rollup = rollupRuns([
      run({ id: "a", state: "completed" }),
      run({ id: "b", state: "completed" }),
      run({ id: "c", state: "harness_error" }),
      run({ id: "d", state: "catastrophic" }),
      run({ id: "e", state: "infrastructure" }),
    ]);
    expect(rollup.outcomes.completed).toBe(2);
    expect(rollup.outcomes.harness_error).toBe(1);
    expect(rollup.outcomes.catastrophic).toBe(1);
    expect(rollup.outcomes.infrastructure).toBe(1);
    expect(rollup.runs).toBe(5);
    expect(rollup.completionRate).toBeCloseTo(0.4);
  });

  it("tallies ratings and counts an unrated run separately", () => {
    const rollup = rollupRuns([
      run({ id: "a", rating: "great" }),
      run({ id: "b", rating: "great" }),
      run({ id: "c", rating: "broken" }),
      run({ id: "d", rating: null }),
    ]);
    expect(rollup.ratings.great).toBe(2);
    expect(rollup.ratings.broken).toBe(1);
    expect(rollup.ratings.flawless).toBe(0);
    expect(rollup.unrated).toBe(1);
  });

  it("distinguishes an unreported figure from a reported zero", () => {
    const rollup = rollupRuns([
      run({ id: "a", comparable: 1.5, reasoning: 10 }),
      run({ id: "b", comparable: 0, reasoning: null }),
      run({ id: "c", comparable: null, reasoning: null }),
    ]);
    // A genuinely free run contributes 0 and still counts as reported; a run whose
    // price could not be resolved contributes neither.
    expect(rollup.cost.comparable).toEqual({
      total: 1.5,
      reported: 2,
      unknown: 1,
    });
    expect(rollup.tokens.reasoning).toEqual({
      total: 10,
      reported: 1,
      unknown: 2,
    });
  });

  it("pools score by weight and means it by run", () => {
    const rollup = rollupRuns([
      // 8/10 on a small checklist, 30/100 on a large one.
      run({ id: "a", score: { earned: 8, total: 10, reviews: 1 } }),
      run({ id: "b", score: { earned: 30, total: 100, reviews: 2 } }),
    ]);
    // Pooled: 38 of 110 — the big checklist dominates.
    expect(rollup.score!.earned).toBe(38);
    expect(rollup.score!.total).toBe(110);
    expect(rollup.score!.fraction).toBeCloseTo(38 / 110);
    // Unweighted: each run counts once — (0.8 + 0.3) / 2.
    expect(rollup.score!.meanFraction).toBeCloseTo(0.55);
    expect(rollup.score!.runs).toBe(2);
  });

  it("ignores an unscored run in the score but still counts its reviews", () => {
    const rollup = rollupRuns([
      run({ id: "a", score: { earned: 5, total: 10, reviews: 1 } }),
      run({ id: "b", score: null, reviewCount: 3 }),
    ]);
    expect(rollup.score!.runs).toBe(1);
    expect(rollup.score!.fraction).toBeCloseTo(0.5);
    expect(rollup.reviews).toBe(4);
  });

  it("counts a scored run with nothing on offer without dividing by zero", () => {
    const rollup = rollupRuns([
      run({ id: "a", score: { earned: 0, total: 0, reviews: 1 } }),
    ]);
    expect(rollup.score!.runs).toBe(1);
    expect(rollup.score!.fraction).toBeNull();
    expect(rollup.score!.meanFraction).toBeNull();
  });

  it("counts distinct cases and harnesses, and spans the run window", () => {
    const rollup = rollupRuns([
      run({
        id: "a",
        slug: "carom",
        harness: "claude-code",
        startedAt: "2026-08-02T00:00:00Z",
        finishedAt: "2026-08-02T01:00:00Z",
      }),
      run({
        id: "b",
        slug: "carom",
        harness: "codex",
        startedAt: "2026-08-01T00:00:00Z",
        finishedAt: "2026-08-01T01:00:00Z",
      }),
      run({
        id: "c",
        slug: "floe",
        harness: "codex",
        startedAt: "2026-08-03T00:00:00Z",
        finishedAt: "2026-08-03T01:00:00Z",
      }),
    ]);
    expect(rollup.testCases).toBe(2);
    expect(rollup.harnesses).toBe(2);
    expect(rollup.firstRunAt).toBe("2026-08-01T00:00:00Z");
    expect(rollup.lastRunAt).toBe("2026-08-03T01:00:00Z");
  });

  it("does not depend on the order the runs arrive in", () => {
    // The whole point of freezing a rollup and recomputing it later is that the
    // two are comparable, so the same set must reduce identically however it is
    // ordered.
    const runs = [
      run({ id: "c", state: "hung", rating: "broken" }),
      run({ id: "a", state: "completed", rating: "flawless" }),
      run({ id: "b", state: "timed_out", rating: null }),
    ];
    expect(rollupRuns(runs)).toEqual(rollupRuns([...runs].reverse()));
    expect(rollupRuns(runs).runIds).toEqual(["a", "b", "c"]);
  });
});

import { describe, expect, it } from "vitest";
import type {
  CoverageCell,
  CoverageMatrix,
} from "@clockwyrks/run-record/coverage";
import type { RunSummary } from "@clockwyrks/run-record/snapshot";
import { planRunScope, summarizeCoverageRuns } from "./coverageMetrics";

function cell(over: Partial<CoverageCell> = {}): CoverageCell {
  return {
    slug: "pong",
    version: "v1.0.0",
    variant: "base",
    engine: "none",
    harness: "claude",
    model: "claude-sonnet-4-5",
    desired: 3,
    runIds: [],
    counted: 1,
    filled: false,
    blocked: false,
    inFlight: 0,
    pending: 0,
    unreviewed: 0,
    remaining: 2,
    latestVersion: "v1.0.0",
    stale: false,
    ...over,
  } as CoverageCell;
}

function matrix(cells: CoverageCell[]): CoverageMatrix {
  return {
    cells,
    outerAxis: "case",
    cellsFilled: 0,
    cellsTotal: cells.length,
    cellsBlocked: 0,
    runsDone: 0,
    runsTotal: 0,
    runsInFlight: 0,
    runsMissing: 0,
    runsPending: 0,
    runsUnreviewed: 0,
    inFlightLimit: { kind: "bounded", runs: 10 },
    filling: false,
  };
}

function run(
  id: string,
  over: Partial<RunSummary["subject"]> = {},
  rest: Partial<RunSummary> = {},
): RunSummary {
  return {
    id,
    subject: {
      testCaseSlug: "pong",
      testCaseVersion: "v1.0.0",
      testType: "end-to-end",
      variant: "base",
      harnessSlug: "claude",
      harnessVersion: "1",
      engineSlug: "none",
      modelId: "claude-sonnet-4-5",
      ...over,
    },
    state: "completed",
    rating: null,
    reviewCount: 0,
    ...rest,
  } as unknown as RunSummary;
}

const nameOf = (slug: string) => slug;

// The breakdowns exist to answer "what were these runs", which is a different question
// from the matrix's "how many are there" — so the corpus has to be exactly the runs the
// matrix counts, folded the ways a reviewer steers by.
describe("summarizeCoverageRuns", () => {
  // The report: a cell of three whose combination other launches ran a fourth time. The
  // fourth run is not the plan's, so no breakdown reads it.
  it("reads only the runs the cells hold, never a run beyond a cell's target", () => {
    const m = matrix([cell({ runIds: ["a", "b", "c"], counted: 3 })]);
    const metrics = summarizeCoverageRuns(
      m,
      [run("a"), run("b"), run("c"), run("extra")],
      nameOf,
    );
    expect(metrics.total).toBe(3);
    expect(metrics.byCombination).toEqual([
      { label: "claude · claude-sonnet-4-5", count: 3 },
    ]);
  });

  it("attributes each run to the cell that holds it, engines included", () => {
    const m = matrix([
      cell({ runIds: ["a", "b"] }),
      cell({ engine: "simple-2d", runIds: ["c"] }),
    ]);
    const metrics = summarizeCoverageRuns(
      m,
      [run("a"), run("b"), run("c", { engineSlug: "simple-2d" })],
      nameOf,
    );
    expect(metrics.total).toBe(3);
  });

  it("leaves out a state that never counts toward a cell", () => {
    const metrics = summarizeCoverageRuns(
      matrix([cell({ runIds: ["a", "b", "c"] })]),
      [
        run("a"),
        run("b", {}, { state: "infrastructure" }),
        run("c", {}, { state: "timed_out" }),
      ],
      nameOf,
    );
    // The model's own failure is one of its runs; an infrastructure failure is not.
    expect(metrics.total).toBe(2);
  });

  it("counts a card listed twice once", () => {
    const metrics = summarizeCoverageRuns(
      matrix([cell({ runIds: ["a"] })]),
      [run("a"), run("a")],
      nameOf,
    );
    expect(metrics.total).toBe(1);
  });

  // Attribution by id names each gg arm by its own bound models, which no field of a
  // run card carries.
  it("files each gg arm's runs under that arm's own name", () => {
    const armA = cell({
      harness: "gg",
      model: "opus",
      ggConfigId: "saved:cfg-1",
      ggConfigName: "reviewer",
      ggSlotModels: { primary: "opus", critic: "haiku" },
      runIds: ["a"],
    });
    const armB = cell({
      harness: "gg",
      model: "opus",
      ggConfigId: "saved:cfg-1",
      ggConfigName: "reviewer",
      ggSlotModels: { primary: "opus", critic: "sonnet" },
      runIds: ["b", "c"],
    });
    const gg = {
      harnessSlug: "gg" as const,
      modelId: "opus",
      ggConfigId: "cfg-1",
    };
    const metrics = summarizeCoverageRuns(
      matrix([armA, armB]),
      [run("a", gg), run("b", gg), run("c", gg)],
      nameOf,
    );
    expect(metrics.total).toBe(3);
    expect(metrics.byCombination).toHaveLength(2);
    expect(metrics.byCombination[0]!.count).toBe(2);
    expect(metrics.byCombination[0]!.label).toMatch(/sonnet/);
    expect(metrics.byCombination[1]!.label).toMatch(/haiku/);
  });

  it("orders the rating breakdown best-first rather than by tally", () => {
    const metrics = summarizeCoverageRuns(
      matrix([cell({ runIds: ["a", "b", "c"] })]),
      [
        run("a", {}, { rating: "broken" }),
        run("b", {}, { rating: "broken" }),
        run("c", {}, { rating: "flawless" }),
      ],
      nameOf,
    );
    expect(metrics.ratings.map((r) => r.rating)).toEqual([
      "flawless",
      "broken",
    ]);
    expect(metrics.rated).toBe(3);
  });

  it("keeps unrated runs in the total, so the ring's remainder is honest", () => {
    const metrics = summarizeCoverageRuns(
      matrix([cell({ runIds: ["a", "b"] })]),
      [run("a"), run("b", {}, { rating: "great" })],
      nameOf,
    );
    expect(metrics.total).toBe(2);
    expect(metrics.rated).toBe(1);
  });

  it("counts reviewed runs apart from rated ones", () => {
    // A validator-rated run has a rating from the moment it completes and may carry
    // no review at all, so the two counts are not the same number.
    const metrics = summarizeCoverageRuns(
      matrix([cell({ runIds: ["a", "b"] })]),
      [
        run("a", {}, { rating: "great", reviewCount: 0 }),
        run("b", {}, { reviewCount: 2 }),
      ],
      nameOf,
    );
    expect(metrics.rated).toBe(1);
    expect(metrics.reviewed).toBe(1);
  });

  it("gives every combination a full per-tier tally, zeros included", () => {
    const m = matrix([
      cell({ runIds: ["a"] }),
      cell({ harness: "codex", model: "gpt", runIds: ["b"] }),
    ]);
    const metrics = summarizeCoverageRuns(
      m,
      [
        run("a", {}, { rating: "great" }),
        run(
          "b",
          { harnessSlug: "codex", modelId: "gpt" },
          { rating: "broken" },
        ),
      ],
      nameOf,
    );
    const claude = metrics.ratingsByCombination.find((r) =>
      r.label.startsWith("claude"),
    );
    expect(claude!.counts.great).toBe(1);
    // Present and zero rather than absent: the chart's hover reports every tier.
    expect(claude!.counts.broken).toBe(0);
  });

  it("breaks runs down by model as well as by combination", () => {
    const metrics = summarizeCoverageRuns(
      matrix([
        cell({ runIds: ["a", "b"] }),
        cell({ harness: "codex", model: "gpt", runIds: ["c"] }),
      ]),
      [run("a"), run("b"), run("c", { harnessSlug: "codex", modelId: "gpt" })],
      nameOf,
    );
    expect(metrics.byModel).toEqual([
      { label: "claude-sonnet-4-5", count: 2 },
      { label: "gpt", count: 1 },
    ]);
  });

  it("names cases by their display name rather than their slug", () => {
    const metrics = summarizeCoverageRuns(
      matrix([cell({ runIds: ["a"] })]),
      [run("a")],
      () => "Carom",
    );
    expect(metrics.byCase).toEqual([{ label: "Carom", count: 1 }]);
  });
});

describe("planRunScope", () => {
  it("changes when a cell takes in a run, and only then", () => {
    const before = matrix([cell({ runIds: ["a"] }), cell({ runIds: [] })]);
    const same = matrix([
      cell({ runIds: ["a"], inFlight: 2 }),
      cell({ runIds: [] }),
    ]);
    const after = matrix([cell({ runIds: ["a", "b"] }), cell({ runIds: [] })]);
    expect(planRunScope(same)).toBe(planRunScope(before));
    expect(planRunScope(after)).not.toBe(planRunScope(before));
  });
});

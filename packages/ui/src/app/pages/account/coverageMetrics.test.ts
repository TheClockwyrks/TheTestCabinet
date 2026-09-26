import { describe, expect, it, vi } from "vitest";
import type {
  CoverageCell,
  CoverageMatrix,
} from "@clockwyrks/run-record/coverage";
import type { RunSummary } from "@clockwyrks/run-record/snapshot";
import type { RunQuery, RunQueryResult } from "../../data/runQuery";
import {
  cellMatchKey,
  drainPlanRunSummaries,
  groupLabel,
  planCaseSlugs,
  runMatchKey,
  summarizeCoverageRuns,
} from "./coverageMetrics";

function cell(over: Partial<CoverageCell> = {}): CoverageCell {
  return {
    slug: "pong",
    version: "v1.0.0",
    variant: "base",
    engine: "none",
    harness: "claude",
    model: "claude-sonnet-4-5",
    desired: 3,
    completed: 1,
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
    cellsSatisfied: 0,
    cellsTotal: cells.length,
    runsMissing: 0,
    runsPending: 0,
    runsUnreviewed: 0,
    runsOutstanding: 0,
    bufferTarget: { kind: "bounded", runs: 10 },
  };
}

function run(
  over: Partial<RunSummary["subject"]> = {},
  rest: Partial<RunSummary> = {},
): RunSummary {
  return {
    id: `r-${Math.random()}`,
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
// from the matrix's "how many are there" — so the corpus has to be exactly the plan's
// own runs, folded the ways a reviewer steers by.
describe("summarizeCoverageRuns", () => {
  it("counts only the runs that land on a cell of the plan", () => {
    const m = matrix([cell()]);
    const metrics = summarizeCoverageRuns(
      m,
      [
        run(),
        // The same case, a combination the plan never asked for. Counting it would
        // describe a plan nobody wrote.
        run({ harnessSlug: "codex", modelId: "gpt" }),
        // The plan's combination on a version it does not pin.
        run({ testCaseVersion: "v2.0.0" }),
      ],
      nameOf,
    );
    expect(metrics.total).toBe(1);
    expect(metrics.byCombination).toEqual([
      { label: "claude · claude-sonnet-4-5", count: 1 },
    ]);
  });

  it("separates a cell's engines, which are two cells and two populations", () => {
    const m = matrix([cell(), cell({ engine: "simple-2d" })]);
    const metrics = summarizeCoverageRuns(
      m,
      [run(), run(), run({ engineSlug: "simple-2d" })],
      nameOf,
    );
    expect(metrics.total).toBe(3);
  });

  it("counts a run recorded with no engine as the engineless cell's", () => {
    const metrics = summarizeCoverageRuns(
      matrix([cell()]),
      [run({ engineSlug: "" })],
      nameOf,
    );
    expect(metrics.total).toBe(1);
  });

  it("matches a gg cell by its configuration however the member spelled the id", () => {
    const m = matrix([
      cell({
        harness: "gg",
        model: "opus",
        ggConfigId: "saved:cfg-1",
        ggConfigName: "reviewer",
        ggSlotModels: { primary: "opus" },
      }),
    ]);
    const metrics = summarizeCoverageRuns(
      m,
      [
        run({ harnessSlug: "gg", modelId: "opus", ggConfigId: "cfg-1" }),
        // Another configuration's run of the same case: a different cell entirely.
        run({ harnessSlug: "gg", modelId: "opus", ggConfigId: "cfg-2" }),
      ],
      nameOf,
    );
    expect(metrics.total).toBe(1);
    // Labelled the way its cell is, so the ring and the matrix name one thing.
    expect(metrics.byCombination[0]!.label).toBe("reviewer · opus");
  });

  it("orders the rating breakdown best-first rather than by tally", () => {
    const metrics = summarizeCoverageRuns(
      matrix([cell()]),
      [
        run({}, { rating: "broken" }),
        run({}, { rating: "broken" }),
        run({}, { rating: "flawless" }),
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
      matrix([cell()]),
      [run(), run({}, { rating: "great" })],
      nameOf,
    );
    expect(metrics.total).toBe(2);
    expect(metrics.rated).toBe(1);
  });

  it("counts reviewed runs apart from rated ones", () => {
    // A validator-rated run has a rating from the moment it completes and may carry
    // no review at all, so the two counts are not the same number.
    const metrics = summarizeCoverageRuns(
      matrix([cell()]),
      [
        run({}, { rating: "great", reviewCount: 0 }),
        run({}, { reviewCount: 2 }),
      ],
      nameOf,
    );
    expect(metrics.rated).toBe(1);
    expect(metrics.reviewed).toBe(1);
  });

  it("gives every combination a full per-tier tally, zeros included", () => {
    const m = matrix([cell(), cell({ harness: "codex", model: "gpt" })]);
    const metrics = summarizeCoverageRuns(
      m,
      [
        run({}, { rating: "great" }),
        run({ harnessSlug: "codex", modelId: "gpt" }, { rating: "broken" }),
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

  // A summary card carries the configuration's id and the root model, not the rest of
  // the binding, so two arms of one configuration that differ only on a subagent's
  // model are indistinguishable in the corpus. Naming the group after one of them would
  // put the other's runs under a label that excludes them.
  it("never files one gg arm's runs under another arm's name", () => {
    const armA = cell({
      harness: "gg",
      model: "opus",
      ggConfigId: "saved:cfg-1",
      ggConfigName: "reviewer",
      ggSlotModels: { primary: "opus", critic: "haiku" },
    });
    const armB = cell({
      harness: "gg",
      model: "opus",
      ggConfigId: "saved:cfg-1",
      ggConfigName: "reviewer",
      ggSlotModels: { primary: "opus", critic: "sonnet" },
    });
    const metrics = summarizeCoverageRuns(
      matrix([armA, armB]),
      [run({ harnessSlug: "gg", modelId: "opus", ggConfigId: "cfg-1" })],
      nameOf,
    );
    expect(metrics.total).toBe(1);
    const label = metrics.byCombination[0]!.label;
    expect(label).toBe("reviewer · 2 arms");
    // Specifically not either arm's own models, which would be a false attribution.
    expect(label).not.toMatch(/haiku|sonnet/);
  });

  // The model is one of the segments an ambiguous group is keyed on, so it survives the
  // ambiguity that the bound models do not.
  it("breaks runs down by model as well as by combination", () => {
    const metrics = summarizeCoverageRuns(
      matrix([cell(), cell({ harness: "codex", model: "gpt" })]),
      [run(), run(), run({ harnessSlug: "codex", modelId: "gpt" })],
      nameOf,
    );
    expect(metrics.byModel).toEqual([
      { label: "claude-sonnet-4-5", count: 2 },
      { label: "gpt", count: 1 },
    ]);
  });

  it("names cases by their display name rather than their slug", () => {
    const metrics = summarizeCoverageRuns(
      matrix([cell()]),
      [run()],
      () => "Carom",
    );
    expect(metrics.byCase).toEqual([{ label: "Carom", count: 1 }]);
  });
});

describe("runMatchKey / cellMatchKey", () => {
  it("agrees on a harness cell and the run it counts", () => {
    expect(runMatchKey(run())).toBe(cellMatchKey(cell()));
  });

  it("separates two configurations whose runs share a root model", () => {
    const a = cell({ harness: "gg", model: "opus", ggConfigId: "cfg-1" });
    const b = cell({ harness: "gg", model: "opus", ggConfigId: "cfg-2" });
    expect(cellMatchKey(a)).not.toBe(cellMatchKey(b));
  });
});

describe("groupLabel", () => {
  it("names a lone cell exactly as the matrix does", () => {
    expect(groupLabel([cell()])).toBe("claude · claude-sonnet-4-5");
  });

  it("names an ambiguous group by its configuration and how many arms it stands for", () => {
    const arm = cell({
      harness: "gg",
      model: "opus",
      ggConfigId: "saved:cfg-1",
      ggConfigName: "reviewer",
    });
    expect(groupLabel([arm, arm])).toBe("reviewer · 2 arms");
  });
});

describe("planCaseSlugs", () => {
  it("names each case once, however many combinations cross it", () => {
    expect(
      planCaseSlugs(
        matrix([cell(), cell({ harness: "codex" }), cell({ slug: "caldera" })]),
      ),
    ).toEqual(["pong", "caldera"]);
  });
});

// A drain that advanced by what it asked for rather than by what arrived would leave
// holes in the corpus, and every breakdown computed from it would silently understate.
describe("drainPlanRunSummaries", () => {
  it("advances by the rows that arrived, not the window it asked for", async () => {
    const rows = Array.from({ length: 5 }, () => run());
    const query = vi.fn(
      async (q: RunQuery): Promise<RunQueryResult> => ({
        // A host free to clamp the window: three rows for a request of two hundred.
        summaries: rows.slice(q.offset ?? 0, (q.offset ?? 0) + 3),
        total: rows.length,
      }),
    );
    const corpus = await drainPlanRunSummaries(query, ["pong"]);
    expect(corpus.summaries).toHaveLength(5);
    expect(corpus.truncated).toBe(false);
    expect(query.mock.calls[1]![0].offset).toBe(3);
  });

  it("asks for the plan's whole case scope in one listing", async () => {
    const seen: RunQuery[] = [];
    const query = async (q: RunQuery): Promise<RunQueryResult> => {
      seen.push(q);
      return { summaries: [], total: 0 };
    };
    await drainPlanRunSummaries(query, ["pong", "caldera"]);
    expect(seen).toHaveLength(1);
    const q = seen[0]!;
    expect(q.testCases).toEqual(["pong", "caldera"]);
    // Every recorded run, published or not: a run occupies a cell and holds a review
    // buffer slot long before it is published.
    expect(q.state).toBe("any");
    // A plan pinned to an older version has every one of its runs on that version.
    expect(q.latestVersions).toBe(false);
  });

  it("asks nothing at all of a plan with no cases", async () => {
    const query = vi.fn();
    const corpus = await drainPlanRunSummaries(query, []);
    expect(query).not.toHaveBeenCalled();
    expect(corpus.summaries).toEqual([]);
  });

  // Runs land while the drain walks, and a newest-first listing shifts every row down
  // as they do — so the row on a page boundary comes back on the next page too. Counted
  // twice it inflates every figure computed from the corpus.
  it("counts a run that straddles a page boundary once", async () => {
    const dup = run();
    const query = async (q: RunQuery): Promise<RunQueryResult> => {
      const page = (q.offset ?? 0) === 0 ? [run(), dup] : [dup, run()];
      return { summaries: page, total: 4 };
    };
    const corpus = await drainPlanRunSummaries(query, ["pong"]);
    expect(corpus.summaries).toHaveLength(3);
    expect(new Set(corpus.summaries.map((r) => r.id)).size).toBe(3);
  });

  it("stops rather than looping when a host reports fewer rows than it has", async () => {
    // `total` overstates what the host will ever serve; an empty page has to end the
    // drain or the dashboard hangs on a plan nobody can fix.
    const query = vi.fn(
      async (): Promise<RunQueryResult> => ({
        summaries: [],
        total: 99,
      }),
    );
    const corpus = await drainPlanRunSummaries(query, ["pong"]);
    expect(corpus.summaries).toEqual([]);
    expect(query).toHaveBeenCalledTimes(1);
  });
});

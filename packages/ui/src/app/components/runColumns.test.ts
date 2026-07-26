import type { RunSummary } from "@test-cabinet/run-record/snapshot";
import { describe, expect, it } from "vitest";
import type { Rating } from "../data/ratings";
import { columnsForScope, sortRuns, type EnrichedRun } from "./runColumns";

// A minimal enriched run carrying only the fields the column sort keys read.
function run(
  id: string,
  opts: { rating?: Rating | null; tokens?: number | null } = {},
): EnrichedRun {
  const { rating = null, tokens = null } = opts;
  return {
    summary: {
      id,
      startedAt: "2026-01-01T00:00:00Z",
      finishedAt: "2026-01-01T00:00:00Z",
      subject: {
        testType: "end-to-end",
        harnessSlug: "h",
        variant: "v",
        modelId: "m",
      },
      metrics: {
        runTimeSeconds: 0,
        tokens: {
          uncachedInput: tokens,
          cachedInput: null,
          output: null,
          reasoning: null,
        },
        cost: { comparable: null },
      },
      state: "completed",
    } as unknown as RunSummary,
    local: false,
    displayName: id,
    modelName: id,
    rating,
    grade: null,
  };
}

describe("columnsForScope", () => {
  it("drops test and variant for the variant scope", () => {
    const ids = columnsForScope("variant").map((c) => c.id);
    expect(ids).not.toContain("test");
    expect(ids).not.toContain("variant");
    expect(ids).toContain("model");
  });

  it("drops model for the model scope but keeps test and variant", () => {
    const ids = columnsForScope("model").map((c) => c.id);
    expect(ids).not.toContain("model");
    expect(ids).toContain("test");
    expect(ids).toContain("variant");
  });

  it("offers every column for the global scope, including the optional ones", () => {
    const ids = columnsForScope("global").map((c) => c.id);
    expect(ids).toEqual(
      expect.arrayContaining(["timestamp", "category", "duration", "version"]),
    );
  });
});

describe("sortRuns", () => {
  it("orders by rating best-first ascending, unrated last", () => {
    const rows = [
      run("broken", { rating: "broken" }),
      run("flawless", { rating: "flawless" }),
      run("unrated", { rating: null }),
      run("great", { rating: "great" }),
    ];
    const asc = sortRuns(rows, { columnId: "rating", direction: "asc" });
    expect(asc.map((r) => r.summary.id)).toEqual([
      "flawless",
      "great",
      "broken",
      "unrated",
    ]);
    // Descending flips the rated runs but still parks the unrated one last.
    const desc = sortRuns(rows, { columnId: "rating", direction: "desc" });
    expect(desc.map((r) => r.summary.id)).toEqual([
      "broken",
      "great",
      "flawless",
      "unrated",
    ]);
  });

  it("orders by token total, with unreported totals last", () => {
    const rows = [
      run("mid", { tokens: 500 }),
      run("none", { tokens: null }),
      run("low", { tokens: 100 }),
    ];
    const asc = sortRuns(rows, { columnId: "tokens", direction: "asc" });
    expect(asc.map((r) => r.summary.id)).toEqual(["low", "mid", "none"]);
  });
});

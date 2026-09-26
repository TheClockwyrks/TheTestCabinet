// The built-in overview board is **ordinary query text**, and this is the test that makes
// that claim worth something.
//
// The reason the board is defined as text rather than as a hardcoded breakdown is that a
// hardcoded breakdown keeps rendering after a field is renamed — just wrong. Text can rot
// the same way, so it is pinned here: every panel parses without a diagnostic, compiles to
// a query the evaluator accepts, and names only fields the document builder actually emits.
// A field rename that nobody propagated fails here rather than on somebody's screen.
import { describe, expect, it } from "vitest";
import type { GgRunDoc } from "@clockwyrks/run-record/gg-query";
import { compileQuery, evaluate, parseQuery } from "../query";
import { OVERVIEW_DASHBOARD } from "./overviewDashboard";
import { compilePanels } from "./dashboardQueries";
import { rangeById } from "../discover/TimeRangePicker";

/**
 * A corpus that exercises every field the board names, plus one run that carries no
 * session summary at all — the shape whose existence is the reason the two rate panels
 * spell out a `has.summary:true` denominator.
 */
const CORPUS: GgRunDoc[] = [
  {
    fields: {
      id: "a",
      started: Date.UTC(2026, 6, 1),
      state: "completed",
      model: "anthropic/claude",
      preset: "baseline",
      limit: "none",
      score: 0.8,
      "metric.runTimeSeconds": 900,
      "metric.sessionSeconds": 300,
      "metric.cost": 1.25,
      "has.summary": true,
      "summary.ranOutOfContext": false,
    },
  },
  {
    fields: {
      id: "b",
      started: Date.UTC(2026, 6, 2),
      state: "timed_out",
      model: "openai/gpt",
      preset: "no-compaction",
      limit: "wallClock",
      score: 0.2,
      "metric.runTimeSeconds": 7200,
      "metric.sessionSeconds": 3600,
      "metric.cost": 9.5,
      "has.summary": true,
      "summary.ranOutOfContext": true,
    },
  },
  // No summary, no metrics: the run that would silently shrink a rate's denominator.
  {
    fields: {
      id: "c",
      started: Date.UTC(2026, 6, 3),
      state: "infra_error",
      "has.summary": false,
    },
  },
  // A run recorded before stage durations were measured: it carries the whole run's
  // wall clock and no session duration at all.
  {
    fields: {
      id: "d",
      started: Date.UTC(2026, 6, 4),
      state: "completed",
      model: "legacy/model",
      preset: "baseline",
      limit: "none",
      score: 0.5,
      "metric.runTimeSeconds": 1800,
      "metric.cost": 2.0,
      "has.summary": true,
      "summary.ranOutOfContext": false,
    },
  },
];

describe("the built-in overview dashboard", () => {
  it("has eight panels, each within the twelve-column grid", () => {
    expect(OVERVIEW_DASHBOARD.panels).toHaveLength(8);
    for (const panel of OVERVIEW_DASHBOARD.panels) {
      expect(panel.title.trim()).not.toBe("");
      expect(panel.width).toBeGreaterThanOrEqual(1);
      expect(panel.width).toBeLessThanOrEqual(12);
    }
  });

  it("parses every panel with no diagnostics", () => {
    for (const panel of OVERVIEW_DASHBOARD.panels) {
      const parse = parseQuery(panel.query);
      expect(
        parse.diagnostics.map((d) => d.message),
        `panel "${panel.title}"`,
      ).toEqual([]);
    }
  });

  it("evaluates every panel to a real aggregation over a corpus", () => {
    for (const panel of OVERVIEW_DASHBOARD.panels) {
      const result = evaluate(
        CORPUS,
        compileQuery(parseQuery(panel.query).query),
      );
      // Every panel is an aggregation, so every one comes back with columns and at
      // least one bucket — a panel that silently produced a document list would be a
      // wall of rows in a quarter-width card.
      expect(
        result.columns?.length ?? 0,
        `panel "${panel.title}"`,
      ).toBeGreaterThan(0);
      expect(
        result.buckets?.length ?? 0,
        `panel "${panel.title}"`,
      ).toBeGreaterThan(0);
    }
  });

  it("spells its rate denominator rather than inheriting one", () => {
    // Averaging a boolean is a rate, and `has.summary` is its denominator. Without the
    // clause, the run that never produced a summary would be counted in neither the
    // numerator nor the denominator — a rate over a population nobody chose.
    const overflow = OVERVIEW_DASHBOARD.panels.find((p) =>
      p.query.includes("summary.ranOutOfContext"),
    );
    expect(overflow?.query).toContain("has.summary:true");
  });

  it("plots the harness session, not the run's whole wall clock", () => {
    // The run time covers the container setup every run of a test case shares, and
    // that setup dominates a short run — so a median of it by model would compare
    // mostly setup to itself. The panel that describes a model reads the session.
    const panel = OVERVIEW_DASHBOARD.panels.find((p) =>
      p.title.includes("session length"),
    );
    expect(panel?.query).toContain("metric.sessionSeconds");
    expect(panel?.query).not.toContain("metric.runTimeSeconds");

    const result = evaluate(
      CORPUS,
      compileQuery(parseQuery(panel!.query).query),
    );
    const medians = new Map(
      (result.buckets ?? []).map((bucket) => [
        bucket.key[0]?.value,
        bucket.values[0]?.value,
      ]),
    );
    expect(medians.get("anthropic/claude")).toBe(300);
    expect(medians.get("openai/gpt")).toBe(3600);
    // Absent, never zero: a run that recorded no session duration contributes
    // nothing rather than dragging its model's median to zero.
    expect(medians.get("legacy/model")).toBeUndefined();
  });

  it("draws its histogram at the board range's interval, not the text's", () => {
    const [first] = compilePanels(
      [OVERVIEW_DASHBOARD.panels[0]!],
      rangeById("1y"),
      Date.UTC(2026, 7, 1),
    );
    expect(first?.query.stats?.groupBy?.[0]).toMatchObject({
      kind: "bucket",
      field: "started",
      interval: { count: 1, unit: "week" },
    });
  });
});

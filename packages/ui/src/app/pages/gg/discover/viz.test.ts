// Which chart a TCQ result gets, and — more importantly — what a chart is not
// allowed to draw.
//
// Driven through the real parser and evaluator rather than hand-built buckets,
// because the claim under test is about what an operator sees for a query they
// typed, and a hand-built bucket list can be given any shape the assertion wants.
// The two places that *do* build buckets by hand are the ones that have to defeat
// the evaluator's own ordering guarantee to prove the chart is robust without it.
import { describe, expect, it } from "vitest";
import type {
  GgBucket,
  GgGroupKey,
  GgRunDoc,
} from "@test-cabinet/run-record/gg-query";
import { CATEGORICAL_COLORS } from "@test-cabinet/ui";
import { compileQuery, evaluate, parseQuery } from "../query";
import { MAX_BARS, MAX_SERIES, chooseVisualizations } from "./viz";

const day = (n: number, hour = 0) => Date.UTC(2026, 6, n, hour);

/** Six runs over four days, two presets, two models — and one field only half the
 *  corpus carries, so "absent is not zero" has something to be tested against. */
const CORPUS: GgRunDoc[] = [
  {
    fields: {
      id: "a",
      started: day(1, 1),
      preset: "planning",
      model: "anthropic/opus",
      score: 0.8,
      "metric.cost": 1.5,
      "summary.ranOutOfContext": false,
    },
  },
  {
    fields: {
      id: "b",
      started: day(1, 5),
      preset: "planning",
      model: "anthropic/opus",
      score: 0.4,
      "metric.cost": 2.5,
      // No `summary.*`: this run never opened a session, so it contributes no
      // denominator to a rate over that field.
    },
  },
  {
    fields: {
      id: "c",
      started: day(2, 3),
      preset: "baseline",
      model: "openai/gpt",
      score: 0.6,
      "metric.cost": 0.5,
      "summary.ranOutOfContext": true,
    },
  },
  {
    fields: {
      id: "d",
      started: day(3, 9),
      preset: "baseline",
      model: "openai/gpt",
      score: 0.2,
      "metric.cost": 3,
      "summary.ranOutOfContext": true,
    },
  },
  {
    fields: {
      id: "e",
      started: day(4, 2),
      preset: "planning",
      model: "anthropic/opus",
      score: 1,
      "metric.cost": 0.25,
      "summary.ranOutOfContext": false,
    },
  },
  {
    fields: {
      id: "f",
      started: day(4, 8),
      preset: "baseline",
      model: "google/gemini",
      score: 0.5,
      "metric.cost": 4,
    },
  },
];

/** Evaluate query text and choose its visualizations. */
function viz(text: string) {
  const query = compileQuery(parseQuery(text).query);
  const result = evaluate(CORPUS, query);
  return chooseVisualizations(
    result.buckets ?? [],
    result.columns ?? [],
    query.stats?.groupBy,
  );
}

describe("choosing a form", () => {
  it("gives a single figure a stat tile, not a one-bar chart", () => {
    // A lone bar encodes a magnitude against nothing — the figure is the answer.
    const [first, ...rest] = viz("| stats count()");
    expect(first?.kind).toBe("tiles");
    expect(rest).toEqual([]);
  });

  it("gives an ordinary field key bars in one hue, identity on the axis", () => {
    const [chart] = viz("| stats avg(score) by preset");
    expect(chart?.kind).toBe("bars");
    if (chart?.kind !== "bars") throw new Error("expected bars");
    expect(chart.points.map((p) => p.label).sort()).toEqual([
      "baseline",
      "planning",
    ]);
    // No per-bar color: `barChart` falls back to the theme accent, so every bar
    // wears one hue and a categorical hue is not spent on an axis label.
    expect(chart.points.every((p) => p.color === undefined)).toBe(true);
  });

  it("gives a date histogram a time series over real instants", () => {
    const [chart] = viz("| stats count() by bucket(started, 1d)");
    expect(chart?.kind).toBe("series");
    if (chart?.kind !== "series") throw new Error("expected series");
    // `Date`s, not formatted strings. Plotting a formatted bucket label on a band
    // scale is exactly the substitution that turns a time series into a zigzag.
    expect(chart.points.every((p) => p.time instanceof Date)).toBe(true);
    expect(chart.points.map((p) => p.time.getTime())).toContain(day(1));
  });

  it("gives dist() box plots, with no confidence interval", () => {
    const [chart] = viz("| stats dist(score) by preset");
    expect(chart?.kind).toBe("distribution");
    if (chart?.kind !== "distribution") throw new Error("expected distribution");
    // TCQ carries no bootstrap interval, which is why the chart's bounds are
    // optional — the honest rendering of "no interval" is no mark.
    expect(chart.groups.every((g) => g.ciLow === undefined)).toBe(true);
    expect(chart.groups.every((g) => g.ciHigh === undefined)).toBe(true);
    // And no invented raw points behind a summary that has none.
    expect(chart.groups.every((g) => g.points.length === 0)).toBe(true);
    expect(chart.groups.reduce((n, g) => n + g.n, 0)).toBe(CORPUS.length);
  });

  it("draws nothing for an un-aggregated result", () => {
    expect(viz("preset:planning")).toEqual([]);
  });
});

describe("two aggregations are two charts, never a dual axis", () => {
  it("returns one chart per column", () => {
    const charts = viz("| stats avg(score), avg(metric.cost) by preset");
    expect(charts).toHaveLength(2);
    expect(charts.map((c) => c.kind)).toEqual(["bars", "bars"]);
    // Each frame carries exactly one measure, so no reader can see a crossover that
    // is an artifact of two arbitrary scalings.
    expect(charts.map((c) => (c.kind === "bars" ? c.yLabel : ""))).toEqual([
      "avg(score)",
      "avg(metric.cost)",
    ]);
  });

  it("collapses a single bucket's scalar columns into one tile row", () => {
    const [first, ...rest] = viz("| stats count(), avg(score)");
    expect(first?.kind).toBe("tiles");
    if (first?.kind !== "tiles") throw new Error("expected tiles");
    expect(first.tiles.map((t) => t.label)).toEqual(["count()", "avg(score)"]);
    expect(rest).toEqual([]);
  });
});

describe("a second group key", () => {
  it("stacks an additive aggregation", () => {
    const [chart] = viz("| stats count() by preset, model");
    expect(chart?.kind).toBe("stacked");
    if (chart?.kind !== "stacked") throw new Error("expected stacked");
    expect(chart.series.map((s) => s.name).sort()).toEqual([
      "anthropic/opus",
      "google/gemini",
      "openai/gpt",
    ]);
    // The parts sum to the whole, which is the only thing that makes a stack legal.
    expect(chart.segments.reduce((n, s) => n + s.value, 0)).toBe(CORPUS.length);
  });

  it("refuses to stack a non-additive one", () => {
    // Stacking averages draws a total that measures nothing. The composite key goes
    // on the axis instead, where a bar claims nothing about its neighbours.
    const [chart] = viz("| stats avg(score) by preset, model");
    expect(chart?.kind).toBe("bars");
    if (chart?.kind !== "bars") throw new Error("expected bars");
    expect(chart.points.map((p) => p.label)).toContain("planning · anthropic/opus");
  });

  it("splits a date histogram into one line per second-key value", () => {
    const [chart] = viz("| stats count() by bucket(started, 1d), preset");
    expect(chart?.kind).toBe("series");
    if (chart?.kind !== "series") throw new Error("expected series");
    expect(chart.series.map((s) => s.name).sort()).toEqual([
      "baseline",
      "planning",
    ]);
    expect(new Set(chart.points.map((p) => p.series))).toEqual(
      new Set(["baseline", "planning"]),
    );
  });
});

describe("absent is dropped, never charted as zero", () => {
  it("leaves a bucket with no value out of the chart and counts it", () => {
    // `google/gemini`'s only run carries no `summary.*`, so its bucket has no
    // average — and an average over nothing is not an average of zero.
    const [chart] = viz("| stats avg(summary.ranOutOfContext) by model");
    if (chart?.kind !== "bars") throw new Error("expected bars");
    expect(chart.points.map((p) => p.label)).not.toContain("google/gemini");
    expect(chart.points.every((p) => p.value !== 0 || p.label === "anthropic/opus"))
      .toBe(true);
    expect(chart.note.dropped).toBe(1);
  });

  it("draws nothing at all when every value is absent", () => {
    // Better no chart than a row of zero-height bars implying a corpus-wide zero.
    expect(viz("| stats avg(code.functions.total) by preset")).toEqual([]);
  });

  it("keeps a genuine zero", () => {
    // The rule is about *absence*, not about the value 0: `anthropic/opus` really
    // did overflow on none of its runs, and that bar belongs on the chart.
    const [chart] = viz("| stats avg(summary.ranOutOfContext) by model");
    if (chart?.kind !== "bars") throw new Error("expected bars");
    const opus = chart.points.find((p) => p.label === "anthropic/opus");
    expect(opus?.value).toBe(0);
  });

  it("reports the denominator in a mark's tooltip", () => {
    // `contributing` is the denominator; a chart hides the number behind a mark, so
    // the tooltip is where it has to surface.
    const [chart] = viz("| stats avg(summary.ranOutOfContext) by preset");
    if (chart?.kind !== "bars") throw new Error("expected bars");
    const planning = chart.points.find((p) => p.label === "planning");
    expect(planning?.title).toContain("2 of 3 runs");
  });

  it("carries the denominator on a single-bucket tile's label", () => {
    const [first] = viz("| stats avg(summary.ranOutOfContext)");
    if (first?.kind !== "tiles") throw new Error("expected tiles");
    expect(first.tiles[0]?.denominator).toBe("4/6");
  });
});

describe("caps", () => {
  /** A synthetic bucket list of `n` groups, so the caps can be reached without a
   *  corpus of a hundred runs. */
  function buckets(n: number, field: string): GgBucket[] {
    return Array.from({ length: n }, (_, i) => ({
      key: [{ field, value: `v${String(i).padStart(3, "0")}` }],
      n: n - i,
      values: [{ name: "count()", contributing: n - i, value: n - i }],
    }));
  }
  const countColumn = [{ name: "count()", func: "count" as const }];
  const byField: GgGroupKey[] = [{ kind: "field", field: "model" }];

  it("caps the bars and says how many it left out", () => {
    const [chart] = chooseVisualizations(
      buckets(MAX_BARS + 7, "model"),
      countColumn,
      byField,
    );
    if (chart?.kind !== "bars") throw new Error("expected bars");
    expect(chart.points).toHaveLength(MAX_BARS);
    expect(chart.note.hiddenBuckets).toBe(7);
    // The kept bars are the largest, which is what count-descending bucket order
    // already put first.
    expect(chart.points[0]?.value).toBe(MAX_BARS + 7);
  });

  it("caps the series at the palette and never recycles a hue", () => {
    const groupBy: GgGroupKey[] = [
      { kind: "field", field: "preset" },
      { kind: "field", field: "model" },
    ];
    const many: GgBucket[] = Array.from({ length: MAX_SERIES + 3 }, (_, i) => ({
      key: [
        { field: "preset", value: "planning" },
        { field: "model", value: `m${i}` },
      ],
      n: MAX_SERIES + 3 - i,
      values: [
        {
          name: "count()",
          contributing: MAX_SERIES + 3 - i,
          value: MAX_SERIES + 3 - i,
        },
      ],
    }));
    const [chart] = chooseVisualizations(many, countColumn, groupBy);
    if (chart?.kind !== "stacked") throw new Error("expected stacked");
    expect(chart.series).toHaveLength(MAX_SERIES);
    expect(chart.note.hiddenSeries).toBe(3);
    // Six entities, six distinct validated hues — a seventh entity is left out
    // rather than given a colour another entity already owns.
    expect(new Set(chart.series.map((s) => s.color)).size).toBe(MAX_SERIES);
    expect(chart.series.map((s) => s.color)).toEqual(
      CATEGORICAL_COLORS.slice(0, MAX_SERIES),
    );
    // ...and the segments it could not colour are counted, not silently dropped.
    expect(chart.segments).toHaveLength(MAX_SERIES);
    expect(chart.note.hiddenBuckets).toBe(3);
  });
});

describe("chronology survives a hostile bucket order", () => {
  const histogram: GgGroupKey[] = [
    { kind: "bucket", field: "started", interval: { count: 1, unit: "day" } },
  ];
  const countColumn = [{ name: "count()", func: "count" as const }];

  it("keeps the histogram key as an instant, not a label", () => {
    // Deliberately count descending — what the evaluator returns for *every* other
    // group key, and what a future ordering change could return for this one. The
    // chart must not depend on the input order for its axis to be chronological, so
    // what it is handed has to stay a number of milliseconds all the way through.
    const shuffled: GgBucket[] = [
      { key: [{ field: "started", value: day(4) }], n: 9, values: [count(9)] },
      { key: [{ field: "started", value: day(1) }], n: 5, values: [count(5)] },
      { key: [{ field: "started", value: day(3) }], n: 2, values: [count(2)] },
    ];
    const [chart] = chooseVisualizations(shuffled, countColumn, histogram);
    if (chart?.kind !== "series") throw new Error("expected series");
    expect(chart.points.map((p) => p.time.getTime())).toEqual([
      day(4),
      day(1),
      day(3),
    ]);
    // The chart primitive is what sorts (`timeSeriesChart`), and it can only do that
    // because these are instants rather than strings — which is the property this
    // asserts.
    expect(chart.points.every((p) => p.time instanceof Date)).toBe(true);
  });

  it("drops a histogram bucket with no instant rather than placing it at zero", () => {
    // The bucket whose documents all *lack* the bucketed field has no position on a
    // time axis at all; epoch zero is a place, and it is 1970.
    const withAbsent: GgBucket[] = [
      { key: [{ field: "started", value: day(1) }], n: 5, values: [count(5)] },
      { key: [{ field: "started" }], n: 2, values: [count(2)] },
    ];
    const [chart] = chooseVisualizations(withAbsent, countColumn, histogram);
    if (chart?.kind !== "series") throw new Error("expected series");
    expect(chart.points).toHaveLength(1);
    expect(chart.note.hiddenBuckets).toBe(1);
  });

  function count(n: number) {
    return { name: "count()", contributing: n, value: n };
  }
});

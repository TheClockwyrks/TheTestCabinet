import * as Plot from "@observablehq/plot";
import { describe, expect, it } from "vitest";
import {
  barChart,
  distributionChart,
  metricLineChart,
  stackedAreaChart,
  stackedBarChart,
  timeSeriesChart,
  type TimeSeriesPoint,
} from "./charts";
import type { ChartPalette } from "./theme";

// A stand-in palette; these tests assert structure, not exact colors.
const palette: ChartPalette = {
  text: "#fff",
  muted: "#aaa",
  border: "#333",
  surface: "#000",
  accent: "#f90",
  accent2: "#f30",
};

// Render a spec's Plot options to a DOM node under jsdom, so we exercise the real
// Plot pipeline (marks, scales, tips) the app relies on — the part most likely to
// break on a Plot API change.
function render(options: Plot.PlotOptions): Element {
  return Plot.plot(options) as unknown as Element;
}

describe("barChart", () => {
  it("draws a bar per point", () => {
    const node = render(
      barChart(
        [
          { label: "A", value: 3 },
          { label: "B", value: 5 },
        ],
        palette,
      ),
    );
    expect(node.querySelectorAll("rect").length).toBeGreaterThanOrEqual(2);
  });

  it("renders with hover tips when a bar carries a title, without throwing", () => {
    const node = render(
      barChart(
        [
          { label: "A", value: 3, title: "A\nMax: 4\nMin: 2" },
          { label: "B", value: 5, title: "B\nMax: 6\nMin: 4" },
        ],
        palette,
        { xTickRotate: -40, y: "tokens" },
      ),
    );
    // The tip mark is registered (Plot labels its tip layer), so hover content is
    // wired up rather than silently dropped.
    const tip = node.querySelector('[aria-label="tip"]');
    expect(tip).not.toBeNull();
    // The tip box (drawn on hover, inheriting the tip group's fill) is the theme
    // surface, not Plot's default white — so the light chart text reads against it
    // rather than light-on-white.
    expect(tip!.getAttribute("fill")).toBe(palette.surface);
    expect(tip!.getAttribute("stroke")).toBe(palette.border);
    // The hover-highlight overlay is present (a translucent wash keyed to the same
    // pointer as the tip), so the bar reacts wherever the tooltip appears.
    expect(node.querySelector('[fill-opacity="0.18"]')).not.toBeNull();
  });
});

describe("stackedBarChart", () => {
  const series = [
    { name: "Flawless", color: "#22d3ee" },
    { name: "Great", color: "#4ade80" },
    { name: "Scuffed", color: "#fbbf24" },
    { name: "Broken", color: "#f87171" },
  ];

  it("stacks a segment per (group, tier) and labels every series in the legend", () => {
    const node = render(
      stackedBarChart(
        [
          { group: "Model A", series: "Flawless", value: 2, title: "A" },
          { group: "Model A", series: "Broken", value: 1, title: "A" },
          { group: "Model B", series: "Great", value: 3, title: "B" },
        ],
        palette,
        series,
        { y: "runs", xTickRotate: -40 },
      ),
    );
    // Three segments drawn.
    expect(node.querySelectorAll("rect").length).toBeGreaterThanOrEqual(3);
    // The legend lists every tier, even ones with no runs (the color domain is
    // fixed), so it reads as a complete key.
    const text = node.textContent ?? "";
    for (const s of series) {
      expect(text).toContain(s.name);
    }
  });

  it("wires up hover tips for the segments", () => {
    const node = render(
      stackedBarChart(
        [{ group: "Model A", series: "Great", value: 1, title: "A\nGreat: 1" }],
        palette,
        series,
      ),
    );
    expect(node.querySelector('[aria-label="tip"]')).not.toBeNull();
    // The hover-highlight overlay for the pointed segment is present too.
    expect(node.querySelector('[fill-opacity="0.18"]')).not.toBeNull();
  });

  // Groups that are numbers-as-strings must not be sorted as strings: without a
  // stated domain Plot orders "100" before "70" and scrambles the progression.
  const numeric = [
    { group: "70", series: "Great", value: 1 },
    { group: "100", series: "Great", value: 1 },
    { group: "119", series: "Great", value: 1 },
  ];

  const xLabels = (node: Element) =>
    [...node.querySelectorAll('[aria-label="x-axis tick label"] text')].map(
      (t) => t.textContent,
    );

  it("keeps the bar order it is given rather than sorting the groups", () => {
    const node = render(
      stackedBarChart(numeric, palette, series, {
        xDomain: ["70", "100", "119"],
      }),
    );
    expect(xLabels(node)).toEqual(["70", "100", "119"]);
  });

  it("labels only the requested groups, for an axis with more bars than room", () => {
    const node = render(
      stackedBarChart(numeric, palette, series, {
        xDomain: ["70", "100", "119"],
        xTicks: ["70", "119"],
      }),
    );
    expect(xLabels(node)).toEqual(["70", "119"]);
  });
});

describe("stackedAreaChart", () => {
  const series = [
    { name: "System", color: "#6ea8fe" },
    { name: "Tool output", color: "#ff924c" },
  ];
  const points = [
    { x: 0, series: "System", value: 100 },
    { x: 0, series: "Tool output", value: 40 },
    { x: 1, series: "System", value: 100 },
    { x: 1, series: "Tool output", value: 90 },
  ];

  it("draws a band per series over the x progression", () => {
    const node = render(stackedAreaChart(points, palette, series));
    // One filled path per band.
    expect(node.querySelectorAll("path").length).toBeGreaterThanOrEqual(2);
  });

  it("stays free of a tip when no point carries one", () => {
    const node = render(stackedAreaChart(points, palette, series));
    expect(node.querySelector('[aria-label="tip"]')).toBeNull();
  });

  const titled = points.map((p) => ({ ...p, title: `Turn ${p.x}` }));

  it("wires up hover tips, and the rule marking the hovered x, when points carry titles", () => {
    const node = render(stackedAreaChart(titled, palette, series));
    const tip = node.querySelector('[aria-label="tip"]');
    expect(tip).not.toBeNull();
    // The themed tip box, so the light chart text reads against it.
    expect(tip!.getAttribute("fill")).toBe(palette.surface);
    expect(tip!.getAttribute("stroke")).toBe(palette.border);
    // The pointer rule that marks which x the tip is describing.
    expect(node.querySelector('[stroke-opacity="0.45"]')).not.toBeNull();
  });

  // A y ceiling makes Plot clip every mark, which nests each one inside a
  // clip-path group — the tip and its rule must survive that reframing.
  it("keeps the tip and its rule when the plot is framed to a y ceiling", () => {
    const node = render(
      stackedAreaChart(titled, palette, series, {
        yTickFormat: "~s",
        yMax: 500,
        reference: { value: 400, label: "window limit" },
        markers: [{ x: 1, label: "compacted" }],
      }),
    );
    expect(node.querySelector('[aria-label="tip"]')).not.toBeNull();
    expect(node.querySelector('[stroke-opacity="0.45"]')).not.toBeNull();
  });
});

describe("metricLineChart", () => {
  const points = [
    { turn: 0, value: 12 },
    { turn: 1, value: 30 },
    { turn: 2, value: 24 },
  ];

  it("draws the line and a dot per observation", () => {
    const node = render(metricLineChart(points, palette));
    expect(node.querySelectorAll("circle").length).toBeGreaterThanOrEqual(3);
  });

  it("stays free of a tip when no point carries one", () => {
    const node = render(metricLineChart(points, palette));
    expect(node.querySelector('[aria-label="tip"]')).toBeNull();
  });

  it("wires up hover tips, the crosshair, and the widened dot when points carry titles", () => {
    const titled = points.map((p) => ({
      ...p,
      title: `Turn ${p.turn}\n${p.value} tok/s`,
    }));
    const node = render(
      metricLineChart(titled, palette, { yTickFormat: "~s", color: "#8ac926" }),
    );
    const tip = node.querySelector('[aria-label="tip"]');
    expect(tip).not.toBeNull();
    expect(tip!.getAttribute("fill")).toBe(palette.surface);
    // The crosshair rule at the pointed turn.
    expect(node.querySelector('[stroke-opacity="0.45"]')).not.toBeNull();
    // ...and the widened dot layer for the selected observation (it draws no
    // circle until the pointer selects one, so its group is what to look for).
    expect(
      node.querySelector('[aria-label="dot"][stroke-width="1.5"]'),
    ).not.toBeNull();
  });

  it("renders a one-point history with tips without throwing", () => {
    expect(() =>
      render(
        metricLineChart([{ turn: 3, value: 1, title: "Turn 3" }], palette),
      ),
    ).not.toThrow();
  });
});

describe("timeSeriesChart", () => {
  const day = (n: number) => new Date(Date.UTC(2026, 6, n));
  const oneSeries = [{ name: "", color: "#ff9d2f" }];

  // The x coordinates of a drawn polyline, in the order the path visits them. This
  // is the only way to see what a line actually did: the mark's own data can be
  // sorted correctly and still be drawn in input order if the sort never reached the
  // mark, so the assertion has to read the geometry.
  function lineXs(node: Element): number[][] {
    return [...node.querySelectorAll('[aria-label="line"] path')].map((path) => {
      const d = path.getAttribute("d") ?? "";
      const coords = [...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)];
      return coords.map((m) => Number(m[1]));
    });
  }

  it("draws a line and a dot per observation", () => {
    const node = render(
      timeSeriesChart(
        [
          { time: day(1), series: "", value: 4 },
          { time: day(2), series: "", value: 9 },
          { time: day(3), series: "", value: 2 },
        ],
        palette,
        oneSeries,
      ),
    );
    expect(node.querySelectorAll("circle").length).toBeGreaterThanOrEqual(3);
    expect(lineXs(node)).toHaveLength(1);
  });

  // The failure this chart exists to prevent. A date histogram's buckets do not
  // arrive in time order in general — TCQ's default bucket order is count descending
  // — and a chart that plots them on a categorical axis in input order draws a
  // zigzag between unrelated instants instead of a time series. Feeding the builder
  // a deliberately shuffled, count-descending bucket list must still produce a
  // strictly left-to-right polyline.
  it("draws chronologically from an out-of-order (count-descending) input", () => {
    const shuffled: TimeSeriesPoint[] = [
      { time: day(4), series: "", value: 90 },
      { time: day(1), series: "", value: 50 },
      { time: day(6), series: "", value: 30 },
      { time: day(2), series: "", value: 10 },
      { time: day(5), series: "", value: 5 },
    ];
    const node = render(timeSeriesChart(shuffled, palette, oneSeries));
    const [xs] = lineXs(node);
    expect(xs).toHaveLength(shuffled.length);
    for (let i = 1; i < xs!.length; i += 1) {
      expect(xs![i]).toBeGreaterThan(xs![i - 1]!);
    }
  });

  // The same guarantee has to hold per series, not just globally: a histogram nested
  // under a second group key interleaves two series' buckets, and each line must
  // still run forward in time.
  it("keeps every series chronological when two are interleaved", () => {
    const node = render(
      timeSeriesChart(
        [
          { time: day(3), series: "b", value: 1 },
          { time: day(1), series: "a", value: 2 },
          { time: day(3), series: "a", value: 3 },
          { time: day(1), series: "b", value: 4 },
          { time: day(2), series: "a", value: 5 },
          { time: day(2), series: "b", value: 6 },
        ],
        palette,
        [
          { name: "a", color: "#ff9d2f" },
          { name: "b", color: "#22d3ee" },
        ],
      ),
    );
    const lines = lineXs(node);
    expect(lines).toHaveLength(2);
    for (const xs of lines) {
      expect(xs).toHaveLength(3);
      for (let i = 1; i < xs.length; i += 1) {
        expect(xs[i]).toBeGreaterThan(xs[i - 1]!);
      }
    }
  });

  // A time axis, not a band scale over formatted strings — the substitution that
  // causes the zigzag in the first place. A UTC scale emits date ticks; a band scale
  // over these points would emit one tick per raw label.
  it("puts the observations on a chronological axis", () => {
    const node = render(
      timeSeriesChart(
        [
          { time: day(1), series: "", value: 1 },
          { time: day(20), series: "", value: 2 },
        ],
        palette,
        oneSeries,
      ),
    );
    const ticks = [
      ...node.querySelectorAll('[aria-label="x-axis tick label"] text'),
    ].map((t) => t.textContent);
    // Fewer ticks than a categorical axis would draw is not the assertion — the
    // assertion is that the axis chose its own date ticks rather than echoing the
    // data, which a band scale can never do.
    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks).not.toEqual(["Jul 1", "Jul 20"]);
  });

  it("draws no legend for a single series and one for two", () => {
    const lone = render(
      timeSeriesChart(
        [{ time: day(1), series: "", value: 1 }],
        palette,
        oneSeries,
      ),
    );
    expect(lone.querySelector(".-plot-swatches")).toBeNull();

    const pair = render(
      timeSeriesChart(
        [
          { time: day(1), series: "a", value: 1 },
          { time: day(2), series: "b", value: 2 },
        ],
        palette,
        [
          { name: "a", color: "#ff9d2f" },
          { name: "b", color: "#22d3ee" },
        ],
      ),
    );
    expect(pair.textContent).toContain("a");
    expect(pair.textContent).toContain("b");
  });

  it("wires up hover tips and the crosshair when points carry titles", () => {
    const node = render(
      timeSeriesChart(
        [
          { time: day(1), series: "", value: 1, title: "Jul 1\n1 run" },
          { time: day(2), series: "", value: 2, title: "Jul 2\n2 runs" },
        ],
        palette,
        oneSeries,
        { y: "runs", yTickFormat: "~s" },
      ),
    );
    const tip = node.querySelector('[aria-label="tip"]');
    expect(tip).not.toBeNull();
    expect(tip!.getAttribute("fill")).toBe(palette.surface);
    expect(node.querySelector('[stroke-opacity="0.45"]')).not.toBeNull();
  });

  it("renders a single-bucket series without throwing", () => {
    expect(() =>
      render(
        timeSeriesChart(
          [{ time: day(9), series: "", value: 3 }],
          palette,
          oneSeries,
        ),
      ),
    ).not.toThrow();
  });

  it("does not mutate the caller's array", () => {
    const data: TimeSeriesPoint[] = [
      { time: day(3), series: "", value: 1 },
      { time: day(1), series: "", value: 2 },
    ];
    timeSeriesChart(data, palette, oneSeries);
    expect(data[0]!.time).toEqual(day(3));
  });
});

describe("distributionChart", () => {
  const groups = [
    {
      label: "pi",
      color: "#22d3ee",
      n: 3,
      points: [{ value: 1 }, { value: 2 }, { value: 3 }],
      median: 2,
      mean: 2,
      min: 1,
      max: 3,
      q1: 1.5,
      q3: 2.5,
      ciLow: 1.2,
      ciHigh: 2.8,
    },
    {
      label: "kilo",
      color: "#f472b6",
      n: 2,
      points: [{ runId: "r1", value: 10 }, { value: 14 }],
      median: 12,
      mean: 12,
      min: 10,
      max: 14,
      q1: 11,
      q3: 13,
      ciLow: 10.5,
      ciHigh: 13.5,
    },
  ];

  it("draws every raw point plus a box per arm, never merging the arms", () => {
    const node = render(distributionChart(groups, palette));
    // Every group's points are drawn as dots.
    expect(node.querySelectorAll("circle").length).toBeGreaterThanOrEqual(5);
    // Each arm's label appears (the x axis carries its identity — no legend
    // needed, and no arm is folded into another).
    const text = node.textContent ?? "";
    expect(text).toContain("pi");
    expect(text).toContain("kilo");
  });

  it("wires up hover tips on the raw points", () => {
    const node = render(distributionChart(groups, palette));
    expect(node.querySelector('[aria-label="tip"]')).not.toBeNull();
  });

  // The CI is a separate layer offset to the left of the box, drawn in the muted
  // ink. Counting marks in that color is how we tell "the interval was drawn" from
  // "the interval was omitted" without depending on Plot's internal ordering.
  const mutedMarks = (node: Element) =>
    node.querySelectorAll(`[stroke="${palette.muted}"]`).length;

  it("draws the confidence interval for groups that carry one", () => {
    expect(mutedMarks(render(distributionChart(groups, palette)))).toBeGreaterThan(
      0,
    );
  });

  // TCQ's `dist()` deliberately carries no bootstrap interval, so its groups arrive
  // without one. The honest rendering of that is *no mark* — never a zero-width
  // interval pinned at the median, which reads as a suspiciously precise estimate.
  it("omits the interval entirely when no group carries one", () => {
    const noCi = groups.map(({ ciLow: _low, ciHigh: _high, ...rest }) => rest);
    const node = render(distributionChart(noCi, palette));
    expect(mutedMarks(node)).toBe(0);
    // ...and the rest of the box plot is unaffected: every raw point is still
    // plotted and every group still labelled.
    expect(node.querySelectorAll("circle").length).toBeGreaterThanOrEqual(5);
    expect(node.textContent).toContain("pi");
    expect(node.textContent).toContain("kilo");
  });

  it("draws the interval only over the groups that have one", () => {
    const { ciLow: _low, ciHigh: _high, ...bare } = groups[1]!;
    const mixed = [groups[0]!, bare];
    // One group's interval draws (a rule plus two end ticks); the group without one
    // contributes nothing rather than collapsing to a tick at its median.
    expect(mutedMarks(render(distributionChart(mixed, palette)))).toBe(
      mutedMarks(render(distributionChart([groups[0]!], palette))),
    );
  });

  it("renders a summary-only group with no raw points and no interval", () => {
    const summaryOnly = [
      {
        label: "anthropic/*",
        n: 42,
        points: [],
        median: 7,
        mean: 7.4,
        min: 1,
        max: 10,
        q1: 5,
        q3: 9,
      },
    ];
    const node = render(distributionChart(summaryOnly, palette));
    expect(node.textContent).toContain("anthropic/*");
    expect(mutedMarks(node)).toBe(0);
  });

  it("renders with a single arm (n=1) without throwing", () => {
    const lone = [
      {
        label: "solo",
        n: 1,
        points: [{ value: 5 }],
        median: 5,
        mean: 5,
        min: 5,
        max: 5,
        q1: 5,
        q3: 5,
        ciLow: 5,
        ciHigh: 5,
      },
    ];
    expect(() => render(distributionChart(lone, palette))).not.toThrow();
  });
});

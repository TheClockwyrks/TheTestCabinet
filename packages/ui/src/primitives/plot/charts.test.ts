import * as Plot from "@observablehq/plot";
import { describe, expect, it } from "vitest";
import { barChart, distributionChart, stackedBarChart } from "./charts";
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

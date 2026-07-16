import * as Plot from "@observablehq/plot";
import { describe, expect, it } from "vitest";
import { barChart, stackedBarChart } from "./charts";
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
  });
});

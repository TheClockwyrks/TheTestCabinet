// What the Bar/Scatter control actually does to the drawn figure.
//
// These render the real Plot output and drive the real pointer, because every
// interesting part of this feature only exists once the chart is on screen: the
// box-and-whiskers is a pointer-selected layer that draws nothing at rest, the
// scatter's dots are one mark with per-run offsets, and the run links are DOM
// Plot builds outside React. A test that asserted on the spec object would pass
// on a widget that drew none of it.

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { RunSummary } from "@clockwyrks/run-record/snapshot";
import { describe, expect, it } from "vitest";
import { MetricChartWidget } from "./MetricChartWidget";

const XLINK_NS = "http://www.w3.org/1999/xlink";

// A run summary carrying only what the widget reads.
function run(
  id: string,
  harnessSlug: string,
  modelId: string,
  v: number,
): RunSummary {
  return {
    id,
    subject: { harnessSlug, modelId },
    metrics: { v },
  } as unknown as RunSummary;
}

const value = (r: RunSummary): number | null =>
  (r.metrics as unknown as { v: number }).v;

// Three runs of one pair, deliberately skewed: mean 4, median 2, IQR 1.5-5.5.
// The mean and the median differ, so a chart that drew one where it claims the
// other would be caught.
const SKEWED = [
  run("r-1", "pi", "alpha", 1),
  run("r-2", "pi", "alpha", 2),
  run("r-3", "pi", "alpha", 9),
];

function chart(container: HTMLElement): SVGSVGElement {
  const svg = container.querySelector("svg");
  if (!svg) throw new Error("the widget drew no figure");
  return svg as SVGSVGElement;
}

// Plot labels each mark's group with the mark type. A pointer-selected layer is
// present but EMPTY until the pointer picks a datum, so counting the geometry
// inside a group is how "the box is drawn" is distinguished from "the box could
// be drawn".
function drawn(svg: SVGSVGElement, mark: string): number {
  return [...svg.querySelectorAll(`g[aria-label="${mark}"]`)].reduce(
    (total, group) =>
      total + group.querySelectorAll("rect, line, circle, path").length,
    0,
  );
}

// The tooltip Plot is showing, with its per-line tspans joined back up. Plot
// prefixes each line with a zero-width space to stop SVG collapsing leading
// whitespace; it is invisible to the reader and noise to an assertion.
function tooltip(svg: SVGSVGElement): string | null {
  const tip = svg.querySelector('g[aria-label="tip"]');
  const lines = [...(tip?.querySelectorAll("text tspan") ?? [])].map((line) =>
    (line.textContent ?? "").replace(/\u200b/g, ""),
  );
  return lines.length ? lines.join("\n") : null;
}

// Point at the middle of the figure. Every bar chart here points by column with
// a very wide radius, so any position inside the plot selects the nearest
// column; the scatter points in both dimensions and needs a dot nearby.
function pointAt(svg: SVGSVGElement, clientX: number, clientY: number): void {
  act(() => {
    svg.dispatchEvent(
      new MouseEvent("pointermove", { clientX, clientY, bubbles: true }),
    );
  });
}

function selectMode(title: string, mode: "Bar" | "Scatter"): void {
  const group = screen.getByRole("radiogroup", { name: `${title} display` });
  act(() => {
    fireEvent.click(within(group).getByRole("radio", { name: mode }));
  });
}

describe("the mode control", () => {
  it("offers Bar and Scatter as a radio group named for its own chart", () => {
    render(
      <MetricChartWidget
        title="Average cost"
        runs={SKEWED}
        value={value}
        unit="USD"
        barMode="meanByModel"
        distributionModes
      />,
    );
    const group = screen.getByRole("radiogroup", {
      name: "Average cost display",
    });
    expect(
      within(group)
        .getAllByRole("radio")
        .map((radio) => radio.textContent),
    ).toEqual(["Bar", "Scatter"]);
    expect(within(group).getByRole("radio", { name: "Bar" })).toBeChecked();
  });

  it("belongs to one chart, never to the page", () => {
    // The order control is linked across a page on purpose; this one must not
    // be, or a reader could never put a scatter of cost beside a bar of tokens.
    render(
      <>
        <MetricChartWidget
          title="Average cost"
          runs={SKEWED}
          value={value}
          unit="USD"
          barMode="meanByModel"
          distributionModes
        />
        <MetricChartWidget
          title="Average tokens"
          runs={SKEWED}
          value={value}
          unit="tokens"
          barMode="meanByModel"
          distributionModes
        />
      </>,
    );
    selectMode("Average cost", "Scatter");
    expect(
      within(
        screen.getByRole("radiogroup", { name: "Average cost display" }),
      ).getByRole("radio", { name: "Scatter" }),
    ).toBeChecked();
    expect(
      within(
        screen.getByRole("radiogroup", { name: "Average tokens display" }),
      ).getByRole("radio", { name: "Bar" }),
    ).toBeChecked();
  });

  it("keeps the caller's own header controls beside it", () => {
    render(
      <MetricChartWidget
        title="Average cost"
        runs={SKEWED}
        value={value}
        unit="USD"
        barMode="meanByModel"
        distributionModes
        actions={<button type="button">Order</button>}
      />,
    );
    expect(screen.getByRole("button", { name: "Order" })).toBeInTheDocument();
    expect(
      screen.getByRole("radiogroup", { name: "Average cost display" }),
    ).toBeInTheDocument();
  });

  it("is not offered on a chart whose bars are single runs", () => {
    // A per-run bar IS its own observation; there is no distribution to show.
    render(
      <MetricChartWidget
        title="Cost"
        runs={SKEWED}
        value={value}
        unit="USD"
        distributionModes
      />,
    );
    expect(
      screen.queryByRole("radiogroup", { name: "Cost display" }),
    ).not.toBeInTheDocument();
  });

  it("is not offered unless the caller asks for it", () => {
    render(
      <MetricChartWidget
        title="Average points"
        runs={SKEWED}
        value={value}
        unit="points"
        barMode="meanByModel"
      />,
    );
    expect(
      screen.queryByRole("radiogroup", { name: "Average points display" }),
    ).not.toBeInTheDocument();
  });
});

describe("bar mode — the hover swap", () => {
  it("draws a plain bar at rest and the box-and-whiskers on hover", () => {
    const { container } = render(
      <MetricChartWidget
        title="Average cost"
        runs={SKEWED}
        value={value}
        unit="USD"
        barMode="meanByModel"
        distributionModes
      />,
    );
    const svg = chart(container);
    // At rest: the one bar, the zero baseline, and nothing else.
    expect(drawn(svg, "bar")).toBe(1);
    expect(drawn(svg, "tick")).toBe(0);
    expect(tooltip(svg)).toBeNull();

    pointAt(svg, 300, 200);

    // The swap: the bar is covered, and the whisker, box, median tick and mean
    // tick take its place — 3 bar-shaped marks (bar, cover, box) and 2 ticks.
    expect(drawn(svg, "bar")).toBe(3);
    expect(drawn(svg, "tick")).toBe(2);
    expect(drawn(svg, "rule")).toBeGreaterThan(1);
  });

  it("shows the tooltip with the spread the bar height hides", () => {
    const { container } = render(
      <MetricChartWidget
        title="Average cost"
        runs={SKEWED}
        value={value}
        unit="USD"
        barMode="meanByModel"
        distributionModes
        formatValue={(v) => `$${v}`}
      />,
    );
    const svg = chart(container);
    pointAt(svg, 300, 200);
    expect(tooltip(svg)).toBe(
      [
        "alpha · pi · 3 runs",
        "Mean: $4",
        "Median: $2",
        "IQR: $1.5 – $5.5",
        "Range: $1 – $9",
      ].join("\n"),
    );
  });

  it("draws a one-run bar honestly and claims no spread for it", () => {
    // The box has no width to draw: the distribution collapses to a point, and
    // the tooltip says so instead of reporting a median and a range over one
    // observation.
    const { container } = render(
      <MetricChartWidget
        title="Average cost"
        runs={[run("r-1", "pi", "alpha", 7)]}
        value={value}
        unit="USD"
        barMode="meanByModel"
        distributionModes
      />,
    );
    const svg = chart(container);
    pointAt(svg, 300, 200);
    expect(tooltip(svg)).toBe("alpha · pi · 1 run\n7");
    // The layers still draw — the median and the mean land on the same value,
    // which IS the point the distribution collapsed to.
    expect(drawn(svg, "tick")).toBe(2);
  });

  it("leaves a chart with no distributions on the plain hover wash", () => {
    // `perRun` bars carry no distribution, so there is no box to swap in and
    // the chart keeps the highlight it always had: one extra bar, no ticks.
    const { container } = render(
      <MetricChartWidget title="Cost" runs={SKEWED} value={value} unit="USD" />,
    );
    const svg = chart(container);
    pointAt(svg, 300, 200);
    expect(drawn(svg, "tick")).toBe(0);
    expect(drawn(svg, "bar")).toBe(SKEWED.length + 1);
  });
});

describe("scatter mode", () => {
  const MIXED = [
    run("r-1", "pi", "alpha", 1),
    run("r-2", "pi", "alpha", 2),
    run("r-3", "pi", "alpha", 9),
    run("r-4", "kilo", "beta", 5),
  ];

  function scatter(runs: RunSummary[] = MIXED) {
    const rendered = render(
      <MetricChartWidget
        title="Average cost"
        runs={runs}
        value={value}
        unit="USD"
        barMode="meanByModel"
        distributionModes
        runHref={(r) => `/runs/${r.id}`}
        describeRun={(r) => `started ${r.id}`}
      />,
    );
    selectMode("Average cost", "Scatter");
    return chart(rendered.container);
  }

  it("draws one dot per run and one average rule per group", () => {
    const svg = scatter();
    expect(svg.querySelectorAll("circle")).toHaveLength(MIXED.length);
    // The zero baseline plus one rule per (harness, model) group.
    expect(drawn(svg, "rule")).toBe(1 + 2);
  });

  it("keeps the axis the bar mode drew, so the toggle moves nothing", () => {
    const svg = scatter();
    expect(
      [...svg.querySelectorAll('g[aria-label="x-axis tick label"] text')].map(
        (tick) => tick.textContent,
      ),
    ).toEqual(["alpha · pi", "beta · kilo"]);
  });

  it("splits a model's two harnesses into two groups, as the bars do", () => {
    const svg = scatter();
    // Four dots over two labelled slots: the fold key is unchanged by the mode.
    expect(
      [...svg.querySelectorAll('g[aria-label="x-axis tick label"] text')].map(
        (tick) => tick.textContent,
      ),
    ).toHaveLength(2);
    expect(svg.querySelectorAll("circle")).toHaveLength(4);
  });

  it("links each dot to the run that produced it", () => {
    const svg = scatter();
    expect(
      [...svg.querySelectorAll("a")].map((link) =>
        link.getAttributeNS(XLINK_NS, "href"),
      ),
    ).toEqual(MIXED.map((r) => `/runs/${r.id}`));
  });

  it("draws no link when the caller has nowhere to send the reader", () => {
    const { container } = render(
      <MetricChartWidget
        title="Average cost"
        runs={MIXED}
        value={value}
        unit="USD"
        barMode="meanByModel"
        distributionModes
      />,
    );
    selectMode("Average cost", "Scatter");
    const svg = chart(container);
    expect(svg.querySelectorAll("circle")).toHaveLength(MIXED.length);
    expect(svg.querySelectorAll("a")).toHaveLength(0);
  });

  it("names the run a hovered dot stands for, not just its group", () => {
    const svg = scatter();
    // Point at a dot rather than at a column: a scatter selects in both
    // dimensions, which is the whole reason its tip can be per-run.
    const dot = svg.querySelector("circle")!;
    pointAt(
      svg,
      Number(dot.getAttribute("cx")),
      Number(dot.getAttribute("cy")),
    );
    const tip = tooltip(svg);
    expect(tip).toContain("run r-");
    expect(tip).toContain("started r-");
    expect(tip).toContain("Group mean:");
  });

  it("draws a single-run group as its one dot on its own average", () => {
    const svg = scatter([run("r-9", "pi", "solo", 3)]);
    expect(svg.querySelectorAll("circle")).toHaveLength(1);
    expect(drawn(svg, "rule")).toBe(1 + 1);
  });

  it("goes back to bars when the reader switches back", () => {
    const svg = scatter();
    selectMode("Average cost", "Bar");
    // The figure is re-plotted, so read the new one.
    expect(
      screen.getByRole("img", { name: "Average cost by harness & model" }),
    ).toBeInTheDocument();
    expect(svg.isConnected).toBe(false);
  });
});

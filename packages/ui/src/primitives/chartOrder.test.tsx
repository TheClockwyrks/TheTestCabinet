// The order a chart is asked for has to survive all the way into the drawn axis.
// Plot sorts an ordinal domain it infers by itself, so a widget that only sorted
// its data rows would look correct in every unit test and still draw the bars
// alphabetically. These render the real figures and read the axis back.

import { render, screen } from "@testing-library/react";
import type { RunSummary } from "@clockwyrks/run-record/snapshot";
import { describe, expect, it } from "vitest";
import { MetricChartWidget } from "./MetricChartWidget";
import { RatingsChartWidget, type RatingCounts } from "./RatingsChartWidget";
import type { Rating } from "../ratings";

// A run summary carrying only what the bar builders read.
function run(harnessSlug: string, modelId: string, value: number): RunSummary {
  return {
    subject: { harnessSlug, modelId },
    metrics: { value },
  } as unknown as RunSummary;
}

const value = (r: RunSummary): number | null =>
  (r.metrics as unknown as { value: number }).value;

// The x-axis tick labels, left to right — the bar order as actually drawn.
function axisOrder(container: HTMLElement): string[] {
  const axis = container.querySelector('[aria-label^="x-axis tick label"]');
  return [...(axis?.querySelectorAll("text") ?? [])].map(
    (node) => node.textContent ?? "",
  );
}

// Values chosen so the three orders are all distinct: alphabetical is
// alpha/bravo/charlie, cheapest-first is bravo/alpha/charlie, and
// highest-first is charlie/alpha/bravo. A test whose expectation matched the
// alphabetical order by accident would pass on a widget that ignored `sort`.
const RUNS = [
  run("pi", "alpha", 5),
  run("pi", "bravo", 1),
  run("pi", "charlie", 9),
];

describe("MetricChartWidget — the drawn bar order", () => {
  it("draws the bars alphabetically by default", () => {
    const { container } = render(
      <MetricChartWidget
        title="Average cost"
        runs={RUNS}
        value={value}
        unit="USD"
        barMode="meanByModel"
      />,
    );
    expect(axisOrder(container)).toEqual([
      "alpha · pi",
      "bravo · pi",
      "charlie · pi",
    ]);
  });

  it("draws the cheapest first under the best order", () => {
    const { container } = render(
      <MetricChartWidget
        title="Average cost"
        runs={RUNS}
        value={value}
        unit="USD"
        barMode="meanByModel"
        sort="best"
      />,
    );
    expect(axisOrder(container)).toEqual([
      "bravo · pi",
      "alpha · pi",
      "charlie · pi",
    ]);
  });

  it("draws the highest first when higher is better", () => {
    // The same three bars as the cost chart, read the other way round: this is
    // what makes `best` per-chart rather than one shared ranking.
    const { container } = render(
      <MetricChartWidget
        title="Average points"
        runs={RUNS}
        value={value}
        unit="points"
        barMode="meanByModel"
        sort="best"
        betterIs="higher"
      />,
    );
    expect(axisOrder(container)).toEqual([
      "charlie · pi",
      "alpha · pi",
      "bravo · pi",
    ]);
  });

  it("splits bars level on the metric by their mean points", () => {
    const level = [run("pi", "alpha", 5), run("pi", "bravo", 5)];
    const { container } = render(
      <MetricChartWidget
        title="Average cost"
        runs={level}
        value={value}
        unit="USD"
        barMode="meanByModel"
        sort="best"
        tieBreak={(label) => (label === "bravo · pi" ? 18 : 3)}
      />,
    );
    expect(axisOrder(container)).toEqual(["bravo · pi", "alpha · pi"]);
  });

  it("renders the caller's controls in the widget header", () => {
    render(
      <MetricChartWidget
        title="Average cost"
        runs={RUNS}
        value={value}
        unit="USD"
        barMode="meanByModel"
        actions={<button type="button">Order</button>}
      />,
    );
    expect(screen.getByRole("button", { name: "Order" })).toBeTruthy();
  });

  it("shows the empty message instead of a chart when nothing scored", () => {
    render(
      <MetricChartWidget
        title="Average points"
        runs={RUNS}
        value={() => null}
        unit="points"
        barMode="meanByModel"
        empty="No scored runs yet."
      />,
    );
    expect(screen.getByText("No scored runs yet.")).toBeTruthy();
  });
});

function counts(label: string, tier: Rating): RatingCounts {
  return {
    label,
    counts: {
      flawless: 0,
      great: 0,
      passable: 0,
      scuffed: 0,
      broken: 0,
      [tier]: 2,
    },
  };
}

describe("RatingsChartWidget — the drawn bar order", () => {
  const models = [
    counts("beta", "broken"),
    counts("alpha", "passable"),
    counts("gamma", "flawless"),
  ];

  it("draws the models alphabetically by default", () => {
    const { container } = render(
      <RatingsChartWidget title="Ratings" models={models} variantName="v" />,
    );
    expect(axisOrder(container)).toEqual(["alpha", "beta", "gamma"]);
  });

  it("draws the best average rating first under the best order", () => {
    const { container } = render(
      <RatingsChartWidget
        title="Ratings"
        models={models}
        variantName="v"
        sort="best"
      />,
    );
    expect(axisOrder(container)).toEqual(["gamma", "alpha", "beta"]);
  });
});

import type { ComparisonArmResult } from "@clockwyrks/run-record/comparison";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { presentedRatio } from "./comparisonMath";
import { MedianRatioTile } from "./MedianRatioTile";

/** An arm whose cost distribution has the given median. */
function arm(id: string, label: string, median: number): ComparisonArmResult {
  return {
    arm: { id, label },
    nDesired: 3,
    nObserved: 3,
    liveRunIds: [],
    cost: {
      n: 3,
      median,
      mean: median,
      min: median,
      max: median,
      q1: median,
      q3: median,
      iqr: 0,
      ciLow: median,
      ciHigh: median,
    },
  } as unknown as ComparisonArmResult;
}

const COLORS = new Map([
  ["codex", "rgb(10, 20, 30)"],
  ["pi", "rgb(40, 50, 60)"],
]);

function renderTile(arms: readonly ComparisonArmResult[]) {
  const ratio = presentedRatio(arms, "cost");
  if (!ratio) throw new Error("the two arms present no cost ratio");
  render(
    <MedianRatioTile
      title="Median cost"
      ratio={ratio}
      metric="cost"
      format={(value) => `$${value.toFixed(2)}`}
      colorForArm={COLORS}
    />,
  );
  return screen.getByRole("region", { name: "Median cost" });
}

describe("MedianRatioTile", () => {
  it("leads with the ratio and names what it compares", () => {
    const tile = renderTile([arm("pi", "Pi", 0.2), arm("codex", "Codex", 0.5)]);

    expect(
      within(tile).getByRole("heading", { name: "Median cost" }),
    ).toBeInTheDocument();
    expect(within(tile).getByText(/~2\.5×/)).toBeInTheDocument();
  });

  it("lists the higher arm first, each with its own median", () => {
    const tile = renderTile([arm("pi", "Pi", 0.2), arm("codex", "Codex", 0.5)]);

    expect(
      within(tile)
        .getAllByRole("term")
        .map((term) => term.textContent),
    ).toEqual(["Codex", "Pi"]);
    expect(
      within(tile)
        .getAllByRole("definition")
        .map((value) => value.textContent),
    ).toEqual(["$0.50", "$0.20"]);
  });

  it("draws each arm's bar in its color at its share of the higher median", () => {
    const tile = renderTile([arm("pi", "Pi", 0.2), arm("codex", "Codex", 0.5)]);

    const bars = within(tile).getAllByTestId("median-bar");
    expect(bars.map((bar) => bar.style.width)).toEqual(["100%", "40%"]);
    expect(bars.map((bar) => bar.style.background)).toEqual([
      "rgb(10, 20, 30)",
      "rgb(40, 50, 60)",
    ]);
  });
});

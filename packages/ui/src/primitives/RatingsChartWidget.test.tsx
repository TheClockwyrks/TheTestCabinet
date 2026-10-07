import { describe, expect, it } from "vitest";
import type { Rating } from "../ratings";
import { orderBars } from "./chartSort";
import { meanRatingRank, type RatingCounts } from "./RatingsChartWidget";

// A model's tally, given only the tiers it has runs in.
function model(
  label: string,
  counts: Partial<Record<Rating, number>>,
): RatingCounts {
  return {
    label,
    counts: {
      flawless: 0,
      great: 0,
      passable: 0,
      scuffed: 0,
      broken: 0,
      ...counts,
    },
  };
}

describe("meanRatingRank", () => {
  it("scores flawless best (0) and broken worst (4)", () => {
    expect(meanRatingRank(model("a", { flawless: 3 }))).toBe(0);
    expect(meanRatingRank(model("a", { broken: 3 }))).toBe(4);
  });

  it("averages across a model's runs", () => {
    // One flawless (0) and one passable (2) average to 1.
    expect(meanRatingRank(model("a", { flawless: 1, passable: 1 }))).toBe(1);
  });

  it("has no rank for a model with no rated runs", () => {
    expect(meanRatingRank(model("a", {}))).toBeNull();
  });
});

describe("the ratings chart's best order", () => {
  it("puts the highest average rating first", () => {
    const models = [
      model("mostly broken", { broken: 2 }),
      model("mostly flawless", { flawless: 2 }),
      model("middling", { passable: 2 }),
    ];
    const ordered = orderBars(
      models,
      "best",
      (m) => m.label,
      meanRatingRank,
      "lower",
    );
    expect(ordered.map((m) => m.label)).toEqual([
      "mostly flawless",
      "middling",
      "mostly broken",
    ]);
  });

  it("splits an equal average rating by mean points", () => {
    const points = new Map([
      ["thorough", 18],
      ["thin", 4],
    ]);
    const ordered = orderBars(
      [model("thin", { great: 1 }), model("thorough", { great: 1 })],
      "best",
      (m) => m.label,
      meanRatingRank,
      "lower",
      (label) => points.get(label) ?? null,
    );
    expect(ordered.map((m) => m.label)).toEqual(["thorough", "thin"]);
  });
});

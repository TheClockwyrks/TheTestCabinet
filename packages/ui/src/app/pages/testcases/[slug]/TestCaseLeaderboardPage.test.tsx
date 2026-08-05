import type { RunSummary } from "@test-cabinet/run-record/snapshot";
import { describe, expect, it } from "vitest";
import type { ParsedWriteup } from "../../../data/ratings";
import type { VariantSummary } from "../../../data/testCases";
import { resolveRunScore } from "./TestCaseLeaderboardPage";

// A variant whose two weighted items (total 5) score the fallback path.
const variant = {
  reviewItems: [
    { id: "a", title: "A", weight: 3 },
    { id: "b", title: "B", weight: 2 },
  ],
} as unknown as VariantSummary;

// A run summary carrying only the fields resolveRunScore reads.
function summary(overrides: Partial<RunSummary>): RunSummary {
  return { id: "r-1", ...overrides } as unknown as RunSummary;
}

describe("resolveRunScore", () => {
  it("reads a published run's enriched summary score and rating", () => {
    const run = summary({
      score: { earned: 4, total: 5, reviews: 2 },
      rating: "great",
    });
    // A published run's per-review checklist is not on hand (the console no longer
    // eagerly loads its full record), so findReview must NOT be consulted — pass one
    // that throws if it is.
    const consulted = () => {
      throw new Error("findReview must not be consulted for a scored summary");
    };
    expect(resolveRunScore(run, variant, consulted, {})).toEqual({
      earned: 4,
      total: 5,
      rating: "great",
      grade: null,
    });
  });

  it("falls back to a local preview writeup when the summary has no score", () => {
    const run = summary({ score: null, rating: null });
    const writeup: ParsedWriteup = {
      ratings: [{ domain: "d", rating: "scuffed" }],
      checklist: [{ id: "a", status: "pass" }],
      body: "",
    };
    const findReview = (runId: string) =>
      runId === "r-1" ? writeup : undefined;
    // Item "a" (weight 3) passed; item "b" (weight 2) did not → 3 / 5, worst rating.
    expect(resolveRunScore(run, variant, findReview, {})).toEqual({
      earned: 3,
      total: 5,
      rating: "scuffed",
      grade: null,
    });
  });

  it("returns null when a scoreless run has no resolvable review", () => {
    const run = summary({ score: null, rating: null });
    expect(resolveRunScore(run, variant, () => undefined, {})).toBeNull();
  });

  it("returns null when the only review carries no domain ratings", () => {
    const run = summary({ score: null, rating: null });
    const writeup: ParsedWriteup = { ratings: [], checklist: [], body: "" };
    expect(resolveRunScore(run, variant, () => writeup, {})).toBeNull();
  });

  // A game jam grades its categories (and a whole-game overall mark) rather than
  // rating domains, so it carries a grade in place of a rating.
  const jamVariant = {
    reviewItems: [{ id: "fun", title: "Fun", weight: 1, graded: true }],
  } as unknown as VariantSummary;

  it("reads a published jam summary's overall grade in place of a rating", () => {
    const run = summary({
      score: { earned: 5, total: 10, reviews: 1, overallGrade: "great" },
      rating: null,
    });
    expect(resolveRunScore(run, jamVariant, () => undefined, {})).toEqual({
      earned: 5,
      total: 10,
      rating: null,
      grade: "great",
    });
  });

  it("scores a local jam preview off the graded checklist and overall grade", () => {
    const run = summary({ score: null, rating: null });
    const writeup: ParsedWriteup = {
      ratings: [],
      // The category "fun" earned a `great` (8 pts × weight 1) and the reserved
      // overall verdict is the run's grade badge.
      checklist: [
        { id: "fun", status: "great" },
        { id: "overall", status: "neutral" },
      ],
      body: "",
    };
    expect(resolveRunScore(run, jamVariant, () => writeup, {})).toEqual({
      earned: 8,
      total: 10,
      rating: null,
      grade: "neutral",
    });
  });
});

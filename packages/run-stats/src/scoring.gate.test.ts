import { describe, expect, it } from "vitest";
import {
  aggregateRating,
  aggregateScore,
  gatedOverallGrade,
  gatedRating,
  gatedScore,
  isToolchainGated,
} from "./scoring";

// The TypeScript mirror of the Rust core's `gated_*` helpers
// (crates/core/src/review.rs). The two must agree exactly — the console and the
// backend derive the same badge from the same record — so this file asserts the
// same properties as `crates/core/src/review.gate.test.rs`.

const toolchain = (ran: boolean, succeeded: boolean) => ({
  typecheck: { ran, succeeded },
});

describe("the toolchain gate predicate", () => {
  it("fires only for a typecheck that ran and failed", () => {
    expect(isToolchainGated(toolchain(true, false))).toBe(true);
    expect(isToolchainGated(toolchain(true, true))).toBe(false);
    // A typecheck that never ran has learned nothing about whether the code
    // compiles, so it must not gate.
    expect(isToolchainGated(toolchain(false, false))).toBe(false);
  });

  it("treats an absent toolchain block as ungated", () => {
    // Every case version frozen before `[toolchain]` existed is in this arm.
    expect(isToolchainGated(null)).toBe(false);
    expect(isToolchainGated(undefined)).toBe(false);
  });
});

describe("the gate over a run's rating", () => {
  it("leaves a reviewed rating untouched when the typecheck passed", () => {
    const reviewed = aggregateRating([[{ domain: "play", rating: "great" }]]);
    expect(reviewed).toBe("great");
    expect(gatedRating(false, reviewed)).toBe("great");
    expect(gatedRating(false, null)).toBeNull();
  });

  it("forces broken over even a flawless review", () => {
    const reviewed = aggregateRating([
      [{ domain: "play", rating: "flawless" }],
    ]);
    expect(gatedRating(true, reviewed)).toBe("broken");
  });

  it("rates an unreviewed gated run broken", () => {
    // The gate is a statement about the build, not an average of opinions.
    expect(gatedRating(true, null)).toBe("broken");
  });

  it("does not rewrite the reviews it composes over", () => {
    const review = [
      { domain: "play", rating: "passable" },
      { domain: "polish", rating: "great" },
    ] as const;
    expect(gatedRating(true, aggregateRating([review]))).toBe("broken");
    // Re-aggregating with the gate lifted recovers the reviewer's real verdict,
    // which is only true because nothing was written into it.
    expect(gatedRating(false, aggregateRating([review]))).toBe("passable");
  });
});

describe("the gate over a run's score", () => {
  it("zeroes the score but keeps the denominator and the review count", () => {
    const reviewed = aggregateScore([
      { earned: 7, total: 10 },
      { earned: 9, total: 10 },
    ]);
    expect(gatedScore(true, reviewed)).toEqual({
      earned: 0,
      total: 10,
      reviews: 2,
    });
  });

  it("leaves the score untouched when the typecheck passed", () => {
    const reviewed = aggregateScore([{ earned: 7, total: 10 }]);
    expect(gatedScore(false, reviewed)).toEqual(reviewed);
  });

  it("leaves an unreviewed gated run unscored", () => {
    // No reviews means no denominator to report a zero against; the `broken`
    // rating is the signal.
    expect(gatedScore(true, null)).toBeNull();
  });
});

describe("the gate over a jam's overall grade", () => {
  it("forces the worst tier, and only when gated", () => {
    expect(gatedOverallGrade(true, "incredible")).toBe("broken");
    expect(gatedOverallGrade(false, "incredible")).toBe("incredible");
    expect(gatedOverallGrade(true, null)).toBe("broken");
    expect(gatedOverallGrade(false, null)).toBeNull();
  });
});

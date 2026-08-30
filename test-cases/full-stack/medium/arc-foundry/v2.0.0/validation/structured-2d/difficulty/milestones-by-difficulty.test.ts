// Arc Foundry — `difficulty.milestones-by-difficulty`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `difficulty/milestones-by-difficulty.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. The Dynamo waves are round(N / 2) and N for the chosen
// difficulty: 20 and 40 on Easy, 25 and 50 on Medium, 30 and 60 on Hard.
//
// HOW IT IS DECIDED. Set each difficulty and read the composition of the waves
// either side of round(N / 2) and N. The evidence it hands back is `milestone`
// (replay): the milestone wave at each difficulty.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("difficulty.milestones-by-difficulty", () => {
  it("The milestone waves follow the difficulty", () => {
    fail(
      "a validator deciding this point",
      "the suite for `difficulty.milestones-by-difficulty` has not been written yet",
    );
  });
});

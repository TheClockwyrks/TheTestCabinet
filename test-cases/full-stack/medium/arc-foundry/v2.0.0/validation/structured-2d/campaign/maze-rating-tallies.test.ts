// Arc Foundry — `campaign.maze-rating-tallies`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `campaign/maze-rating-tallies.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. The Maze Rating rises by every point of damage dealt to the
// Overload Dynamo, burn ticks included, and equals the total the structures'
// own damage tallies grew by over the finale.
//
// HOW IT IS DECIDED. Run a finale past a known set of structures and hold the
// Maze Rating against the damage they tallied. The evidence it hands back is
// `rating` (replay): the Maze Rating accruing over the finale.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("campaign.maze-rating-tallies", () => {
  it("The Maze Rating is the damage dealt to the Dynamo", () => {
    fail(
      "a validator deciding this point",
      "the suite for `campaign.maze-rating-tallies` has not been written yet",
    );
  });
});

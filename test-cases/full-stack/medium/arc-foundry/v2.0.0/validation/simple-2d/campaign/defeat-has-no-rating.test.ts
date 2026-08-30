// Arc Foundry — `campaign.defeat-has-no-rating`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `campaign/defeat-has-no-rating.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A run lost to Grid Integrity never reaches the finale: the
// phase never becomes finale, the Maze Rating stays 0, and the overload screen
// draws no rating.
//
// HOW IT IS DECIDED. Lose a run on the final wave and read the phase, the Maze
// Rating and the overload screen. The evidence it hands back is `defeat`
// (image): the overload screen without a rating.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("campaign.defeat-has-no-rating", () => {
  it("A defeated run has no Maze Rating", () => {
    fail(
      "a validator deciding this point",
      "the suite for `campaign.defeat-has-no-rating` has not been written yet",
    );
  });
});

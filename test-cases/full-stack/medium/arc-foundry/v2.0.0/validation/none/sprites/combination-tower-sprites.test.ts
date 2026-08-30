// Arc Foundry — `sprites.combination-tower-sprites`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `sprites/combination-tower-sprites.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. assets/combos/<id>/base.png and head.png each exist as a 40
// by 40 PNG for all twelve combination tower identifiers.
//
// HOW IT IS DECIDED. Read the twenty-four files and decode each one's
// dimensions. The evidence it hands back is `towers` (image): the twelve
// combination towers.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("sprites.combination-tower-sprites", () => {
  it("Every combination tower has a produced mount and head", () => {
    fail(
      "a validator deciding this point",
      "the suite for `sprites.combination-tower-sprites` has not been written yet",
    );
  });
});

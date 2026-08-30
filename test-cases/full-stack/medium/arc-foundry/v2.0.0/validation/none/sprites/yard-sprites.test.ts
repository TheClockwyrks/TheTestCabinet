// Arc Foundry — `sprites.yard-sprites`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `sprites/yard-sprites.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. assets/yard/substrate.png, entry.png, collector.png and
// housing.png each exist as a 40 by 40 PNG and waypoint.png as a 20 by 20 PNG,
// at the paths specs/assets.md fixes.
//
// HOW IT IS DECIDED. Read the five files off the built repository and decode
// each one's dimensions. The evidence it hands back is `yard` (image): the
// yard drawn from its produced sprites.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("sprites.yard-sprites", () => {
  it("The yard's five sprites are produced", () => {
    fail(
      "a validator deciding this point",
      "the suite for `sprites.yard-sprites` has not been written yet",
    );
  });
});

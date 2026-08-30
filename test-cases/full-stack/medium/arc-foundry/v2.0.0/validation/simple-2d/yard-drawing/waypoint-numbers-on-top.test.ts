// Arc Foundry — `yard-drawing.waypoint-numbers-on-top`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `yard-drawing/waypoint-numbers-on-top.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Each waypoint platform is drawn with its order number, 1
// through 6, and those numbers are drawn last: with a structure standing on
// the tiles beside a platform and a unit standing on it, the number is still
// drawn after both.
//
// HOW IT IS DECIDED. Crowd a platform with a structure and a unit and read the
// order the draws were made in. The evidence it hands back is `numbers`
// (image): the order numbers drawn over the yard.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("yard-drawing.waypoint-numbers-on-top", () => {
  it("The waypoint order numbers are drawn over everything", () => {
    fail(
      "a validator deciding this point",
      "the suite for `yard-drawing.waypoint-numbers-on-top` has not been written yet",
    );
  });
});

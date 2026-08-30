// Arc Foundry — `yard.no-build-on-waypoint`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `yard/no-build-on-waypoint.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A placement whose footprint would cover ANY tile of a four-
// tile waypoint platform is refused — the anchor, either arm, or the stem — so
// it is not merely the anchor tile that is protected. The stem is the tile
// below the anchor when row is under 16 and the tile above it otherwise.
//
// HOW IT IS DECIDED. Attempt a placement over the anchor, each arm and the
// stem of a platform above the grid's centre and one below it. The evidence it
// hands back is `refused` (image): a refused placement on a waypoint platform.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("yard.no-build-on-waypoint", () => {
  it("A waypoint platform is not buildable", () => {
    fail(
      "a validator deciding this point",
      "the suite for `yard.no-build-on-waypoint` has not been written yet",
    );
  });
});

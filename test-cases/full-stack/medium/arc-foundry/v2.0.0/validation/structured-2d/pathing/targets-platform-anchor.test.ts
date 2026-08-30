// Arc Foundry — `pathing.targets-platform-anchor`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `pathing/targets-platform-anchor.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A unit heading for a waypoint reaches the anchor tile's
// centre rather than an arm or the stem: as its waypointIndex advances, its
// position is within half a tile of the anchor's centre.
//
// HOW IT IS DECIDED. Release a unit and sample its position on the frame each
// waypointIndex advances. The evidence it hands back is `anchor` (replay): the
// unit arriving on a platform anchor.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("pathing.targets-platform-anchor", () => {
  it("A unit walks to the platform's anchor tile", () => {
    fail(
      "a validator deciding this point",
      "the suite for `pathing.targets-platform-anchor` has not been written yet",
    );
  });
});

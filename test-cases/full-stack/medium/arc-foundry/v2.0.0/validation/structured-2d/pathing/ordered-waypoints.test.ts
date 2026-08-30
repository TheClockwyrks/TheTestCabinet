// Arc Foundry — `pathing.ordered-waypoints`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `pathing/ordered-waypoints.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. A ground unit released at the entry heads for WP1 first,
// then each waypoint in sequence, then the collector, where it grounds out and
// is removed. Its reported waypointIndex runs 1 through 7 without skipping a
// value and never decreases.
//
// HOW IT IS DECIDED. Release one ground unit on an empty yard and sample its
// waypointIndex across the whole walk. The evidence it hands back is `walk`
// (replay): a unit walking the ordered waypoint chain.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("pathing.ordered-waypoints", () => {
  it("The Load walks the waypoint chain in order", () => {
    fail(
      "a validator deciding this point",
      "the suite for `pathing.ordered-waypoints` has not been written yet",
    );
  });
});

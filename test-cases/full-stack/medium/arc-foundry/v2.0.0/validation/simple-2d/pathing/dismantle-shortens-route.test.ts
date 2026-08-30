// Arc Foundry — `pathing.dismantle-shortens-route`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `pathing/dismantle-shortens-route.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Dismantling a structure clears its four tiles back to Open
// and recomputes the route, so the maze length returns to what it was before
// that structure was placed.
//
// HOW IT IS DECIDED. Wall a leg, dismantle the wall, and compare the maze
// length against the reading before the placement. The evidence it hands back
// is `shorten` (replay): the route shortening after a dismantle.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("pathing.dismantle-shortens-route", () => {
  it("Dismantling a wall shortens the route back", () => {
    fail(
      "a validator deciding this point",
      "the suite for `pathing.dismantle-shortens-route` has not been written yet",
    );
  });
});

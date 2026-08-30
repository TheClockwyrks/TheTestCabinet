// Arc Foundry — `pathing.wall-lengthens-route`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `pathing/wall-lengthens-route.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Structures are walls: placing a rock across a leg raises
// the reported maze length, and a unit released afterwards walks around the
// wall rather than through it.
//
// HOW IT IS DECIDED. Read the maze length of the empty yard, wall a leg, read
// it again, and release a unit to walk the new route. The evidence it hands
// back is `reroute` (replay): a wall lengthening the route.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("pathing.wall-lengthens-route", () => {
  it("Building lengthens the shortest open route", () => {
    fail(
      "a validator deciding this point",
      "the suite for `pathing.wall-lengthens-route` has not been written yet",
    );
  });
});

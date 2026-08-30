// Arc Foundry — `pathing.route-recomputed-immediately`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `pathing/route-recomputed-immediately.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. The reported maze length changes on the call that lands a
// rock and on the call that dismantles a structure, with no frame advanced in
// between, so the figure and any drawn route reflect the yard immediately.
//
// HOW IT IS DECIDED. Read the maze length either side of a placement and a
// dismantle without advancing a frame. The evidence it hands back is
// `immediate` (image): the maze length changing on the placement itself.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("pathing.route-recomputed-immediately", () => {
  it("The route is recomputed the moment the walls change", () => {
    fail(
      "a validator deciding this point",
      "the suite for `pathing.route-recomputed-immediately` has not been written yet",
    );
  });
});

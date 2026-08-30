// Arc Foundry — `yard-drawing.maze-route-on-hover`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `yard-drawing/maze-route-on-hover.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Moving the pointer over the status bar's maze-length
// readout draws the full ground route on the yard, from the entry through
// every waypoint to the collector: the yard's draw calls along the route grow
// while the pointer is over the readout and return when it leaves.
//
// HOW IT IS DECIDED. Read the yard's draws with the pointer off the readout
// and over it. The evidence it hands back is `route` (image): the ground route
// drawn on hover.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("yard-drawing.maze-route-on-hover", () => {
  it("Hovering the maze length draws the route", () => {
    fail(
      "a validator deciding this point",
      "the suite for `yard-drawing.maze-route-on-hover` has not been written yet",
    );
  });
});

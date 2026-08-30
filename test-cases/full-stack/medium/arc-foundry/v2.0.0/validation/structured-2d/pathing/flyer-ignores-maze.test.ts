// Arc Foundry — `pathing.flyer-ignores-maze`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `pathing/flyer-ignores-maze.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. The Filament flies straight lines from the entry through
// each waypoint anchor in order to the collector, passing over every wall:
// with a heavy maze standing, its path and its arrival time are the same as on
// an empty yard.
//
// HOW IT IS DECIDED. Fly a Filament over an empty yard and over a heavy maze
// and compare the two flights. The evidence it hands back is `flyover`
// (replay): the Filament flying straight over the walls.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("pathing.flyer-ignores-maze", () => {
  it("The Filament flies over the maze", () => {
    fail(
      "a validator deciding this point",
      "the suite for `pathing.flyer-ignores-maze` has not been written yet",
    );
  });
});

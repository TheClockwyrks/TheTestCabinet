// Arc Foundry — `screens.mapselect-lists-three`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `screens/mapselect-lists-three.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. The map select draws the names of The Substation, The
// Switchyard and The Transformer Yard and a preview of each map's waypoint
// layout, with The Transformer Yard's preview showing its two fixed housings.
//
// HOW IT IS DECIDED. Open the map select, read the text draws, and read the
// drawn previews back. The evidence it hands back is `maps` (image): the three
// maps and their previews.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("screens.mapselect-lists-three", () => {
  it("The map select lists the three maps", () => {
    fail(
      "a validator deciding this point",
      "the suite for `screens.mapselect-lists-three` has not been written yet",
    );
  });
});

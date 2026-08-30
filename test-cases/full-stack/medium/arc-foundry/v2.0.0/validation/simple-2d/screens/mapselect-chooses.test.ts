// Arc Foundry — `screens.mapselect-chooses`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `screens/mapselect-chooses.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Taking a map from the map select moves the screen to
// difficultyselect and fixes the map the run will open on.
//
// HOW IT IS DECIDED. Choose each map in turn and read the screen and the
// reported map. The evidence it hands back is `difficulty` (image): the
// difficulty select reached from a map.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("screens.mapselect-chooses", () => {
  it("Choosing a map leads to the difficulty select", () => {
    fail(
      "a validator deciding this point",
      "the suite for `screens.mapselect-chooses` has not been written yet",
    );
  });
});

// Arc Foundry — `controls.key-dismantle`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `controls/key-dismantle.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Pressing KeyX during a build phase with a structure
// selected removes it and reopens its four tiles.
//
// HOW IT IS DECIDED. Select a standing structure, press KeyX, and read the
// structure count and the maze length. The evidence it hands back is
// `dismantled` (image): the yard after the dismantle key.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("controls.key-dismantle", () => {
  it("KeyX dismantles the selected structure", () => {
    fail(
      "a validator deciding this point",
      "the suite for `controls.key-dismantle` has not been written yet",
    );
  });
});

// Arc Foundry — `controls.key-damage`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `controls/key-damage.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Pressing KeyL opens the damage leaderboard and pressing it
// again dismisses it.
//
// HOW IT IS DECIDED. Press KeyL twice and read the overlays state after each.
// The evidence it hands back is `board` (image): the damage leaderboard opened
// from the keyboard.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("controls.key-damage", () => {
  it("KeyL toggles the damage leaderboard", () => {
    fail(
      "a validator deciding this point",
      "the suite for `controls.key-damage` has not been written yet",
    );
  });
});

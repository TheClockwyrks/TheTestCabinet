// Arc Foundry — `controls.key-mute`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `controls/key-mute.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Pressing KeyM toggles the mute bit, and it toggles from any
// screen, so the reported muted flag changes on the title as well as on
// playing.
//
// HOW IT IS DECIDED. Press KeyM on the title and again mid-wave and read muted
// after each. The evidence it hands back is `mute` (image): the mute bit
// toggled from the keyboard.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("controls.key-mute", () => {
  it("KeyM toggles audio mute", () => {
    fail(
      "a validator deciding this point",
      "the suite for `controls.key-mute` has not been written yet",
    );
  });
});

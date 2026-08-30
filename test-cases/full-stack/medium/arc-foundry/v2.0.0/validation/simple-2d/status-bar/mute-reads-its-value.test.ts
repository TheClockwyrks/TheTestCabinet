// Arc Foundry — `status-bar.mute-reads-its-value`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `status-bar/mute-reads-its-value.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Muting changes the pixels inside the mute control's
// reported rectangle, whether the mute was toggled from the bar or from the
// keyboard.
//
// HOW IT IS DECIDED. Sample the control's rectangle muted and unmuted,
// toggling by each route. The evidence it hands back is `mute` (image): the
// mute control in both states.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("status-bar.mute-reads-its-value", () => {
  it("The mute control draws its live value", () => {
    fail(
      "a validator deciding this point",
      "the suite for `status-bar.mute-reads-its-value` has not been written yet",
    );
  });
});

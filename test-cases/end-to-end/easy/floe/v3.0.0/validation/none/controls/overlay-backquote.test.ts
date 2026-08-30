// Floe — controls/overlay-backquote: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `controls.overlay-backquote` review item, written
// against the `none` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   Backquote toggles the debug overlay
//
//   Backquote shows the overlay and a second press hides it, and the snapshot
//   is identical across both.
//
// Its declared media: image `overlay`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("controls/overlay-backquote has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

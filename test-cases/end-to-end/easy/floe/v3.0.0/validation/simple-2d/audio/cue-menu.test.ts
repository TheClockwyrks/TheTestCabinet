// Floe — audio/cue-menu: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `audio.cue-menu` review item, written
// against the `simple-2d` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   A menu move plays its cue
//
//   Moving the title menu's selection plays the menu cue exactly once per
//   move.
//
// Its declared media: image `menu`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("audio/cue-menu has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

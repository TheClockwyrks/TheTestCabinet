// Floe — screens/gameover-screen: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `screens.gameover-screen` review item, written
// against the `none` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   The game-over screen reports the run
//
//   The game-over screen shows the final score and the level reached, with
//   both entries of ENDING_ITEMS.
//
// Its declared media: image `gameover`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("screens/gameover-screen has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

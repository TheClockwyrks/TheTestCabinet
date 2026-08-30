// Floe — hunter/ice-speed: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `hunter.ice-speed` review item, written
// against the `structured-2d` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   A bear covers three tiles a second on ice
//
//   A bear stepped repeatedly across the median at level 1 covers
//   BEAR_ICE_SPEED * 32 (96) units per second of game time, within 2%.
//
// Its declared media: replay `glide`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("hunter/ice-speed has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

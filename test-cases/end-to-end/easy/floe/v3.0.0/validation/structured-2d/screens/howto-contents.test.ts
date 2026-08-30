// Floe — screens/howto-contents: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `screens.howto-contents` review item, written
// against the `structured-2d` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   The how-to screen covers the game
//
//   The how-to screen names the goal of filling the bays, the hopping
//   controls, the hunting bear, the sliding hazards, the drifting floes and
//   the timer.
//
// Its declared media: image `howto`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("screens/howto-contents has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

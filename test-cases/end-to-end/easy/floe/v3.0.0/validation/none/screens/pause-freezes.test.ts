// Floe — screens/pause-freezes: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `screens.pause-freezes` review item, written
// against the `none` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   The strait freezes while paused
//
//   Every lane item holds its x and the critter and bears hold their centres
//   over three seconds of paused.
//
// Its declared media: replay `pause`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("screens/pause-freezes has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

// Floe — water/off-edge-right: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `water.off-edge-right` review item, written
// against the `simple-2d` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   Riding off the right edge costs a life
//
//   A critter carried until its centre leaves x = 1280 loses a life.
//
// Its declared media: replay `sweep`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("water/off-edge-right has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

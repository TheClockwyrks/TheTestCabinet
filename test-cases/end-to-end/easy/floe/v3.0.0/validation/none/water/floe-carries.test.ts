// Floe — water/floe-carries: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `water.floe-carries` review item, written
// against the `none` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   A floe carries its rider
//
//   A critter riding a floe in a lane running at speed s and direction d has
//   its centre x change by d * s * 32 units over one second of game time,
//   within 2%.
//
// Its declared media: replay `carry`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("water/floe-carries has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

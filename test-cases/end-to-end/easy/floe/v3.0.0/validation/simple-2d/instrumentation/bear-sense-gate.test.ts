// Floe — instrumentation/bear-sense-gate: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `instrumentation.bear-sense-gate` review item, written
// against the `simple-2d` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   Sense off freezes a bear's target
//
//   A bear with setBearSense(id, false) keeps the target it was posed with
//   while the critter is moved four tiles away; a second bear with sense on
//   reports the critter's new tile.
//
// Its declared media: replay `gate`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("instrumentation/bear-sense-gate has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

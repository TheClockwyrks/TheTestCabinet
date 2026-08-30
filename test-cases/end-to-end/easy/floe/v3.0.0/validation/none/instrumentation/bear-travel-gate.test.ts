// Floe — instrumentation/bear-travel-gate: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `instrumentation.bear-travel-gate` review item, written
// against the `none` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   Travel off holds a bear still
//
//   A bear with setBearTravel(id, false) reports the same centre after a
//   second of game time, while its routing still reports a committed step
//   toward the critter.
//
// Its declared media: replay `gate`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("instrumentation/bear-travel-gate has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

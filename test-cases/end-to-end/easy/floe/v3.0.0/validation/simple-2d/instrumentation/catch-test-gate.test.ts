// Floe — instrumentation/catch-test-gate: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `instrumentation.catch-test-gate` review item, written
// against the `simple-2d` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   Catch off costs no life
//
//   With setCatchTest(false) a bear posed on the critter's centre leaves lives
//   unchanged and the phase still crossing over a second; with it on, the same
//   scenario costs a life.
//
// Its declared media: replay `gate`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("instrumentation/catch-test-gate has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

// Floe — hunter/catches: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `hunter.catches` review item, written
// against the `simple-2d` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   A bear that reaches the critter catches it
//
//   With the catch test on, a bear posed BEAR_CATCH_DIST (18) units minus one
//   from the critter's centre costs a life on the next tick.
//
// Its declared media: replay `catch`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("hunter/catches has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

// Floe — hunter/boxed-in-stands-still: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `hunter.boxed-in-stands-still` review item, written
// against the `none` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   A boxed-in bear stands still
//
//   A bear ringed on all four sides by parked vehicles commits no step and
//   holds its centre over three seconds.
//
// Its declared media: replay `route`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("hunter/boxed-in-stands-still has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

// Floe — hunter/routes-around-hazard: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `hunter.routes-around-hazard` review item, written
// against the `simple-2d` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   A bear routes around a wall of traffic
//
//   With a full row of parked vehicles between it and the critter save one
//   gap, the bear commits no step into a covered tile over six seconds and
//   reaches the critter's row through the gap.
//
// Its declared media: replay `route`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("hunter/routes-around-hazard has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

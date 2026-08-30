// Floe — ice/crush-only-on-arrival: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `ice.crush-only-on-arrival` review item, written
// against the `none` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   A parked vehicle over the critter kills nothing
//
//   A critter posed under a vehicle whose lane speed is 0 loses no life over
//   three seconds; releasing the lane then costs one.
//
// Its declared media: replay `crush`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("ice/crush-only-on-arrival has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

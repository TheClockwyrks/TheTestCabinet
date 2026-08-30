// Floe — instrumentation/remove-critter: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `instrumentation.remove-critter` review item, written
// against the `simple-2d` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   removeCritter takes the critter off the strait
//
//   removeCritter() reports critter.present false and leaves the lane items,
//   the bears, the bays and the fish standing, and a vehicle released across
//   the critter's old tile costs no life over three seconds.
//
// Its declared media: image `cleared`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("instrumentation/remove-critter has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

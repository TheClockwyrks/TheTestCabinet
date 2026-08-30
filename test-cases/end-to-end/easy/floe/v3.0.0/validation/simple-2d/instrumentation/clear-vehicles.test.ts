// Floe — instrumentation/clear-vehicles: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `instrumentation.clear-vehicles` review item, written
// against the `simple-2d` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   clearVehicles empties the ice band alone
//
//   clearVehicles() removes every vehicle and leaves the floes, the bears, the
//   critter, the bays and the fish standing.
//
// Its declared media: image `cleared`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("instrumentation/clear-vehicles has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

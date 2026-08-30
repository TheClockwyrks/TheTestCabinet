// Floe — instrumentation/snapshot-shape: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `instrumentation.snapshot-shape` review item, written
// against the `structured-2d` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   Snapshot reports the full documented shape
//
//   On a posed strait carrying a critter, two bears, a vehicle in every ice
//   lane, a floe in every water lane, one filled bay and a posed bonus catch,
//   every field listed in the snapshot shape is present with its documented
//   type.
//
// Its declared media: image `posed`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("instrumentation/snapshot-shape has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

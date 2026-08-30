// Floe — bays/fish-appears-in-open-bay: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `bays.fish-appears-in-open-bay` review item, written
// against the `none` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   The bonus catch appears in an open bay
//
//   With the cadence on and one bay posed filled, the first fish that appears
//   is in a bay that is open.
//
// Its declared media: image `fish`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("bays/fish-appears-in-open-bay has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

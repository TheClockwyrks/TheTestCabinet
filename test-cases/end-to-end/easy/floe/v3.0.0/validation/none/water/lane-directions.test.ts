// Floe — water/lane-directions: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `water.lane-directions` review item, written
// against the `none` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   Each water lane drifts its stated way
//
//   Every lane's dir is the table's, and a floe's x moves that way over a
//   second.
//
// Its declared media: replay `drift`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("water/lane-directions has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

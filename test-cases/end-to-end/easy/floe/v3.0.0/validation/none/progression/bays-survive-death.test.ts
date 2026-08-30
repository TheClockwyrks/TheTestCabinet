// Floe — progression/bays-survive-death: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `progression.bays-survive-death` review item, written
// against the `none` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   A death leaves the bays filled
//
//   With two bays posed filled, a death and its respawn leave exactly those
//   two filled.
//
// Its declared media: replay `respawn`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("progression/bays-survive-death has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

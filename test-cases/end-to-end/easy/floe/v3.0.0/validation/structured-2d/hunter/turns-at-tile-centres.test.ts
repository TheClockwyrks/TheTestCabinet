// Floe — hunter/turns-at-tile-centres: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `hunter.turns-at-tile-centres` review item, written
// against the `structured-2d` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   A bear turns only on a tile centre
//
//   Over four seconds of pursuit, every tick on which the bear's travelling
//   axis changes is a tick on which its centre is exactly a tile centre.
//
// Its declared media: replay `turn`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("hunter/turns-at-tile-centres has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

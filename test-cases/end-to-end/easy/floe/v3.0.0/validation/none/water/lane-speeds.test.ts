// Floe — water/lane-speeds: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `water.lane-speeds` review item, written
// against the `none` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   Each water lane drifts at its stated speed
//
//   Every lane's reported speed is the table's level-1 figure, and a floe
//   covers speed * 32 units over one second of game time, within 2%.
//
// Its declared media: replay `drift`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("water/lane-speeds has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

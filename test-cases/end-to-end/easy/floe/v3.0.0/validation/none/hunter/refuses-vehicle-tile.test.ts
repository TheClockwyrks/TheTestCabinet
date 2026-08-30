// Floe — hunter/refuses-vehicle-tile: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `hunter.refuses-vehicle-tile` review item, written
// against the `none` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   A vehicle's tile is closed to a bear
//
//   A step sent into a tile a parked vehicle covers leaves the bear on the
//   tile it was on, still on the roster and unharmed.
//
// Its declared media: replay `refuse`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("hunter/refuses-vehicle-tile has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

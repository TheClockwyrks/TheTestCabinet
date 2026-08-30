// Floe — ice/lane-gaps: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `ice.lane-gaps` review item, written
// against the `none` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   Consecutive vehicles leave the stated gap
//
//   In each lane, the clear ice between one vehicle's right edge and the next
//   vehicle's left edge is the table's gap in tiles, within a tenth of a tile.
//
// Its declared media: image `scene`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("ice/lane-gaps has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

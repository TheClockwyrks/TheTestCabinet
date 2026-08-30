// Floe — ice/gap-widens-with-level: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `ice.gap-widens-with-level` review item, written
// against the `structured-2d` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   Ice gaps widen every third level
//
//   At levels 1, 4 and 7 every ice lane's gap is its base gap plus
//   floor((level - 1) / 3) tiles, within a tenth of a tile.
//
// Its declared media: image `scene`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("ice/gap-widens-with-level has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

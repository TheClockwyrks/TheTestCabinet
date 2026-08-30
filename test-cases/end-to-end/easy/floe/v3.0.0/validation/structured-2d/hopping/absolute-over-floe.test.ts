// Floe — hopping/absolute-over-floe: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `hopping.absolute-over-floe` review item, written
// against the `structured-2d` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   A hop is one absolute tile while riding
//
//   A critter riding a rightward floe and hopping up has its centre set
//   exactly to the target tile's centre, (tileCX(col), tileCY(row)), one row
//   up and in the column its centre was in when the hop was taken, rather than
//   translated by 32 and left between columns or offset by the floe's motion.
//
// Its declared media: replay `hop`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("hopping/absolute-over-floe has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

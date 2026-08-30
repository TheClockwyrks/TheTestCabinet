// Floe — hopping/one-tile-per-press: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `hopping.one-tile-per-press` review item, written
// against the `structured-2d` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   One press moves exactly one tile
//
//   A single press and release moves the critter exactly one tile, whatever
//   the pressed key is held for afterwards within the cooldown.
//
// Its declared media: replay `hop`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("hopping/one-tile-per-press has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

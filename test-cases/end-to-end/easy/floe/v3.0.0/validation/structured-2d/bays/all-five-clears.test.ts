// Floe — bays/all-five-clears: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `bays.all-five-clears` review item, written
// against the `structured-2d` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   The fifth bay clears the level
//
//   With four bays posed filled, the hop that fills the fifth moves the phase
//   to clearing.
//
// Its declared media: replay `clear`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("bays/all-five-clears has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

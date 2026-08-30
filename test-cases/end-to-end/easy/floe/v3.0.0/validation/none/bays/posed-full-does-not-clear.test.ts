// Floe — bays/posed-full-does-not-clear: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `bays.posed-full-does-not-clear` review item, written
// against the `none` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   Five posed bays clear nothing
//
//   Five bays posed filled with no hop leaves the phase crossing and the level
//   unchanged over five seconds.
//
// Its declared media: image `posed`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("bays/posed-full-does-not-clear has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

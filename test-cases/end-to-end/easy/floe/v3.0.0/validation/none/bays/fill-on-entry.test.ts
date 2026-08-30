// Floe — bays/fill-on-entry: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `bays.fill-on-entry` review item, written
// against the `none` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   A hop into an open bay fills it
//
//   A hop up from row 2 into an open bay reports that bay filled and no other.
//
// Its declared media: replay `fill`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("bays/fill-on-entry has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

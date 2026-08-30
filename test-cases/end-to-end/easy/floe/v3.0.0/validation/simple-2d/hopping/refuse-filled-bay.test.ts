// Floe — hopping/refuse-filled-bay: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `hopping.refuse-filled-bay` review item, written
// against the `simple-2d` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   A hop into a filled bay is refused
//
//   A hop up from row 2 under a bay posed filled leaves the critter on row 2
//   and costs no life; the same hop with the bay open is accepted.
//
// Its declared media: replay `refuse`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("hopping/refuse-filled-bay has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

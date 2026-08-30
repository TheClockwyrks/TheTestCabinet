// Floe — hopping/refuse-far-shore: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `hopping.refuse-far-shore` review item, written
// against the `structured-2d` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   A hop into the solid far shore is refused
//
//   A hop up from row 2 at a column outside every bay pair leaves the critter
//   on row 2 and costs no life.
//
// Its declared media: replay `refuse`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("hopping/refuse-far-shore has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

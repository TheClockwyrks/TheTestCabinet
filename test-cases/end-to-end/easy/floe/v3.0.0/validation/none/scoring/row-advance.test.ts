// Floe — scoring/row-advance: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `scoring.row-advance` review item, written
// against the `none` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   A newly reached row scores ten
//
//   A hop to a row above every row this crossing has reached adds SCORE_ROW
//   (10).
//
// Its declared media: replay `score`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("scoring/row-advance has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

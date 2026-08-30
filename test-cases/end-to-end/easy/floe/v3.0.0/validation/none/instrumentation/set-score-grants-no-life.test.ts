// Floe — instrumentation/set-score-grants-no-life: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `instrumentation.set-score-grants-no-life` review item, written
// against the `none` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   Posing the score grants no bonus life
//
//   setScore across a BONUS_LIFE_EVERY (10,000) boundary leaves lives exactly
//   as it was: the award belongs to the scoring path, and a pose is a
//   precondition.
//
// Its declared media: image `after`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("instrumentation/set-score-grants-no-life has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

// Floe — scoring/time-bonus: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `scoring.time-bonus` review item, written
// against the `none` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   Two points a whole second left
//
//   With the timer posed at 7.4 s, the same hop adds SCORE_TIME_BONUS * 7 (14)
//   more than it does with the timer at 0.
//
// Its declared media: replay `score`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("scoring/time-bonus has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

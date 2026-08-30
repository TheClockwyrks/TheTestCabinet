// Floe — scoring/victory-bonus: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `scoring.victory-bonus` review item, written
// against the `structured-2d` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   Victory pays two-fifty a life
//
//   Winning with 3 lives adds SCORE_VICTORY_LIFE * 3 (750) on top of the
//   level-clear award.
//
// Its declared media: replay `score`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("scoring/victory-bonus has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

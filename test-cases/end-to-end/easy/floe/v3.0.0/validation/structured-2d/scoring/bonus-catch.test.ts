// Floe — scoring/bonus-catch: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `scoring.bonus-catch` review item, written
// against the `structured-2d` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   The bonus catch pays two hundred
//
//   With the fish posed in a bay and the timer at 0, the hop that fills that
//   bay adds SCORE_BONUS_CATCH (200) more than the same hop into a bay with no
//   fish.
//
// Its declared media: replay `score`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("scoring/bonus-catch has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

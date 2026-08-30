// Floe — progression/bonus-life-at-10000: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `progression.bonus-life-at-10000` review item, written
// against the `structured-2d` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   A bonus life at every ten thousand
//
//   With the score posed just below BONUS_LIFE_EVERY (10,000), a real award
//   that crosses it raises lives by one.
//
// Its declared media: replay `bonus`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("progression/bonus-life-at-10000 has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

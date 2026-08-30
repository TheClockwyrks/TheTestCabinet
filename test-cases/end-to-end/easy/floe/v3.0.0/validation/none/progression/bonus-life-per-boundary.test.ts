// Floe — progression/bonus-life-per-boundary: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `progression.bonus-life-per-boundary` review item, written
// against the `none` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   A big gain awards a life per boundary
//
//   A single real award crossing two BONUS_LIFE_EVERY boundaries raises lives
//   by two.
//
// Its declared media: replay `bonus`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("progression/bonus-life-per-boundary has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

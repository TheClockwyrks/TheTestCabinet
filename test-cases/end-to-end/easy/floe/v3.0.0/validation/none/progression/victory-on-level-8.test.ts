// Floe — progression/victory-on-level-8: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `progression.victory-on-level-8` review item, written
// against the `none` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   Clearing level 8 wins
//
//   At level TOTAL_LEVELS (8) with four bays filled, the hop that fills the
//   fifth moves the screen to victory.
//
// Its declared media: replay `victory`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("progression/victory-on-level-8 has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

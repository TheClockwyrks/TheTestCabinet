// Floe — progression/timer-shortens: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `progression.timer-shortens` review item, written
// against the `none` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   The crossing timer shortens with the level
//
//   At each level 1 through 8, timerMax is max(TIMER_MIN, TIMER_BASE - (level
//   - 1) * TIMER_PER_LEVEL), so level 8 reads 16.
//
// Its declared media: image `levels`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("progression/timer-shortens has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

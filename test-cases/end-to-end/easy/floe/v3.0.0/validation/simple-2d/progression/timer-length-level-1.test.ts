// Floe — progression/timer-length-level-1: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `progression.timer-length-level-1` review item, written
// against the `simple-2d` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   A level-1 crossing gets thirty seconds
//
//   A run opened at level 1 reports timerMax and timer at TIMER_BASE (30).
//
// Its declared media: image `start`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("progression/timer-length-level-1 has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

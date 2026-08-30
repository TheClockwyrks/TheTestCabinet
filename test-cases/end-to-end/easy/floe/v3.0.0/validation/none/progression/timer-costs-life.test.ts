// Floe — progression/timer-costs-life: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `progression.timer-costs-life` review item, written
// against the `none` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   The crossing timer costs a life
//
//   With the timer running and posed at 0.5 s, timer reaches 0 and the phase
//   becomes dying on that same tick, with lives down one.
//
// Its declared media: replay `expire`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("progression/timer-costs-life has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

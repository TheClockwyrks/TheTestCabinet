// Floe — presentation/hud-timer: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `presentation.hud-timer` review item, written
// against the `none` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   The HUD shows the crossing timer
//
//   The timer readout is drawn inside the HUD bar and follows timer: it reads
//   one figure with the timer posed at one value and a different figure with
//   it posed at another. timerRunning stays off throughout, so the item stays
//   outside the closed gate table.
//
// Its declared media: image `hud`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("presentation/hud-timer has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

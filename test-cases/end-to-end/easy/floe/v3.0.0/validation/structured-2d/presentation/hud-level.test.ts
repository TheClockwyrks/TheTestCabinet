// Floe — presentation/hud-level: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `presentation.hud-level` review item, written
// against the `structured-2d` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   The HUD shows the level out of eight
//
//   The level readout carries HUD_LEVEL_LABEL (LEVEL), the current level and
//   the total 8.
//
// Its declared media: image `hud`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("presentation/hud-level has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

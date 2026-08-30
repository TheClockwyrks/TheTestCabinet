// Floe — presentation/hud-bays: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `presentation.hud-bays` review item, written
// against the `simple-2d` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   The HUD marks the filled bays
//
//   The HUD's bay readout, the fifth readout specs/ui.md fixes, marks each bay
//   at that bay's own position: the mark for a bay changes when that bay is
//   posed filled, and the mark for a bay that stays open does not.
//
// Its declared media: image `hud`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("presentation/hud-bays has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

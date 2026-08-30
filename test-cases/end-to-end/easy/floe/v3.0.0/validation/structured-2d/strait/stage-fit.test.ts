// Floe — strait/stage-fit: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `strait.stage-fit` review item, written
// against the `structured-2d` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   The whole stage stays visible and centred
//
//   The entire 1280x720 stage, the full HUD bar, the whole strait and all four
//   edges, is visible, fitted and centred at three window sizes and two pixel
//   densities, including on load before any input.
//
// Its declared media: image `fit`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("strait/stage-fit has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

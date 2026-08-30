// Floe — instrumentation/deterministic-core: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `instrumentation.deterministic-core` review item, written
// against the `none` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   The simulation advances on stepped time alone
//
//   One second of game time covered as one call of 120 ticks and as 120 calls
//   of one tick adds 1.0 to simTime either way and leaves every vehicle within
//   a tenth of a unit of the same x, so the simulation reads nothing from the
//   renderer.
//
// Its declared media: image `after`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("instrumentation/deterministic-core has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

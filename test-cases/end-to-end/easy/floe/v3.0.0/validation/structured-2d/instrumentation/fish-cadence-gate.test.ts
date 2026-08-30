// Floe — instrumentation/fish-cadence-gate: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `instrumentation.fish-cadence-gate` review item, written
// against the `structured-2d` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   Cadence off keeps the bonus catch away
//
//   With setFishCadence(false) fishBay is null over sixty seconds of a live
//   crossing; with it on, a bay holds one.
//
// Its declared media: image `gate`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("instrumentation/fish-cadence-gate has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

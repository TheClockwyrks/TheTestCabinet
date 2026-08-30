// Floe — instrumentation/tick-length: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `instrumentation.tick-length` review item, written
// against the `structured-2d` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   A tick is a fixed 1/120 of a second
//
//   TICK_HZ (120) ticks of game time raise simTime by exactly 1.0 s, and a
//   lane at 2.0 tiles/s advances exactly 64 units over them.
//
// Its declared media: image `after`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("instrumentation/tick-length has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

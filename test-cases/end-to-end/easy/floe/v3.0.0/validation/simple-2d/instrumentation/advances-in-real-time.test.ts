// Floe — instrumentation/advances-in-real-time: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `instrumentation.advances-in-real-time` review item, written
// against the `simple-2d` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   The game advances itself in real time
//
//   On a real wall clock, with nothing stepping the game from outside —
//   setAutoStep(true) under none, the engine's own clock rather than a
//   ConstantClock under an engine — simTime rises and a released lane item's x
//   changes over a stretch of real time. This is the item that decides
//   setAutoStep, and the only item in the suite that does not step the game
//   itself.
//
// Its declared media: image `before`, image `after`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("instrumentation/advances-in-real-time has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

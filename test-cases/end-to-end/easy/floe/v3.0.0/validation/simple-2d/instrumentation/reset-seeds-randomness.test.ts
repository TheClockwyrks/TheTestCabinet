// Floe — instrumentation/reset-seeds-randomness: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `instrumentation.reset-seeds-randomness` review item, written
// against the `simple-2d` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   reset seeds the game's randomness
//
//   Two runs started after reset({ seed: 7 }) lay the sixteen lanes at
//   identical phases and put the first bonus catch in the same bay; a run
//   after reset({ seed: 8 }) differs in at least one of them.
//
// Its declared media: image `seeded`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("instrumentation/reset-seeds-randomness has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

// Floe — hunter/second-bear-from-level-5: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `hunter.second-bear-from-level-5` review item, written
// against the `simple-2d` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   A second bear hunts from level 5
//
//   At level SECOND_BEAR_LEVEL (5) with emergence on, two bears join the
//   roster, the second once the critter has advanced BEAR_EMERGE_ADVANCE +
//   BEAR_SECOND_ADVANCE (6) rows and BEAR_EMERGE_DELAY + BEAR_SECOND_DELAY
//   (2.0 s) have passed.
//
// Its declared media: replay `two`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("hunter/second-bear-from-level-5 has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

// Floe — hunter/no-second-bear-below-level-5: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `hunter.no-second-bear-below-level-5` review item, written
// against the `structured-2d` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   One bear hunts below level 5
//
//   At level 4 with emergence on and the critter advanced twelve rows, the
//   roster never holds more than one bear over sixty seconds.
//
// Its declared media: replay `one`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("hunter/no-second-bear-below-level-5 has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

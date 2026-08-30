// Floe — hunter/at-most-two-bears: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `hunter.at-most-two-bears` review item, written
// against the `structured-2d` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   Never more than two bears hunt
//
//   At level 8 with emergence on and the critter advanced twelve rows, the
//   roster never holds more than MAX_BEARS (2) bears over sixty seconds.
//
// Its declared media: replay `two`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("hunter/at-most-two-bears has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

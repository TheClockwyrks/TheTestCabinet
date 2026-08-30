// Floe — hunter/pursues: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `hunter.pursues` review item, written
// against the `simple-2d` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   A bear closes on the critter
//
//   On an emptied strait, a bear posed twelve tiles from the critter has its
//   Manhattan tile distance to it strictly smaller after three seconds of game
//   time.
//
// Its declared media: replay `pursue`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("hunter/pursues has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

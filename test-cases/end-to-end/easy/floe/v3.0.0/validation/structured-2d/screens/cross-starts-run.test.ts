// Floe — screens/cross-starts-run: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `screens.cross-starts-run` review item, written
// against the `structured-2d` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   Confirming CROSS opens a live crossing
//
//   Confirming the first title item opens playing at level 1, three lives, a
//   full timer, five open bays and the critter on the near shore.
//
// Its declared media: image `game`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("screens/cross-starts-run has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

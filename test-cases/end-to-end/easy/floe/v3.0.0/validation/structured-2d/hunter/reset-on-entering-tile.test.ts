// Floe — hunter/reset-on-entering-tile: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `hunter.reset-on-entering-tile` review item, written
// against the `structured-2d` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   Traffic arriving on the tile it is entering removes it
//
//   A vehicle released so its span reaches the tile a mid-glide bear is
//   entering takes that bear off the roster.
//
// Its declared media: replay `reset`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("hunter/reset-on-entering-tile has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

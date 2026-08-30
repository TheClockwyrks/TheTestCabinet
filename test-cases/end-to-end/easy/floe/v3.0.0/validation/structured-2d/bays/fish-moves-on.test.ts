// Floe — bays/fish-moves-on: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `bays.fish-moves-on` review item, written
// against the `structured-2d` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   The next bonus catch is elsewhere
//
//   The fish that follows a fish that has lingered out appears in a different
//   open bay.
//
// Its declared media: image `fish`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("bays/fish-moves-on has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

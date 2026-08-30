// Floe — bays/fish-lingers: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `bays.fish-lingers` review item, written
// against the `none` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   The bonus catch lingers five seconds
//
//   A fish stays in the bay it appeared in for FISH_LINGER (5 s), within a
//   tenth of a second.
//
// Its declared media: image `fish`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("bays/fish-lingers has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

// Floe — audio/cue-level-clear: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `audio.cue-level-clear` review item, written
// against the `none` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   Clearing a level plays its cue
//
//   Filling the fifth bay below level 8 plays the levelClear cue.
//
// Its declared media: replay `clear`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("audio/cue-level-clear has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

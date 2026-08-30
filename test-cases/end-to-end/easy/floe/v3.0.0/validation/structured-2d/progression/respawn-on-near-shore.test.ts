// Floe — progression/respawn-on-near-shore: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `progression.respawn-on-near-shore` review item, written
// against the `structured-2d` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   The fresh critter starts on the near shore
//
//   After the death pause the critter is on row 19 at START_COL (20), facing
//   up, with bestRow back at 19.
//
// Its declared media: replay `respawn`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("progression/respawn-on-near-shore has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

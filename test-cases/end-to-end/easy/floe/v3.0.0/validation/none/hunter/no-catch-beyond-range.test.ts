// Floe — hunter/no-catch-beyond-range: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `hunter.no-catch-beyond-range` review item, written
// against the `none` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   A bear just out of reach catches nothing
//
//   With the catch test on, a bear posed 24 units from the critter's centre
//   with its travel off costs no life over three seconds.
//
// Its declared media: replay `near`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("hunter/no-catch-beyond-range has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

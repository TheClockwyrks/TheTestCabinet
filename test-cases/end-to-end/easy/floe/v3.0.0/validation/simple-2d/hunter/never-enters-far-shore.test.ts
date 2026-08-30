// Floe — hunter/never-enters-far-shore: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `hunter.never-enters-far-shore` review item, written
// against the `simple-2d` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   The far shore is closed to a bear
//
//   A bear on row 2 sent up is refused and stays on row 2; the same holds for
//   a bear sent up from row 1 toward row 0.
//
// Its declared media: replay `refuse`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("hunter/never-enters-far-shore has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

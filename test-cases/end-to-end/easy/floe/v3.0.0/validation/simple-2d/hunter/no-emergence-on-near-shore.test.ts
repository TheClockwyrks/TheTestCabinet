// Floe — hunter/no-emergence-on-near-shore: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `hunter.no-emergence-on-near-shore` review item, written
// against the `simple-2d` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   A critter on the near shore is not hunted
//
//   With emergence on and the critter left on row 19, no bear joins the roster
//   over thirty seconds of game time.
//
// Its declared media: replay `wait`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("hunter/no-emergence-on-near-shore has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

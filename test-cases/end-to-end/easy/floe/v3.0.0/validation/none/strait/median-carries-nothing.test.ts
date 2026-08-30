// Floe — strait/median-carries-nothing: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `strait.median-carries-nothing` review item, written
// against the `none` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   The median shelf is clear footing
//
//   The median (row 10) carries no vehicle and no floe on a freshly laid-out
//   level, and a critter standing on it reports footing solid over ten seconds
//   of live lanes.
//
// Its declared media: replay `median`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("strait/median-carries-nothing has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

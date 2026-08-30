// Floe — hunter/emerges-after-advance: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `hunter.emerges-after-advance` review item, written
// against the `structured-2d` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   A bear emerges once the critter has advanced
//
//   With emergence on and the critter posed BEAR_EMERGE_ADVANCE (3) rows above
//   the near shore, a bear joins the roster once BEAR_EMERGE_DELAY (0.6 s) of
//   the crossing has passed.
//
// Its declared media: replay `emerge`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("hunter/emerges-after-advance has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

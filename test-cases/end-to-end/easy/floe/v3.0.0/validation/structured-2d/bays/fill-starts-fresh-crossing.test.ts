// Floe — bays/fill-starts-fresh-crossing: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `bays.fill-starts-fresh-crossing` review item, written
// against the `structured-2d` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   A filled bay begins a new crossing
//
//   After BAYFILL_PAUSE the critter is back on the near shore at START_COL
//   with the timer at timerMax.
//
// Its declared media: replay `fill`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("bays/fill-starts-fresh-crossing has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

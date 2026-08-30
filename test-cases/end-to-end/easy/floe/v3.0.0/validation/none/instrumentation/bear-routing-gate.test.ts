// Floe — instrumentation/bear-routing-gate: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `instrumentation.bear-routing-gate` review item, written
// against the `none` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   Routing off stops a bear choosing
//
//   A bear with setBearRouting(id, false) finishes the step it is on and then
//   holds that tile over three seconds, while its target still follows the
//   critter; a second bear with routing on keeps stepping.
//
// Its declared media: replay `gate`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("instrumentation/bear-routing-gate has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

// Floe — hunter/no-route-steps-closer: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `hunter.no-route-steps-closer` review item, written
// against the `structured-2d` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   With no open route a bear still steps closer
//
//   With a full row of parked vehicles sealing the target's row so no open
//   route to it exists, the bear commits a step into whichever open
//   neighbouring tile most shortens its tile distance to the target, rather
//   than standing still.
//
// Its declared media: replay `route`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("hunter/no-route-steps-closer has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

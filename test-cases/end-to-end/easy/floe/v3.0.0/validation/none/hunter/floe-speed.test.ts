// Floe — hunter/floe-speed: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `hunter.floe-speed` review item, written
// against the `none` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   A bear on a floe travels at its ice speed
//
//   A bear stepped across a water row whose tiles a parked raft covers travels
//   at the ice speed rather than the swim speed.
//
// Its declared media: replay `swim`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("hunter/floe-speed has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

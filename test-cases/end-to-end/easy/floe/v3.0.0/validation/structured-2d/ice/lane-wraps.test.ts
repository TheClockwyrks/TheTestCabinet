// Floe — ice/lane-wraps: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `ice.lane-wraps` review item, written
// against the `structured-2d` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   A lane's spacing survives the edge
//
//   Over ten seconds of game time, every ice lane's gaps stay at their stated
//   value, so a vehicle leaving one edge re-enters at the other without
//   breaking the pattern.
//
// Its declared media: replay `wrap`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("ice/lane-wraps has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

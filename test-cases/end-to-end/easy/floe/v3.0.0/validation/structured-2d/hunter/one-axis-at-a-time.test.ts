// Floe — hunter/one-axis-at-a-time: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `hunter.one-axis-at-a-time` review item, written
// against the `structured-2d` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   A bear travels one grid axis at a time
//
//   Over four seconds of pursuit, no tick changes both the bear's centre x and
//   its centre y.
//
// Its declared media: replay `glide`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("hunter/one-axis-at-a-time has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

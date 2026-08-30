// Floe — hunter/swims-flag: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `hunter.swims-flag` review item, written
// against the `simple-2d` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   A bear over open water reports swimming
//
//   A bear whose entering tile is a water tile no floe covers reports swimming
//   true; over ice, over the median and on a floe it reports false.
//
// Its declared media: replay `swim`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("hunter/swims-flag has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

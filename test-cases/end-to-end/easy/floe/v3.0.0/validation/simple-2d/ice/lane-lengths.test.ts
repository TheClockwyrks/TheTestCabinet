// Floe — ice/lane-lengths: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `ice.lane-lengths` review item, written
// against the `simple-2d` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   Each vehicle spans its stated tiles
//
//   A plow reports len 3, a dogsled 2 and a car 2, on every lane that carries
//   one.
//
// Its declared media: image `scene`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("ice/lane-lengths has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

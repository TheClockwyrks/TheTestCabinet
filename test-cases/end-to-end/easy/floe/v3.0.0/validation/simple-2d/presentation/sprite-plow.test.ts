// Floe — presentation/sprite-plow: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `presentation.sprite-plow` review item, written
// against the `simple-2d` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   The plow is drawn from its seeded frame
//
//   A plow is drawn from assets/plow/0.png at 96 units wide over the three
//   tiles it spans.
//
// Its declared media: image `scene`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("presentation/sprite-plow has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

// Floe — presentation/sprite-crosser-facing: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `presentation.sprite-crosser-facing` review item, written
// against the `simple-2d` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   The critter's frame matches its facing
//
//   With the critter facing each of the four directions in turn, the frame
//   drawn is from that facing's pair as specs/assets.md tabulates them.
//
// Its declared media: image `scene`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("presentation/sprite-crosser-facing has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

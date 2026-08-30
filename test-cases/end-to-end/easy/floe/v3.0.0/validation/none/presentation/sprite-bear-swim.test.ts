// Floe — presentation/sprite-bear-swim: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `presentation.sprite-bear-swim` review item, written
// against the `none` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   A submerged bear is drawn from its swim frames
//
//   A bear whose entering tile is open water is drawn from the swim set for
//   its heading (frames 8 to 15).
//
// Its declared media: replay `swim`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("presentation/sprite-bear-swim has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

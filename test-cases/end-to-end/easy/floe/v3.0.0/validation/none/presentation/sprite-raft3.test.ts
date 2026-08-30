// Floe — presentation/sprite-raft3: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `presentation.sprite-raft3` review item, written
// against the `none` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   The three-tile raft is drawn from its seeded frame
//
//   A three-tile floe is drawn from the left 96 x 32 of assets/raft/0.png,
//   over the three tiles it spans.
//
// Its declared media: image `scene`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("presentation/sprite-raft3 has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

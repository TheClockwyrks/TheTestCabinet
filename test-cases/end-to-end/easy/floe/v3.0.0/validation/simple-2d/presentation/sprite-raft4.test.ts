// Floe — presentation/sprite-raft4: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `presentation.sprite-raft4` review item, written
// against the `simple-2d` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   The four-tile raft is drawn from its seeded frame
//
//   A four-tile floe is drawn from the whole of assets/raft/1.png, over the
//   four tiles it spans.
//
// Its declared media: image `scene`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("presentation/sprite-raft4 has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

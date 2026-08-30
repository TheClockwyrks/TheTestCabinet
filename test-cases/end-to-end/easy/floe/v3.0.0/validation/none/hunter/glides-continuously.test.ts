// Floe — hunter/glides-continuously: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `hunter.glides-continuously` review item, written
// against the `none` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   A bear glides rather than hops
//
//   A bear given one step reports a centre strictly between the two tile
//   centres on at least four consecutive ticks, so it moves continuously
//   rather than jumping tile to tile.
//
// Its declared media: replay `glide`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("hunter/glides-continuously has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

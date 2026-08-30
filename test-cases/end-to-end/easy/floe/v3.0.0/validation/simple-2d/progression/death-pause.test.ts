// Floe — progression/death-pause: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `progression.death-pause` review item, written
// against the `simple-2d` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   A death pauses before the respawn
//
//   A drowning holds the phase at dying for DEATH_PAUSE (0.9 s), within a
//   tenth of a second, before a critter is back on the strait. That the other
//   four deaths reach dying at all is each of their own items' requirement, so
//   this one asserts the duration and poses the cheapest death to reach.
//
// Its declared media: replay `pause`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("progression/death-pause has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

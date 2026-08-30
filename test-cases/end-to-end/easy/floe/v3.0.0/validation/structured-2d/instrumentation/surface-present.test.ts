// Floe — instrumentation/surface-present: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `instrumentation.surface-present` review item, written
// against the `structured-2d` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   The debug surface is present and complete
//
//   Every operation specs/instrumentation.md names is a function on the
//   surface, version is FLOE_DEBUG_VERSION (1), and the surface is live: a
//   posed critter reads back on its tile and a posed bear given one step
//   arrives on the next tile.
//
// Its declared media: image `state`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("instrumentation/surface-present has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

// Floe — instrumentation/entity-ids: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `instrumentation.entity-ids` review item, written
// against the `simple-2d` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   Every entity carries a distinct, stable id
//
//   Each bear, vehicle and floe added takes an id distinct from every other
//   live entity's, appears last in its roster, and keeps that id across a
//   second of game time including a lane wrap.
//
// Its declared media: image `roster`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("instrumentation/entity-ids has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

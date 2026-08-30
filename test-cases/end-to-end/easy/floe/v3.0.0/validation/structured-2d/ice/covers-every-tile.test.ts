// Floe — ice/covers-every-tile: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `ice.covers-every-tile` review item, written
// against the `structured-2d` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   Every tile a vehicle spans is closed
//
//   A hop into each of the three tiles a parked plow spans, including its
//   middle tile, is refused.
//
// Its declared media: replay `refuse`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("ice/covers-every-tile has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

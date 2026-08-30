// Floe — strait/tile-map: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `strait.tile-map` review item, written
// against the `none` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   Tiles sit where the map says
//
//   A critter posed on each of eight spread tiles reports its centre at (32c +
//   16, 80 + 32r + 16) exactly.
//
// Its declared media: image `tiles`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("strait/tile-map has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

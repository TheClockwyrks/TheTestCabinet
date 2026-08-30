// Floe — strait/band-rows: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `strait.band-rows` review item, written
// against the `structured-2d` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   The five bands occupy their rows
//
//   The critter posed on row 19, on each ice row, on row 10 and on each water
//   row reports footing solid, solid, solid and water respectively on an
//   emptied strait, so the band boundaries are exactly where specs/strait.md
//   puts them.
//
// Its declared media: image `bands`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("strait/band-rows has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

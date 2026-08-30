// Floe — strait/bands-read-apart: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `strait.bands-read-apart` review item, written
// against the `structured-2d` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   The five bands read distinct
//
//   The near shore, the ice band, the median, the water band and the far shore
//   render in tints each separated from the others by at least 40 of 441 RGB
//   distance, sampled across the full width of each.
//
// Its declared media: image `scene`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("strait/bands-read-apart has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

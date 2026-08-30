// Floe — presentation/bear-reads-apart: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `presentation.bear-reads-apart` review item, written
// against the `structured-2d` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   A bear reads apart from its footing
//
//   A bear's drawn pixels are at least 60 of 441 from the band under it, on
//   the near shore, on the ice band and on the median.
//
// Its declared media: image `scene`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("presentation/bear-reads-apart has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

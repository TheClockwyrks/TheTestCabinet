// Floe — presentation/submerged-bear-visible: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `presentation.submerged-bear-visible` review item, written
// against the `simple-2d` engine. Until then it FAILS, deliberately and loudly:
// a stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   A submerged bear stays trackable
//
//   Where a swimming bear stands, the pixels drawn are at least 60 of 441 from
//   the water around it, so it is never invisible.
//
// Its declared media: replay `swim`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("presentation/submerged-bear-visible has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

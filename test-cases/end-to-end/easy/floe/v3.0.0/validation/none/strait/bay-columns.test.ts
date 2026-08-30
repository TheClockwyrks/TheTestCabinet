// Floe — strait/bay-columns: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `strait.bay-columns` review item, written
// against the `none` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   Five bays at the stated columns
//
//   A hop up from row 2 is accepted at exactly columns 3, 4, 11, 12, 19, 20,
//   27, 28, 35 and 36 with the bays open.
//
// Its declared media: replay `bays`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("strait/bay-columns has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

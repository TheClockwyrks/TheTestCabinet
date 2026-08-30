// Floe — hunter/emerges-at-near-shore: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `hunter.emerges-at-near-shore` review item, written
// against the `none` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   A bear emerges on the near shore
//
//   The bear that emerges reports row 19 on the tick it joins the roster.
//
// Its declared media: replay `emerge`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("hunter/emerges-at-near-shore has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

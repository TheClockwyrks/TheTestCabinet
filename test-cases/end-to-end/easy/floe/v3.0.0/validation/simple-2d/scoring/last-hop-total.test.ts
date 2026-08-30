// Floe — scoring/last-hop-total: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `scoring.last-hop-total` review item, written
// against the `simple-2d` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   The completing hop pays all three
//
//   With the timer posed at 12.0 s, the hop that completes a crossing adds
//   exactly 10 + 50 + 2 * 12 (84).
//
// Its declared media: replay `score`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("scoring/last-hop-total has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

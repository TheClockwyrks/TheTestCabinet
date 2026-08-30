// Floe — scoring/bay-award: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `scoring.bay-award` review item, written
// against the `structured-2d` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   Filling a bay scores fifty
//
//   With the timer at 0 and the timer gate off, a hop into an open bay adds
//   SCORE_BAY + SCORE_ROW (60), so the bay's own award is 50.
//
// Its declared media: replay `score`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("scoring/bay-award has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

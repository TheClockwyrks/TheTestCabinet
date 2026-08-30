// Floe — scoring/no-bonus-catch-elsewhere: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `scoring.no-bonus-catch-elsewhere` review item, written
// against the `simple-2d` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   Another bay pays no bonus
//
//   With the fish posed in bay 0 and the timer at 0, a hop into bay 3 adds
//   exactly the completing hop's own total.
//
// Its declared media: replay `score`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("scoring/no-bonus-catch-elsewhere has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

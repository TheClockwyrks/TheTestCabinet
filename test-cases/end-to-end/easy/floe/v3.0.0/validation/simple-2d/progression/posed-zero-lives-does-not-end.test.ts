// Floe — progression/posed-zero-lives-does-not-end: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `progression.posed-zero-lives-does-not-end` review item, written
// against the `simple-2d` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   Zero lives posed ends nothing
//
//   lives posed at 0 with no death leaves the screen playing and the phase
//   crossing over five seconds.
//
// Its declared media: image `posed`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("progression/posed-zero-lives-does-not-end has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

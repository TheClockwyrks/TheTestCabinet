// Floe — instrumentation/reset-restores-title: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `instrumentation.reset-restores-title` review item, written
// against the `simple-2d` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   reset returns the game to its title values
//
//   After a run has been posed with a score, lives, a level, a critter, bears,
//   lane items, filled bays and a fish, reset() restores every declared field
//   to the title value the spec lists, and leaves muted untouched.
//
// Its declared media: image `title`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("instrumentation/reset-restores-title has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

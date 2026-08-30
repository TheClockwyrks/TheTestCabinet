// Floe — screens/title-highlight: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `screens.title-highlight` review item, written
// against the `structured-2d` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   The highlighted menu item reads as highlighted
//
//   The highlighted title item is drawn differently from the unhighlighted
//   one, by at least 40 of 441 RGB distance over its glyph pixels.
//
// Its declared media: image `title`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("screens/title-highlight has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

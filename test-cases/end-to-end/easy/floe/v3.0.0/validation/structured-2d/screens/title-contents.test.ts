// Floe — screens/title-contents: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `screens.title-contents` review item, written
// against the `structured-2d` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   The title screen shows the title and its menu
//
//   The title screen draws TITLE_TEXT (FLOE), TAGLINE_TEXT (DON'T LOOK BACK)
//   and both entries of TITLE_ITEMS.
//
// Its declared media: image `title`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("screens/title-contents has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});

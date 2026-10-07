// screens/howto-back-returns — `back` returns from the how-to screen to the
// title.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`howto`"): "`back` returns to
// `title` with `HOW TO PLAY` selected", which "Menu navigation" states as the
// rule for `title`: it "selects the entry that led away from it".
// `HOW TO PLAY` is `TITLE_ITEMS[2]`. specs/controls.md ("What each screen
// reads"), the `howto` row: "`back` returns to `title`; `mute`".
// specs/controls.md ("Actions and bindings"): "`back` | `Escape` | edge".
//
// WHY THE WORLD IS POSED AS IT IS. The how-to screen is entered through
// `setScreen("howto")`, which stands the game on it without touching a menu, so
// a build with a broken title menu fails the title points rather than this
// one. The screen is read
// back before the press, and the press is a REAL `Escape` through Chromium's
// input pipeline held across exactly one frame.
//
// THE TOLERANCE. None: a screen name and an index are exact comparisons.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  poseScreen,
  pressBack,
  type Harness,
} from "../harness";
import { assertHighlight } from "./stage";

/** Where `HOW TO PLAY`, the entry that led away from the title, sits. */
const HOW_TO_PLAY = TITLE_ITEMS.indexOf("HOW TO PLAY");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads title with HOW TO PLAY selected after Escape on howto", async () => {
  const howto = await poseScreen(h, "howto");
  assertEqual(howto.screen, "howto", "the screen the press is made on");

  const after = await pressBack(h);
  await captureStill(h, "back");

  assertHighlight(
    after,
    "title",
    HOW_TO_PLAY,
    "after Escape on the how-to screen",
  );
});

// screens/title-confirm-how-to-play — `confirm` on `HOW TO PLAY` opens the
// how-to screen.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`title`"): "`confirm` takes the
// highlighted item", and the item row "`HOW TO PLAY` | Sets `screen = howto`
// and `menuIndex = 0`." The item is the last of `TITLE_ITEMS`, "`LIGHT THE
// LAMP`, `THE ALMANAC`, `HOW TO PLAY`, in that order". specs/ui.md ("Menu
// navigation"): "`menuIndex` is `0` on entering every screen, and on a screen
// with no menu it stays `0`."
//
// WHY THE WORLD IS POSED AS IT IS. The surface carries no pose for `menuIndex`,
// so `HOW TO PLAY` is highlighted the only way it can be: one `ArrowDown` per
// item above it, from the `0` the title is entered on, with the index read back
// before the confirm so that a build whose `down` is broken fails on the
// precondition rather than confirming the wrong item. Every press is a REAL key
// through Chromium's input pipeline, each held across exactly one frame.
//
// THE TOLERANCE. None: a screen name and an index are exact comparisons.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  pressConfirm,
  pressDown,
  type Harness,
} from "../harness";
import { assertHighlight } from "./stage";

/** The index of `HOW TO PLAY` in `TITLE_ITEMS`. */
const HOW_TO_PLAY = TITLE_ITEMS.indexOf("HOW TO PLAY");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("enters howto with menuIndex 0 when Enter takes HOW TO PLAY", async () => {
  const title = await h.snapshot();
  assertEqual(title.screen, "title", "the screen the press is made on");
  let posed = title;
  for (let i = 0; i < HOW_TO_PLAY; i += 1) posed = await pressDown(h);
  assertEqual(
    posed.menuIndex,
    HOW_TO_PLAY,
    "the highlighted item, HOW TO PLAY",
  );

  const after = await pressConfirm(h);
  await captureStill(h, "howto");

  assertHighlight(after, "howto", 0, "after Enter took HOW TO PLAY");
});

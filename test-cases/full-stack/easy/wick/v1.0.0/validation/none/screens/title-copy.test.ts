// screens/title-copy — the title screen draws its title, its tagline, and its
// two menu items, stacked.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`title`") fixes the copy: the
// title `TITLE_TEXT` (`WICK`), the tagline `TAGLINE_TEXT` (`KEEP THE LIGHT`),
// and the menu `TITLE_ITEMS`, "`LIGHT THE LAMP`, `HOW TO PLAY`, in that
// order", of which "The menu's items are stacked one above the next under the
// title and tagline." specs/ui.md ("Presentation") fixes "no palette, no font,
// no layout, and no styling", so the copy is looked for folded and the only
// arrangement asserted is the one the file states: the first item above the
// second.
//
// WHY THE WORLD IS POSED AS IT IS. Nothing is posed: the harness's opening
// reset leaves the game on `title`, which is where this copy lives, and one
// frame is run to read what it draws. No menu is touched, so the frame read is
// the screen as it is entered.
//
// THE TOLERANCE. The copy is matched folded — lower-cased, with spaces, dashes
// and underscores removed, across consecutive runs of text — so a build that
// letter-spaces its title, wraps its highlighted item in marks of its own, or
// draws a line word by word passes. The stacking is a strict inequality between
// two drawn rows, which no tolerance can soften.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TAGLINE_TEXT, TITLE_ITEMS, TITLE_TEXT } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { assertShows, assertStacked, shown } from "./stage";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws WICK, KEEP THE LIGHT, and the two menu items stacked", async () => {
  const title = await h.snapshot();
  assertEqual(title.screen, "title", "the screen the frame is read on");

  const page = await shown(h);
  await captureStill(h, "title");

  assertShows(page, TITLE_TEXT, "the title screen");
  assertShows(page, TAGLINE_TEXT, "the title screen");
  assertShows(page, TITLE_ITEMS[0], "the title screen");
  assertShows(page, TITLE_ITEMS[1], "the title screen");
  assertStacked(page, TITLE_ITEMS[0], TITLE_ITEMS[1], "the title menu");
});

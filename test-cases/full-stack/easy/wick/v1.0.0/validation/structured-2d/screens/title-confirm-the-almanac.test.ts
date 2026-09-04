// Wick — screens/title-confirm-the-almanac: confirming `THE ALMANAC` opens the
// almanac.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`title`", lists
// `TITLE_ITEMS` as "`LIGHT THE LAMP`, `THE ALMANAC`, `HOW TO PLAY`, in that
// order" and gives the second item its row: "`THE ALMANAC` | Sets
// `screen = almanac`, with `menuIndex`, `almanacTab`, and `almanacScroll` all
// `0`." `specs/controls.md` gives the `title` row "`up`, `down` move the
// highlight, wrapping; `confirm` takes the highlighted item" and binds `down`
// to `ArrowDown` and `confirm` to `Enter`.
//
// WHAT IS READ. The screen the confirming press left, and the three indices
// the almanac arrives with. The item is reached from the menu rather than
// posed, because what this point decides is the route the second title item
// takes.
//
// THE DRIVE. `reset` to the title, where `menuIndex` is `0`, one `ArrowDown`
// onto index `1`, and one `Enter`. The index is read before the confirm, so a
// build whose highlight never moved fails on the move rather than on the
// item.
//
// THE TOLERANCE. None: a screen name and three indices.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import { captureStill, createHarness, tap, type Harness } from "../harness";

/** The index of `THE ALMANAC` in the title menu, and the item at it. */
const ALMANAC_ITEM = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads almanac with menuIndex, almanacTab, and almanacScroll all 0", async () => {
  assertEqual(
    TITLE_ITEMS[ALMANAC_ITEM],
    "THE ALMANAC",
    "the second item of TITLE_ITEMS (specs/ui.md, title)",
  );

  h.reset();
  const highlighted = await tap(h, "ArrowDown");
  assertEqual(
    highlighted.menuIndex,
    ALMANAC_ITEM,
    "menuIndex after one ArrowDown on the title",
  );

  const opened = await tap(h, "Enter");
  captureStill(h, "almanac");

  assertEqual(
    opened.screen,
    "almanac",
    "the screen confirming THE ALMANAC left (specs/ui.md, title)",
  );
  assertEqual(opened.menuIndex, 0, "menuIndex on entering the almanac");
  assertEqual(opened.almanacTab, 0, "almanacTab on entering the almanac");
  assertEqual(opened.almanacScroll, 0, "almanacScroll on entering the almanac");
});

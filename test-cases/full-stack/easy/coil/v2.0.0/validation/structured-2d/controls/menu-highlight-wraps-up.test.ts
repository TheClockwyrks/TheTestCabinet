// controls/menu-highlight-wraps-up — up on the first item moves the highlight to
// the last.
//
// specs/controls.md, on a menu-bearing screen: `up` moves the highlight "up one
// item, wrapping at the ends". This is the wrap at the top end alone. The wrap at
// the bottom is `controls/menu-highlight-wraps-down`, and they are two points
// because they are two directions of one rule and a build commonly implements one
// of them.
//
// The menu read is the title's, whose `TITLE_ITEMS` specs/ui.md fixes at two
// entries — the mode's, then `HOW TO PLAY` — so the last item is index `1`, and
// specs/ui.md arrives at the title on `titleIndex`, which a fresh session opens
// at `0`. The highlight is put on the first item through the surface rather than
// left where the reset put it, so what the press is read against is stated rather
// than assumed.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { KEY, TITLE_ITEM_COUNT } from "../constants";
import {
  captureStill,
  createHarness,
  openTitle,
  type Harness,
} from "../harness";

/** The last item of the title menu, which `TITLE_ITEM_COUNT` fixes at two. */
const LAST_INDEX = TITLE_ITEM_COUNT - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moves the highlight to the last item on up from the first", async () => {
  openTitle(h);
  h.debug.setMenuIndex(0);
  assertEqual(
    h.snapshot().menuIndex,
    0,
    "the highlighted item before the press",
  );

  await h.tap(KEY.up);
  captureStill(h, "wrapped");

  assertEqual(
    h.snapshot().menuIndex,
    LAST_INDEX,
    "the highlighted item after up from the first",
  );
});

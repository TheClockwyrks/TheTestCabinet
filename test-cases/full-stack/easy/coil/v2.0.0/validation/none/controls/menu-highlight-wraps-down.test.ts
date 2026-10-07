// controls/menu-highlight-wraps-down — down on the last item returns the
// highlight to the first.
//
// specs/controls.md, on a menu-bearing screen: `down` moves the highlight "down
// one item, wrapping at the ends". This is the wrap at the bottom end alone. The
// wrap at the top is `controls/menu-highlight-wraps-up`, and they are two points
// because they are two directions of one rule and a build commonly implements one
// of them.
//
// The menu read is the title's, whose `TITLE_ITEMS` specs/ui.md fixes at two
// entries — the mode's, then `HOW TO PLAY` — so the last item is index `1`. The
// highlight is put on it through the surface rather than by pressing `down`,
// because whether `down` MOVES the highlight is `controls/menu-highlight-moves`;
// what is decided here is what happens at the end.

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

afterEach(async () => {
  await h.dispose();
});

it("returns the highlight to the first item on down from the last", async () => {
  await openTitle(h);
  await h.debug.setMenuIndex(LAST_INDEX);
  assertEqual(
    (await h.snapshot()).menuIndex,
    LAST_INDEX,
    "the highlighted item before the press",
  );

  await h.tap(KEY.down);
  await captureStill(h, "wrapped");

  assertEqual(
    (await h.snapshot()).menuIndex,
    0,
    "the highlighted item after down from the last",
  );
});

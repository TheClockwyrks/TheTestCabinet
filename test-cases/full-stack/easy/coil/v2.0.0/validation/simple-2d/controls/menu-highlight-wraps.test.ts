// controls/menu-highlight-wraps — the highlight wraps at both ends of a menu.
//
// specs/controls.md, on a menu-bearing screen: `up` and `down` move the highlight
// "wrapping at the ends". Both ends are read, because they are one rule and a
// build commonly implements one of them: `down` from the last item returns to the
// first, and `up` from the first returns to the last.
//
// The menu read is the title's, whose `TITLE_ITEMS` specs/ui.md fixes at two
// entries — the mode's, then `HOW TO PLAY` — so the last item is index `1`. The
// highlight is put on it through the surface rather than by pressing `down`,
// because whether `down` MOVES the highlight is
// `controls/menu-highlight-moves`; what is decided here is what happens at the
// end.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS, TITLE_ITEMS } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openTitle,
  type Harness,
} from "../harness";

/** The first key `specs/controls.md` binds to each of the two menu directions. */
const DOWN = BINDINGS.down[0];
const UP = BINDINGS.up[0];

/** `TITLE_ITEMS` holds the mode's entry and `HOW TO PLAY` (specs/ui.md). */
const LAST_INDEX = TITLE_ITEMS.length - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("wraps from the last item to the first, and from the first back to the last", async () => {
  openTitle(h);
  h.debug.setMenuIndex(LAST_INDEX);
  assertEqual(
    h.snapshot().menuIndex,
    LAST_INDEX,
    "the highlighted item before the press",
  );

  await h.tap(DOWN);
  captureStill(h, "wrapped");
  assertEqual(
    h.snapshot().menuIndex,
    0,
    "the highlighted item after down from the last",
  );

  await h.tap(UP);
  assertEqual(
    h.snapshot().menuIndex,
    LAST_INDEX,
    "the highlighted item after up from the first",
  );
});

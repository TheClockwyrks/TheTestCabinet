// Wireworm — pointer/slide-off-cancels: a press on one item released on another
// confirms nothing.
//
// specs/ui.md, "Pointer and touch on the menus": a confirm takes both of its
// edges inside one item's region, and two edges falling in different regions
// confirm no item. That is the affordance a player uses to back out of a control
// already pressed, and this point reads it in the one direction the spec states
// it — nothing was confirmed.
//
// THE TWO ITEMS ARE CHOSEN SO THAT EITHER CONFIRM WOULD SHOW. The press begins
// on `HOW TO PLAY`, whose confirm moves to `howto`, and the release lands on
// `DESCEND`, whose confirm opens a run and moves to `playing`. A build that
// fired the item it was pressed on, and a build that fired the item it was
// released on, both leave the title — so reading `screen` back as `title` says
// neither happened.
//
// The press, the travel between and the release each land inside the region
// `menuItemRect` reports for their item (specs/instrumentation.md), and each is
// delivered on a driven frame. Nothing here knows a menu coordinate.
//
// Where the selection ended up is deliberately not asserted: a pointer
// travelling onto an item selects it, and that is `pointer/hover-selects`'s
// point, in its own direction.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  slideOffItem,
  type Harness,
} from "../harness";

/** The title's entries, by index (specs/ui.md, `TITLE_ITEMS`). */
const DESCEND = TITLE_ITEMS.indexOf("DESCEND");
const HOWTO = TITLE_ITEMS.indexOf("HOW TO PLAY");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("confirms nothing when the press and the release fall in different items", async () => {
  h.debug.reset();
  h.debug.setMenuIndex(DESCEND);
  const posed = h.snapshot();
  assertEqual(posed.screen, "title", "reset leaves the game on the title");
  assertEqual(posed.menuIndex, DESCEND, "the posed title highlight");

  await slideOffItem(h, HOWTO, DESCEND);
  captureStill(h, "title");

  assertEqual(
    h.snapshot().screen,
    "title",
    "two edges in different regions confirm no item, so the title is still " +
      "showing (specs/ui.md)",
  );
});

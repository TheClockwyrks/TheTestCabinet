// Carom — pointer/slide-off-cancels: a press on one item released on another
// confirms nothing.
//
// specs/ui.md, "Pointer and touch": a confirm requires both of its edges inside one
// item's region, and two edges that fall in different regions confirm no item.
// That is the affordance a player uses to back out of a control already pressed,
// and this point reads it in the one direction the spec states it — nothing was
// confirmed.
//
// THE TWO ITEMS ARE CHOSEN SO THAT EITHER CONFIRM WOULD SHOW. The press begins on
// `HOW TO PLAY`, whose confirm sets `screen = howto`, and the release lands on
// `VERSUS`, whose confirm opens a Versus countdown (specs/ui.md, the title's
// `confirm` row). A build that fired the item it was pressed on, and a build that
// fired the item it was released on, both leave the title — so reading `screen`
// back as `title` says neither happened.
//
// The press, the moves between and the release are real pointer events dispatched
// at the target the runtime listens on, each delivered on its own driven frame,
// and each lands inside the region `menuItemRect` reports for its item
// (specs/instrumentation.md). Nothing here knows a menu coordinate.
//
// Where the selection ended up is deliberately not asserted: a pointer travelling
// onto an item selects it, and that is `pointer/hover-selects`'s point, in its own
// direction.
//
// Nothing advances on `title` (specs/ui.md), so there is no bystander to remove
// and no paddle to take. The still is the frame the release left.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  openTitle,
  slideOffItem,
  type Harness,
} from "../harness";

/** The title's entries, by index (specs/ui.md, `TITLE_ITEMS`). */
const SOLO = TITLE_ITEMS.indexOf("SOLO");
const VERSUS = TITLE_ITEMS.indexOf("VERSUS");
const HOWTO = TITLE_ITEMS.indexOf("HOW TO PLAY");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("confirms nothing when the press and the release fall in different items", async () => {
  openTitle(h);
  h.debug.setMenuIndex(SOLO);
  const posed = h.snapshot();
  assertEqual(posed.screen, "title");
  assertEqual(posed.menuIndex, SOLO);

  await slideOffItem(h, HOWTO, VERSUS);
  captureStill(h, "title");

  assertEqual(h.snapshot().screen, "title");
});

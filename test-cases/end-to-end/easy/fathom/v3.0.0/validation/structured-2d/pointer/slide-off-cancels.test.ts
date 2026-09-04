// pointer/slide-off-cancels — a press on one item released on another confirms
// nothing.
//
// specs/ui.md, "Pointer and touch": "A confirm takes both of its edges inside one
// item's region ... Two edges that fall in different regions, and an edge that
// falls outside every region, confirm no item." That is the affordance a player
// uses to back out of a control they have already pressed, and this point checks
// it in the one direction it states — nothing was confirmed.
//
// THE TWO ITEMS ARE CHOSEN SO THAT EITHER CONFIRM WOULD SHOW. The press begins on
// `HOW TO PLAY`, whose confirm sets `screen = howto`, and the release lands on
// `DIVE`, whose confirm opens a dive's countdown (specs/ui.md, the title's rows
// of the transition table). So a build that fired the item it was pressed on, and
// a build that fired the item it was released on, both leave the title — and
// reading `screen` back as `"title"` says neither happened.
//
// `menuIndex` IS READ BESIDE IT, and it is what makes that reading mean
// something: a build that ignored the pointer altogether would also have left the
// screen alone. The selection is posed onto `HOW TO PLAY` first, so the `DIVE`
// the pointer came to rest on is an index the gesture had to move.
//
// The press, the travel and the release each run a driven frame, and each lands
// at the middle of the region `menuItemRect` reports for its item
// (specs/instrumentation.md), so nothing here knows a menu coordinate. Nothing
// advances on `"title"` (specs/ui.md), so no bystander can move under the
// gesture.

import { afterEach, beforeEach, it } from "vitest";

import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  dragBetweenItems,
  openTitle,
  type Harness,
} from "../harness";

/** The title's entries, by index (specs/ui.md, `TITLE_ITEMS`). */
const DIVE = TITLE_ITEMS.indexOf("DIVE");
const HOWTO = TITLE_ITEMS.indexOf("HOW TO PLAY");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("confirms nothing when the press and the release fall in different items", async () => {
  openTitle(h);
  h.debug.setMenuIndex(HOWTO);
  const posed = h.snapshot();
  assertEqual(posed.screen, "title", "the screen the gesture is made on");
  assertEqual(posed.menuIndex, HOWTO, "the posed title selection");

  await dragBetweenItems(h, HOWTO, DIVE);
  // Before the assertions, so a failing check still leaves the screen it read.
  captureStill(h, "title");

  const after = h.snapshot();
  assertEqual(
    after.screen,
    "title",
    "the screen after a press in HOW TO PLAY's region released in DIVE's, " +
      "which confirms neither item (specs/ui.md)",
  );
  assertEqual(
    after.menuIndex,
    DIVE,
    "the title's selection where the pointer came to rest, which says the " +
      "gesture was read at all (specs/ui.md)",
  );
});

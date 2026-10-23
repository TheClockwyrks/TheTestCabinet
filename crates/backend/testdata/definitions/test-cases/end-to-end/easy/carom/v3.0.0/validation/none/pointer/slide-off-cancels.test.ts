// pointer/slide-off-cancels — a press on one item released on another confirms
// nothing.
//
// specs/ui.md, "Pointer and touch": a confirm requires both of its edges inside one
// item's region, and two edges that fall in different regions confirm no item.
// That is the affordance a player uses to back out of a control they have already
// pressed, and this point checks it in the one direction it states — nothing was
// confirmed.
//
// THE TWO ITEMS ARE CHOSEN SO THAT EITHER CONFIRM WOULD SHOW. The press begins on
// `HOW TO PLAY`, whose confirm sets `screen = howto`, and the release lands on
// `VERSUS`, whose confirm opens a Versus countdown (specs/ui.md, the title's
// `confirm` row). So a build that fired the item it was pressed on, and a build
// that fired the item it was released on, both leave the title — and reading
// `screen` back as `title` says neither happened.
//
// The press, the travel and the release each run a driven frame, and each lands at
// the middle of the region `menuItemRect` reports for its item
// (specs/instrumentation.md), so nothing here knows a menu coordinate.
//
// Where the selection ended up is deliberately not asserted: a pointer travelling
// onto an item selects it, and that is `pointer/hover-selects`'s point, in its own
// direction.
//
// Nothing advances on the title (specs/ui.md), so there is no bystander to isolate
// and no paddle to take.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  dragBetweenItems,
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

afterEach(async () => {
  await h.dispose();
});

it("confirms nothing when the press and the release fall in different items", async () => {
  await h.debug.reset();
  await h.debug.setMenuIndex(SOLO);
  const posed = await h.snapshot();
  assertEqual(posed.screen, "title");
  assertEqual(posed.menuIndex, SOLO);

  await dragBetweenItems(h, HOWTO, VERSUS);
  await captureStill(h, "title");

  assertEqual((await h.snapshot()).screen, "title");
});

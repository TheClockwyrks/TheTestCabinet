// Wireworm — touch/drag-cancels: a contact that lifts on another item confirms
// nothing.
//
// specs/ui.md, "Pointer and touch on the menus": a confirm takes both of its
// edges inside ONE item's region, and two edges falling in different regions
// confirm no item. The same section makes a contact that "travels onto" an item
// select it. So the one gesture the spec fixes here is a finger that lands on
// one entry, slides onto another and lifts: the selection follows to where it
// lifted, and nothing is confirmed. That is the affordance that lets a player
// who touched the wrong entry slide off it rather than be committed by the
// landing.
//
// BOTH READINGS ARE THE ONE BEHAVIOUR, and each carries the other. `screen` is
// the requirement — still `title`, because no item was confirmed. `menuIndex` is
// what makes that reading mean something: a build that ignored the contact
// altogether would also have left the screen alone, and the selection sitting at
// the entry the finger lifted over is the evidence the gesture was read at all.
//
// The slide runs from `DESCEND` to `HOW TO PLAY`, so the confirm this must not
// make is the loudest one on the screen — `DESCEND` opens a run — and the
// selection it must make is one the landing did not already hold.

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
const DESCEND = TITLE_ITEMS.indexOf("DESCEND");
const HOWTO = TITLE_ITEMS.indexOf("HOW TO PLAY");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("confirms nothing when the contact lifts on a different item", async () => {
  await h.debug.reset();
  await h.debug.setMenuIndex(DESCEND);
  const posed = await h.snapshot();
  assertEqual(posed.screen, "title", "reset leaves the game on the title");
  assertEqual(posed.menuIndex, DESCEND, "the posed title highlight");

  await dragBetweenItems(h, DESCEND, HOWTO);
  await captureStill(h, "title");

  const after = await h.snapshot();
  assertEqual(
    after.screen,
    "title",
    "two edges in different regions confirm no item, so the title is still " +
      "showing (specs/ui.md)",
  );
  assertEqual(
    after.menuIndex,
    HOWTO,
    "the selection followed the contact onto the item it lifted over " +
      "(specs/ui.md)",
  );
});

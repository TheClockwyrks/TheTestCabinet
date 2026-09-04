// Shatter — screens/pause-menu-entries: the pause menu draws its three entries in the
// order the specification fixes.
//
// THE RULE. `specs/ui.md` gives the `paused` screen the menu `PAUSE_ITEMS` — `RESUME`,
// `RESTART`, `QUIT TO MENU`, "in that order" — and states that every menu is vertical.
// Order on a vertical menu is position, so the reading is each entry's own `y` on the
// frame the build drew.
//
// WHY THE ORDER MATTERS MORE HERE THAN ANYWHERE ELSE. Three entries and three
// destinations, one of which throws the run away: a build that drew them in some other
// order would have every one of `screens/resume-returns-to-play`,
// `screens/restart-begins-a-new-game` and `screens/quit-returns-to-the-title` taking the
// wrong entry, because those three ADDRESS an entry by index rather than by its copy.
// This item is what fixes the index each of them names.
//
// AN ENTRY IS FOUND BY ITS COPY, AT THE PLACE THE TRANSFORM PUT IT (`./menu.ts`), so a
// menu drawn under a translate is read where it lands. The frame is presented rather
// than stepped, so nothing of the paused screen's own drawing runs a tick under the
// reading.
//
// WHAT THIS ITEM DOES NOT DECIDE. That the field behind it is frozen
// (`screens/pause-freezes-the-field`), which entry is highlighted
// (`screens/title-menu-highlight` grades the highlight), or where any entry leads.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThan } from "../assert";
import { PAUSE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { menuDraws } from "./menu";
import { reachPaused } from "./screens";

/** The entries `specs/ui.md` gives the pause menu, which this item's reading rests on. */
const MENU_ENTRIES = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws RESUME above RESTART above QUIT TO MENU", async () => {
  assertEqual(
    PAUSE_ITEMS.length,
    MENU_ENTRIES,
    "the pause menu entries specs/ui.md fixes, which this item's reading rests on",
  );

  await startPlaying(h);
  await reachPaused(h);

  const calls = await h.presentCalls();
  await captureStill(h, "menu");

  const drawn = menuDraws(calls, PAUSE_ITEMS, "the pause menu");
  for (let entry = 1; entry < PAUSE_ITEMS.length; entry += 1) {
    assertLessThan(
      drawn[entry - 1].y,
      drawn[entry].y,
      `"${PAUSE_ITEMS[entry - 1]}" is drawn above "${PAUSE_ITEMS[entry]}" (specs/ui.md)`,
    );
  }
});

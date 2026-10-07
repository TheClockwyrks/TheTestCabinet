// screens/pause-menu-entries — the pause menu shows its three entries, in order.
//
// THE RULE. `specs/ui.md` gives the `paused` screen the menu `PAUSE_ITEMS` —
// `RESUME`, `RESTART`, `QUIT TO MENU`, "in that order" — and `specs/controls.md`
// makes every menu vertical, its highlight moving "by one entry" up and down. The
// order is therefore what a player navigates by, and it is what this item reads:
// all three drawn, each above the next.
//
// WHY ORDER IS WORTH A POINT OF ITS OWN. The three entries lead to three
// completely different places, and the three items that grade those destinations
// (`screens/resume-returns-to-play`, `screens/restart-begins-a-new-game` and
// `screens/quit-returns-to-the-title`) each address an entry by its INDEX. A build
// that drew the three in some other order would satisfy every one of them while
// showing a player a menu on which the second entry quits and the third restarts.
// This is the item that catches that.
//
// WHAT IS READ, AND IN WHAT UNITS. The frame's own text draws, each placed back
// into the logical `1280 x 720` field through the transform the build drew it with
// and the viewport the engine letterboxed with (`./menu.ts`). "Above" is a
// comparison of field coordinates, so a build that drew its menu inside a scale or
// a translate of its own reads the same as one that did not. Matching is by
// containment, because `specs/ui.md` leaves the styling to the build and a marker
// or padding beside an entry is still that entry.
//
// THE SCREEN IS POSED, NOT PAUSED INTO. `setScreen("paused")` reaches the scenario
// directly (`specs/instrumentation.md`); the key that pauses is `controls/pause-p`
// and `controls/pause-escape`, not this item. The field beneath is emptied and
// quiet first, so nothing drifting behind the menu is mistaken for it.
//
// WHAT THIS ITEM DOES NOT DECIDE. Which entry is highlighted, which is
// `screens/title-menu-highlight`'s requirement over on the title menu, nor what
// any of the three entries does.

import { afterEach, beforeEach, it } from "vitest";
import { PAUSE_ITEMS } from "../constants";
import { assertEqual, assertLessThan } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { entryRow, textRuns } from "./menu";

/** The entries `specs/ui.md` fixes for the pause menu, in the order it fixes. */
const ENTRIES = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws all three pause entries in the order the specification fixes", async () => {
  assertEqual(
    PAUSE_ITEMS.length,
    ENTRIES,
    "the pause entries specs/ui.md fixes, which this item reads in order",
  );

  startPlaying(h);
  h.debug.setScreen("paused");

  h.clearCalls();
  await h.advance(1);
  captureStill(h, "menu");

  assertEqual(
    h.snapshot().screen,
    "paused",
    "the screen the entries were read from",
  );

  const runs = textRuns(h, h.calls);
  const rows = PAUSE_ITEMS.map((_item, index) =>
    entryRow(runs, PAUSE_ITEMS, index),
  );

  for (let index = 0; index + 1 < rows.length; index += 1) {
    assertLessThan(
      rows[index].bottom,
      rows[index + 1].top,
      `the lowest row ${JSON.stringify(rows[index].item)} was drawn on, ` +
        `against the highest row ${JSON.stringify(rows[index + 1].item)} was ` +
        `drawn on: the pause entries are stacked in the order specs/ui.md fixes`,
    );
  }
});

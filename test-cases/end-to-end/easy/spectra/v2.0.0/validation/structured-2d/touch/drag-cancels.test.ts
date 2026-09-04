// Spectra — touch/drag-cancels: a contact that lifts elsewhere takes nothing.
//
// THE RULE. `specs/ui.md`, "Pointer and touch": "A confirm takes both of its edges
// inside one item's region: ... the landing and the lift for a touch contact. Two
// edges that fall in different regions ... confirm no item." A finger that lands on
// the wrong entry can be dragged off it and lifted safely.
//
// WHAT IS DRIVEN. One contact lands inside `HOW TO PLAY`'s region, travels onto the
// mode entry's while held, and lifts there. Nothing is confirmed, and the selection
// followed the finger, so the highlight is on the item it ended over — the travel
// rule `specs/ui.md` states in the same table.
//
// EVERY WRONG MODEL READS AS A DIFFERENT SCREEN. A build that confirms on the
// landing opens `howto`; a build that confirms on the lift alone opens `stageIntro`;
// only a build that requires BOTH edges in one region is still on the title.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  touchBetweenItems,
  type Harness,
} from "../harness";

/**
 * The title menu's entries, by index.
 *
 * `specs/ui.md` fixes `TITLE_ITEMS` as "The mode entry `specs/mode.md` names,
 * then `HOW TO PLAY`, in that order", so the mode entry is `0` and how-to-play is
 * `1` whichever mode this build ships.
 */
const MODE_ENTRY = 0;
const HOWTO_ENTRY = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("confirms nothing when the contact lifts in another item", async () => {
  h.debug.reset();
  assertEqual(h.snapshot().screen, "title", "the game opens on the title");

  await touchBetweenItems(h, HOWTO_ENTRY, MODE_ENTRY);
  captureStill(h, "title");

  const after = h.snapshot();
  assertEqual(
    after.screen,
    "title",
    "the screen a contact landing in one item and lifting in another reaches: " +
      "neither is confirmed (specs/ui.md, Pointer and touch)",
  );
  assertEqual(
    after.menuIndex,
    MODE_ENTRY,
    "menuIndex after the held contact travelled onto the mode entry's region, " +
      "which selects it (specs/ui.md)",
  );
});

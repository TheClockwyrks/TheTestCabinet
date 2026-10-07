// Spectra — touch/title-drag-cancels: a contact that lifts elsewhere takes nothing.
//
// THE RULE. `specs/ui.md`, "Pointer and touch": "A confirm requires both of its edges
// inside one item's region: ... the landing and the lift for a touch contact. Two
// edges that fall in different regions ... confirm no item." A finger that lands on
// the wrong entry can be dragged off it and lifted safely.
//
// WHAT IS DRIVEN. One contact lands inside the mode entry's region — the item the
// pose already highlights — travels onto `HOW TO PLAY`'s region while held, and
// lifts there. Nothing is confirmed, and the selection followed the finger, so the
// highlight is on `HOW TO PLAY`, the item the contact ended over — the travel rule
// `specs/ui.md` states in the same table.
//
// WHY THE CONTACT LANDS ON THE HIGHLIGHTED ITEM. A cancel is a negative claim, and a
// build that reads no touch at all satisfies a negative claim for free: leave the
// gesture ending where the pose already put the highlight and both readings come out
// right for a build with no touch code in it. Landing on the item the highlight is
// ALREADY on and lifting on the other makes this point read back a highlight that
// MOVED, which is what makes the negative claim decidable rather than free.
//
// EVERY WRONG MODEL READS AS A DIFFERENT SCREEN. A build that confirms on the
// landing edge confirms the mode entry and opens `stageIntro`; a build that confirms
// on the lift edge alone opens `howto`; a build that never saw the contact is still
// on the title with the highlight on the mode entry, and fails on the highlight.
// Only a build that requires BOTH edges in one region is on the title with the
// highlight on `HOW TO PLAY`.
//
// WHERE THE ITEMS ARE, IS THE BUILD'S: both regions come from the build's own
// `menuItemRect` (`specs/instrumentation.md`), so any layout passes.

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

afterEach(async () => {
  await h.dispose();
});

it("confirms nothing when the contact lifts in another item", async () => {
  await h.debug.reset();
  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "the game opens on the title",
  );

  await touchBetweenItems(h, MODE_ENTRY, HOWTO_ENTRY);
  await captureStill(h, "title");

  const after = await h.snapshot();
  assertEqual(
    after.screen,
    "title",
    "the screen a contact landing in one item and lifting in another reaches: " +
      "neither is confirmed (specs/ui.md, Pointer and touch)",
  );
  assertEqual(
    after.menuIndex,
    HOWTO_ENTRY,
    "menuIndex after the held contact travelled onto HOW TO PLAY's region, " +
      "which selects it (specs/ui.md)",
  );
});

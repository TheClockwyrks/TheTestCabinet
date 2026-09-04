// Spectra — pointer/title-slide-off-cancels: two edges in different items take
// neither.
//
// THE RULE. `specs/ui.md`, "Pointer and touch": "A confirm takes both of its edges
// inside one item's region ... Two edges that fall in different regions, and an edge
// that falls outside every region, confirm no item." This is the affordance that
// lets a player who pressed the wrong entry slide off it and let go safely.
//
// WHAT IS DRIVEN. The pointer presses inside the mode entry's region — the item the
// pose already highlights — travels onto `HOW TO PLAY`'s region while held, and
// releases there. The two edges fall in different regions, so nothing is confirmed,
// and the selection followed the pointer, so the highlight is on `HOW TO PLAY`, the
// item the gesture ended over.
//
// WHY THE PRESS STARTS ON THE HIGHLIGHTED ITEM. A cancel is a negative claim, and a
// build that reads no pointer at all satisfies a negative claim for free: leave the
// gesture ending where the pose already put the highlight and both readings come out
// right for a build with no mouse code in it. Pressing the item the highlight is
// ALREADY on and releasing on the other makes this point read back a highlight that
// MOVED, which is what makes the negative claim decidable rather than free.
//
// EVERY WRONG MODEL READS AS A DIFFERENT SCREEN. A build that confirms on the press
// edge confirms the mode entry and opens `stageIntro`; a build that confirms on the
// release edge alone opens `howto`; a build that never saw the pointer is still on
// the title with the highlight on the mode entry, and fails on the highlight. Only a
// build that requires BOTH edges in one region is on the title with the highlight on
// `HOW TO PLAY`.
//
// WHERE THE ITEMS ARE, IS THE BUILD'S: both regions come from the build's own
// `menuItemRect` (`specs/instrumentation.md`), so any layout passes.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  dragBetweenItems,
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

it("confirms nothing when the press and the release fall in different items", async () => {
  h.debug.reset();
  assertEqual(h.snapshot().screen, "title", "the game opens on the title");

  await dragBetweenItems(h, MODE_ENTRY, HOWTO_ENTRY);
  captureStill(h, "title");

  const after = h.snapshot();
  assertEqual(
    after.screen,
    "title",
    "the screen a press in one item and a release in another reaches: neither " +
      "is confirmed (specs/ui.md, Pointer and touch)",
  );
  assertEqual(
    after.menuIndex,
    HOWTO_ENTRY,
    "menuIndex after the held pointer travelled onto HOW TO PLAY's region, " +
      "which selects it (specs/ui.md)",
  );
});

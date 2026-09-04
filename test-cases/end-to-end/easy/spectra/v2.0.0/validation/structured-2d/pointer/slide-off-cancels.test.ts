// Spectra — pointer/slide-off-cancels: two edges in different items take neither.
//
// THE RULE. `specs/ui.md`, "Pointer and touch": "A confirm takes both of its edges
// inside one item's region ... Two edges that fall in different regions, and an edge
// that falls outside every region, confirm no item." This is the affordance that
// lets a player who pressed the wrong entry slide off it and let go safely.
//
// WHAT IS DRIVEN. The pointer presses inside `HOW TO PLAY`'s region, travels to the
// mode entry's while held, and releases there. The two edges fall in different
// regions, so nothing is confirmed — and the selection followed the pointer, so the
// highlight is on the item it ended over.
//
// EVERY WRONG MODEL READS AS A DIFFERENT SCREEN. A build that confirms on the press
// opens `howto`; a build that confirms on the release alone opens `stageIntro`; only
// a build that requires BOTH edges in one region is still on the title.
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

  await dragBetweenItems(h, HOWTO_ENTRY, MODE_ENTRY);
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
    MODE_ENTRY,
    "menuIndex after the held pointer travelled onto the mode entry's region, " +
      "which selects it (specs/ui.md)",
  );
});

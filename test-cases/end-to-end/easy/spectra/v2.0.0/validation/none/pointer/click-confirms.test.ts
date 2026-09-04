// Spectra — pointer/click-confirms: a press and release inside one item takes it.
//
// THE RULE. `specs/ui.md`, "Pointer and touch": "A pointer is pressed and released
// inside one item's region" makes `menuIndex` that item's index and confirms it,
// with the effect the screen's own table gives that item — on the title, `HOW TO
// PLAY` moves to `howto`.
//
// THE ITEM CLICKED IS NOT THE ONE ALREADY SELECTED. `reset` leaves the highlight on
// the mode entry and the click lands on the second item, so the screen that follows
// says which item the gesture confirmed: a build that confirmed whatever was already
// highlighted opens `stageIntro`, and a build that never read the pointer is still
// on the title. Each wrong model reads as a different screen.
//
// WHERE THE ITEM IS, IS THE BUILD'S: the region comes from the build's own
// `menuItemRect` (`specs/instrumentation.md`) and the press and its release both
// land in the middle of it, so any layout passes.
//
// NO KEY IS PRESSED, so a build whose keyboard `confirm` is broken still has its
// pointer graded here, and `controls/confirm-enter` still decides the key.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  clickItem,
  createHarness,
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

it("confirms the title item a press and release fall inside", async () => {
  await h.debug.reset();
  const posed = await h.snapshot();
  assertEqual(posed.screen, "title", "the game opens on the title");
  assertEqual(posed.menuIndex, MODE_ENTRY, "with its first item highlighted");

  await clickItem(h, HOWTO_ENTRY);
  await captureStill(h, "howto");

  assertEqual(
    (await h.snapshot()).screen,
    "howto",
    "the screen a press and release inside the second item's own region " +
      "reaches (specs/ui.md, Pointer and touch)",
  );
});

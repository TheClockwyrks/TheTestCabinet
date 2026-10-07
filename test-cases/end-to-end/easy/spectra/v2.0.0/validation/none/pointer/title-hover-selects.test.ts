// Spectra — pointer/title-hover-selects: moving the mouse onto a title item
// selects it.
//
// THE RULE. `specs/ui.md`, "Pointer and touch": "A pointer moves onto an item's
// region" makes `menuIndex` that item's index. This point decides that and nothing
// else.
//
// WHERE THE ITEM IS, IS THE BUILD'S. `specs/ui.md` fixes no menu geometry, so the
// region comes from the build's own `menuItemRect` (`specs/instrumentation.md`) and
// the pointer is moved to the middle of it. A build that lays its menu out any way
// it likes passes here; a build that reports a region it does not answer on fails.
//
// THE GROUND IS POSED AND THE ONLY THING DRIVEN IS THE POINTER. `reset` leaves the
// title with the highlight on the first item (`specs/instrumentation.md`), so the
// index read back can have come from nowhere else. Walking the arrows to the item
// instead would fail this point for a broken `down` edge, which is
// `controls/menu-down-arrow`'s to report.
//
// NO BUTTON IS PRESSED, and `screen` is read back beside the index: a move alone
// selects and confirms nothing, so a build that fired the entry on the hover has
// left the title and fails here rather than passing on the index it set on the way
// out.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  pointerOntoItem,
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

it("selects the title item the pointer moves onto", async () => {
  await h.debug.reset();
  const posed = await h.snapshot();
  assertEqual(posed.screen, "title", "the game opens on the title");
  assertEqual(posed.menuIndex, MODE_ENTRY, "with its first item highlighted");

  await pointerOntoItem(h, HOWTO_ENTRY);
  await captureStill(h, "menu");

  const hovered = await h.snapshot();
  assertEqual(
    hovered.menuIndex,
    HOWTO_ENTRY,
    "menuIndex after the pointer moved onto the second item's own region " +
      "(specs/ui.md, Pointer and touch)",
  );
  assertEqual(
    hovered.screen,
    "title",
    "the screen a move alone reaches: a hover selects and confirms nothing " +
      "(specs/ui.md)",
  );
});

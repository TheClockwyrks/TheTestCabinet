// pointer/hover-selects — moving the pointer onto an item selects that item.
//
// specs/ui.md, "Pointer and touch", in one direction: "A pointer moves onto an
// item's region" makes "that item ... the selected one". The ground is posed —
// the title with the selection on `DIVE` — and the only thing driven afterwards
// is the pointer, so the index read back can have come from nowhere else.
// Walking the arrows to the item instead would fail this point for a broken
// `down` edge, which is `controls`' to report.
//
// WHERE the item is drawn is the build's, not the case's. The region comes from
// `menuItemRect` (specs/instrumentation.md) and the pointer is moved to its
// middle, so a build that lays its menu out any way it likes passes here, and one
// that reports a region it does not actually answer on fails.
//
// NO BUTTON IS PRESSED, and `screen` is read back beside the index: a move alone
// selects and confirms nothing, so a build that fired the entry on the hover has
// left the title and fails rather than passing on the index it set on the way
// out.
//
// Nothing advances on `"title"` (specs/ui.md), so there is no bystander to
// isolate — a menu is not driven through a posed world.

import { afterEach, beforeEach, it } from "vitest";

import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  openTitle,
  pointerOntoItem,
  type Harness,
} from "../harness";

/** The title's entries, by index (specs/ui.md, `TITLE_ITEMS`). */
const DIVE = TITLE_ITEMS.indexOf("DIVE");
const HOWTO = TITLE_ITEMS.indexOf("HOW TO PLAY");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("selects the item the pointer moves onto", async () => {
  openTitle(h);
  h.debug.setMenuIndex(DIVE);
  const posed = h.snapshot();
  assertEqual(posed.screen, "title", "the screen the gesture is made on");
  assertEqual(posed.menuIndex, DIVE, "the posed title selection");

  await pointerOntoItem(h, HOWTO);
  // Before the assertions, so a failing check still leaves the menu it read.
  captureStill(h, "menu");

  const hovered = h.snapshot();
  assertEqual(
    hovered.menuIndex,
    HOWTO,
    "the title's selection after the pointer moved onto the region " +
      "menuItemRect reports for HOW TO PLAY (specs/ui.md)",
  );
  assertEqual(
    hovered.screen,
    "title",
    "the screen after a move with no button pressed, which selects and " +
      "confirms nothing (specs/ui.md)",
  );
});

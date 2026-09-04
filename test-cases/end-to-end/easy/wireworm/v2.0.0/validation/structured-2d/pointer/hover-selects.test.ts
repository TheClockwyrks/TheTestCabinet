// Wireworm — pointer/hover-selects: moving the pointer onto an item selects it.
//
// specs/ui.md, "Pointer and touch on the menus", in one direction: a pointer
// that moves onto an item's region makes `menuIndex` that item's index. The
// ground is posed — the title with the highlight on `DESCEND` — and the only
// thing driven afterwards is the pointer, so the index read back can have come
// from nowhere else. Walking the arrows to the item instead would fail this
// point for a broken down edge, which is `controls/menu-down`'s to report.
//
// WHERE the item is drawn is the build's, not the case's: the region comes from
// `menuItemRect` (specs/instrumentation.md) and the pointer is moved to its
// middle, so a build that lays its menu out any way it likes passes here, and
// one that reports a region it does not answer on fails.
//
// No button is pressed, and `screen` is read back beside the index: a move alone
// selects and confirms nothing, so a build that fired the entry on the hover has
// left the title and fails rather than passing on the index it set on the way
// out.
//
// Nothing advances on the title (specs/ui.md), so there is no bystander to
// isolate and no cursor to take: a menu is not driven through one.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  pointAtItem,
  resetTo,
  type Harness,
} from "../harness";

/** The title's entries, by index (specs/ui.md, `TITLE_ITEMS`). */
const DESCEND = TITLE_ITEMS.indexOf("DESCEND");
const HOWTO = TITLE_ITEMS.indexOf("HOW TO PLAY");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("selects the item the pointer moves onto", async () => {
  resetTo(h);
  h.debug.setMenuIndex(DESCEND);
  const posed = h.snapshot();
  assertEqual(posed.screen, "title", "reset leaves the game on the title");
  assertEqual(posed.menuIndex, DESCEND, "the posed title highlight");

  pointAtItem(h, HOWTO);
  captureStill(h, "menu");

  const hovered = h.snapshot();
  assertEqual(
    hovered.screen,
    "title",
    "a move alone confirms nothing, so the title is still showing " +
      "(specs/ui.md)",
  );
  assertEqual(
    hovered.menuIndex,
    HOWTO,
    "the item the pointer moved onto is selected (specs/ui.md)",
  );
});

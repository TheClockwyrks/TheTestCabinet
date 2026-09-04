// Carom — pointer/hover-selects: moving the pointer onto an item selects it.
//
// specs/ui.md, "Pointer and touch", in one direction: a pointer that moves onto an
// item's region makes `menuIndex` that item's index. `openTitle` settles the reset
// with one advanced frame, then `setMenuIndex` puts the highlight on `SOLO` — the
// precondition this point names — and the only thing driven afterwards is the
// pointer, so the index read back can have come from nowhere else. Pressing the
// arrows to reach the item would fail this point for a broken down edge, which is
// `navigation/title-down`'s to report.
//
// WHERE the item is drawn is the build's own: the case does not fix a menu layout.
// The region comes from `menuItemRect` (specs/instrumentation.md) and the pointer
// is moved to its middle, so a build that lays its menu out any way it likes
// passes, and one that reports a region it does not answer on fails.
//
// The event is a real `pointermove` at the target the engine listens on, delivered
// on a driven frame, so a build reading its pointer once per frame sees it as a
// player's hand delivers it. No button is held, and `screen` is read back beside
// the index: a move alone selects and confirms nothing.
//
// Nothing on the field is posed or removed: specs/ui.md advances nothing on the
// title, so this selection runs over a world that cannot move under it. No paddle
// is taken — a menu is not driven through one. The still is the frame the move
// left.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  hoverMenuItem,
  openTitle,
  type Harness,
} from "../harness";

/** The title's entries, by index (specs/ui.md, `TITLE_ITEMS`). */
const SOLO = TITLE_ITEMS.indexOf("SOLO");
const HOWTO = TITLE_ITEMS.indexOf("HOW TO PLAY");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("selects the item the pointer moves onto", async () => {
  await openTitle(h);
  h.debug.setMenuIndex(SOLO);
  const posed = h.snapshot();
  assertEqual(posed.screen, "title");
  assertEqual(posed.menuIndex, SOLO);

  await hoverMenuItem(h, HOWTO);
  captureStill(h, "menu");

  const hovered = h.snapshot();
  assertEqual(hovered.screen, "title");
  assertEqual(hovered.menuIndex, HOWTO);
});

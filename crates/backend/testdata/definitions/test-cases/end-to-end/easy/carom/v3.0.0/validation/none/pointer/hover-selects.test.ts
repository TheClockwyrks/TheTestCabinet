// pointer/hover-selects — moving the mouse onto an item selects that item.
//
// specs/ui.md, "Pointer and touch": a pointer that moves onto an item's region
// makes `menuIndex` that item's index. The ground is posed — the title with the
// selection on `SOLO` — and the only thing driven afterwards is the mouse, so the
// index read back can have come from nowhere else. Walking the arrows to the item
// instead would fail this point for a broken down edge, which is
// `navigation/title-down`'s to report.
//
// WHERE the item is drawn is the build's, not the case's: the region comes from
// `menuItemRect` (specs/instrumentation.md) and the mouse is glided to its middle,
// so a build that lays its menu out any way it likes passes here, and one that
// reports a region it does not actually answer on fails.
//
// No button is pressed, and `screen` is read back beside the index: a move alone
// selects and confirms nothing, so a build that fired the entry on the hover has
// left the title and fails rather than passing on the index it set on the way out.
//
// Nothing advances on the title (specs/ui.md), so there is no bystander to isolate
// and no paddle to take — a menu is not driven through one.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  pointerOntoItem,
  type Harness,
} from "../harness";

/** The title's entries, by index (specs/ui.md, `TITLE_ITEMS`). */
const SOLO = TITLE_ITEMS.indexOf("SOLO");
const HOWTO = TITLE_ITEMS.indexOf("HOW TO PLAY");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("selects the item the mouse moves onto", async () => {
  await h.debug.reset();
  await h.debug.setMenuIndex(SOLO);
  const posed = await h.snapshot();
  assertEqual(posed.screen, "title");
  assertEqual(posed.menuIndex, SOLO);

  await pointerOntoItem(h, HOWTO);
  await captureStill(h, "menu");

  const hovered = await h.snapshot();
  assertEqual(hovered.screen, "title");
  assertEqual(hovered.menuIndex, HOWTO);
});

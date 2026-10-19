// Carom — pointer/hover-selects: moving the pointer onto an item selects it.
//
// specs/ui.md, "Pointer and touch", in one direction: a pointer that moves onto an
// item's region makes `menuIndex` that item's index. The title is opened by
// `reset` and the selection posed onto `SOLO` with `setMenuIndex`, which is the
// precondition this point names; the only thing driven after that is the pointer,
// so the index read back can have come from nowhere else. Walking the arrows to
// the item would fail this point for a broken down edge, which is
// `navigation/title-down`'s to report.
//
// WHERE the item is drawn is the build's own. The region comes from
// `menuItemRect` (specs/instrumentation.md) and the pointer is moved to its
// middle, so a build that lays its menu out any way it likes passes, and one that
// reports a region it does not answer on fails.
//
// The event is a real `pointermove` dispatched at the target the runtime listens
// on, carrying `pointerType: "mouse"`, and it is delivered on a driven frame — so
// a build reading its pointer once per frame sees it exactly as a player's hand
// would deliver it. No button is held, and `screen` is read back beside the index:
// a move alone selects and confirms nothing.
//
// The field is left as the title state holds it. Nothing advances on `title`
// (specs/ui.md) and the reading is of neither a ball nor an obstacle, so there is
// no bystander to remove. No paddle is taken: a menu is not driven through one.
// The still is the frame the move left.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  openTitle,
  pointAtItem,
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
  openTitle(h);
  h.debug.setMenuIndex(SOLO);
  const posed = h.snapshot();
  assertEqual(posed.screen, "title");
  assertEqual(posed.menuIndex, SOLO);

  await pointAtItem(h, HOWTO);
  captureStill(h, "menu");

  const hovered = h.snapshot();
  assertEqual(hovered.screen, "title");
  assertEqual(hovered.menuIndex, HOWTO);
});

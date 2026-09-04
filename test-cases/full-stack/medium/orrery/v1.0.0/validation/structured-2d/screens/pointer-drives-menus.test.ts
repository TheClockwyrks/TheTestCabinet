// screens/pointer-drives-menus — the title menu answers the pointer, over the
// regions the build itself reports.
//
// THE RULE, `specs/ui.md`, Menu navigation, Pointer and touch: "A pointer moves
// onto an item's region | The highlight becomes that item's index" and "A pointer
// is pressed and released inside one item's region | The highlight becomes that
// item's index, and that item is taken", against which "Two edges that fall in
// different regions, and an edge that falls outside every region, take no item."
// A touch contact is the same input by specification — "A mouse, a pen, and a
// finger all reach the game as pointers on those same three readings"
// (`specs/controls.md`) — so the pointer path is the whole of it.
//
// WHERE THE ITEMS ARE IS THE BUILD'S, and nothing in `specs/` says where a menu is
// drawn, so this point asks: `menuItemRect(index)` returns "the hit region of item
// `index` on the menu the current screen shows" (`specs/instrumentation.md`), and
// every gesture below is aimed at the middle of a region the build named. That is
// the only way a check can drive a layout it does not fix, and it is why the read
// is specified at all.
//
// THE THREE GESTURES, in an order that leaves the deciding one last, because
// taking an item leaves the title screen. A MOVE onto the last item's region,
// which selects it and nothing more. A SPLIT gesture, pressed in the last item's
// region and released in the first's, which selects the first — the release moved
// the pointer onto it — and takes neither. A CLICK inside the `EXTRAS` region,
// both edges in the one region, which takes it.
//
// THE VERDICT. The highlight follows the pointer onto each region it enters, the
// split gesture leaves the game on the title with nothing opened, and the click
// opens the Extras select screen, which is what `EXTRAS` does (`specs/ui.md`).

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertNotNull,
  assertNull,
} from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureReplay,
  centerOf,
  clickAt,
  createHarness,
  drag,
  openTitle,
  type Harness,
  type MenuItemRect,
} from "../harness";

/** `EXTRAS`, the entry the deciding click takes. */
const EXTRAS_ITEM = TITLE_ITEMS.indexOf("EXTRAS");

/** The last entry of the title menu, where the first two gestures start. */
const LAST_ITEM = TITLE_ITEMS.length - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** The region the build drew item `index` at, which must be one. */
async function regionOf(index: number): Promise<MenuItemRect> {
  const rect = await h.debug.menuItemRect(index);
  assertNotNull(
    rect,
    `menuItemRect(${index}) reports the region of an item the title menu shows`,
  );
  const region = rect as MenuItemRect;
  assertGreaterThan(region.w, 0, `item ${index}'s region has a width`);
  assertGreaterThan(region.h, 0, `item ${index}'s region has a height`);
  return region;
}

it("moves the highlight with the pointer and takes the item a click lands in", async () => {
  assertGreaterThan(
    EXTRAS_ITEM,
    -1,
    "TITLE_ITEMS carries an EXTRAS entry for the click to take",
  );

  await openTitle(h);
  const first = await regionOf(0);
  const last = await regionOf(LAST_ITEM);
  const extras = await regionOf(EXTRAS_ITEM);
  assertNull(
    await h.debug.menuItemRect(TITLE_ITEMS.length),
    "the read answers null for an index the title menu carries no item at",
  );

  await h.debug.pointerMove(centerOf(last).x, centerOf(last).y);
  await h.advance(1);
  const hovered = await h.snapshot();
  assertEqual(
    hovered.menuIndex,
    LAST_ITEM,
    "a pointer moved onto an item's region highlights that item",
  );
  assertEqual(hovered.screen, "title", "and a move alone takes nothing");

  await drag(h, centerOf(last), centerOf(first));
  await h.advance(1);
  const split = await h.snapshot();
  assertEqual(
    split.screen,
    "title",
    "a press and a release in different regions take no item",
  );
  assertEqual(
    split.menuIndex,
    0,
    "though the release moved the pointer onto the first item, which selects it",
  );

  const taken = await captureReplay(h, "selected", async () => {
    await clickAt(h, centerOf(extras));
    await h.advance(1);
    return h.snapshot();
  });
  assertEqual(
    taken.screen,
    "select",
    "a press and a release inside one item's region take that item",
  );
  assertEqual(
    taken.mode,
    "extras",
    "and the item both edges landed in was EXTRAS, which opens the Extras",
  );
});

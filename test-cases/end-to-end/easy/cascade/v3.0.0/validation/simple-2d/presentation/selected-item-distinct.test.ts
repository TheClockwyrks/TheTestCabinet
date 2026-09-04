// presentation/selected-item-distinct — the selected menu item is drawn apart
// from the items beside it.
//
// THE RULE. `specs/controls.md`, Menu navigation: "`menuIndex` is the selected
// item on that menu, counted from `0` for the first, and the selected item is
// drawn distinctly from the others."
//
// WHY THE READING IS ONE ITEM ACROSS TWO SELECTIONS, and not two items under one.
// The title's two items carry different copy — `NEW GAME` and `HOW TO PLAY` — so
// their regions differ in ink whatever the selection is doing, and a check
// comparing one against the other would report a difference on a build that draws
// no indication at all. Comparing ONE region against ITSELF, once while its item
// is selected and once while it is not, leaves the copy, the layout and the
// palette identical between the two readings and the selection as the only thing
// that moved. A build that draws the selection nowhere paints the same pixels
// twice and fails.
//
// BOTH ITEMS ARE READ, because a build can mark one item and forget the other,
// and the failure names the one that never changed.
//
// THE REGIONS ARE THE BUILD'S OWN, asked for through `menuItemRect`
// (`specs/instrumentation.md`), so any layout passes.
//
// WHY A SHARE OF CHANGED CELLS RATHER THAN A MEAN. `specs/` fixes no form for the
// indication: a filled bar, an outline, a caret drawn beside the label and a
// recoloured word are all honest, and the last two leave most of the region
// untouched. A mean over the region would wash them out. So the reading counts
// the cells that changed, and asks that a share of the region moved.
//
// THE PALETTE IS THE BUILD'S: nothing here knows a colour, and what is measured
// is the distance between two things the build itself painted.
//
// WHAT THIS DOES NOT DECIDE. Which item `menuIndex` names, which every
// `navigation/`, `pointer/` and `touch/` point decides, nor whether the label
// inside the region can be read, which is `presentation/text-legible`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import { TITLE_HOW_TO_ITEM, TITLE_NEW_GAME_ITEM } from "../constants";
import {
  captureStill,
  createHarness,
  menuRect,
  openTitle,
  type Harness,
} from "../harness";
import {
  differingCells,
  sampleUnitGrid,
  unitGrid,
  type UnitGrid,
} from "./reading";
import type { Rgb } from "../harness";

/**
 * How far apart two paintings of one cell must lie to count as a change, in RGB
 * distance out of `441`.
 *
 * The same floor `presentation/slot-distinct-from-table` holds a mark to against
 * the felt: a fifteenth of the scale, which is a difference a player picks out of
 * a plain ground without it having to be loud. `specs/controls.md` fixes no
 * colour for the indication, so the figure is a threshold of visibility and not a
 * palette.
 */
const CHANGE_INK = 30;

/**
 * How much of an item's region has to be painted differently when it is the
 * selected one, as a share of the region.
 *
 * `specs/controls.md` fixes no form for the indication, so the floor has to admit
 * the quietest honest one. A one-unit outline drawn around a region already
 * covers several per cent of it, and a caret glyph beside the label covers a few
 * more, while a build that draws nothing covers none. `1%` sits under every mark
 * a player can actually see and above the anti-aliasing of a redrawn frame. It is
 * an area, so it does not move with how finely the region is sampled.
 */
const CHANGE_SHARE = 0.01;

/** The two items of the title's menu, which is the menu this point reads. */
const ITEMS = [TITLE_NEW_GAME_ITEM, TITLE_HOW_TO_ITEM];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the selected title item apart from the item beside it", async () => {
  openTitle(h);

  const grids: UnitGrid[] = [];
  for (const item of ITEMS) {
    grids.push(unitGrid(menuRect(h, item)));
  }

  // One reading per selection, each after the frame that drew it.
  const paintings: Rgb[][][] = [];
  for (const item of ITEMS) {
    h.debug.setMenuIndex(item);
    await h.advance(1);
    const row: Rgb[][] = [];
    for (const grid of grids) {
      row.push(sampleUnitGrid(h, grid));
    }
    paintings.push(row);
  }

  // The title as it stands with the second item selected, which is the frame the
  // second reading was taken from.
  captureStill(h, "selected");

  for (const [slot, item] of ITEMS.entries()) {
    const changed = differingCells(
      paintings[0][slot],
      paintings[1][slot],
      CHANGE_INK,
    ).length;
    assertGreaterThanOrEqual(
      changed / grids[slot].cells,
      CHANGE_SHARE,
      `the share of item ${String(item)}'s own region the title drew ` +
        `differently while that item was selected, against a change of at ` +
        `least ${String(CHANGE_INK)} out of 441 per cell (specs/controls.md: ` +
        `the selected item is drawn distinctly from the others) — ` +
        `${String(changed)} of ${String(grids[slot].cells)} cells moved`,
    );
  }
});

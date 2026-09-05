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
// WHY CHANGED CELLS RATHER THAN A MEAN. `specs/` fixes no form for the
// indication: a filled bar, an outline, a caret drawn beside the label and a
// recoloured word are all honest, and the last two leave most of the region
// untouched. A mean over the region would wash them out. So the reading counts
// the cells that changed, and asks that at least one of them did. Rendering is
// deterministic and the two frames differ in nothing but the selection, so a
// build that draws no indication changes none of them and no threshold is needed
// or stated. The region is read at unit pitch so that a one-unit caret or outline
// lands on cells rather than between them.
//
// THE PALETTE IS THE BUILD'S: nothing here knows a colour, and how loudly the
// indication reads is the reviewer's.
//
// WHAT THIS DOES NOT DECIDE. Which item `menuIndex` names, which every
// `navigation/`, `pointer/` and `touch/` point decides, nor how legibly the label
// inside the region reads, which is the reviewer's.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
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

/** The two items of the title's menu, which is the menu this point reads. */
const ITEMS = [TITLE_NEW_GAME_ITEM, TITLE_HOW_TO_ITEM];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("draws the selected title item apart from the item beside it", async () => {
  await openTitle(h);

  const grids: UnitGrid[] = [];
  for (const item of ITEMS) {
    grids.push(unitGrid(await menuRect(h, item)));
  }

  // One reading per selection, each after the frame that drew it.
  const paintings: Rgb[][][] = [];
  for (const item of ITEMS) {
    await h.debug.setMenuIndex(item);
    await h.advance(1);
    const row: Rgb[][] = [];
    for (const grid of grids) {
      row.push(await sampleUnitGrid(h, grid));
    }
    paintings.push(row);
  }

  // The title as it stands with the second item selected, which is the frame the
  // second reading was taken from.
  await captureStill(h, "selected");

  for (const [slot, item] of ITEMS.entries()) {
    const changed = differingCells(
      paintings[0][slot],
      paintings[1][slot],
    ).length;
    assertGreaterThan(
      changed,
      0,
      `item ${String(item)}'s own region drawn differently while that item ` +
        "was selected (specs/controls.md: the selected item is drawn " +
        `distinctly from the others) — ${String(changed)} of ` +
        `${String(grids[slot].cells)} cells moved`,
    );
  }
});

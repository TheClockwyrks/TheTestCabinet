// panels/controls-are-clickable — the shell is operable with the mouse.
//
// `specs/controls.md`: every menu item, panel control and status-bar control is
// clickable, and `specs/ui.md` requires every panel and menu to be fully operable
// with the mouse with the keyboard as the alternative. This drives one of each
// and reads the effect the specification states for it.
//
// FINDING A CONTROL WITHOUT A LAYOUT. `specs/overview.md` hands the layout to the
// build, so nothing here knows where anything is drawn. The copy IS fixed, so the
// menu item is found by `TITLE_ITEMS`' `NEW EXPEDITION` and the panel control by
// `specs/ui.md`'s `SELL`, each located in the frame's own text runs and clicked
// where the build drew it. The three status-bar controls carry no fixed copy, and
// the only thing fixed about them is that they are ON the bar, so the bar is
// swept until one answers. See `panels/mouse.ts`.
//
// Each click's effect is the one the specification names for that control: the
// title item goes to `mode-select`, `SELL` converts the bay to Credits and empties
// it, and a status-bar control opens the inventory, pauses, or toggles mute.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  layCamp,
  openScene,
  pinDrill,
  stageCargo,
  standAtCamp,
  type Harness,
} from "../harness";
import { clickNear, findText, sweepStatusBar } from "./mouse";

/** The cargo the sale is driven with: one ore, a known count. */
const SOLD = { ore: "ferron" as const, count: 4 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("operates a menu item, a panel control and a bar control by mouse", async () => {
  const took = await captureReplay(h, "click", async () => {
    // A menu item. The slot is cleared so the title menu is the two-item one and
    // `NEW EXPEDITION` is what the copy below names.
    h.debug.clearSave();
    h.debug.reset();
    h.debug.setScreen("title");
    const item = await findText(h, /new expedition/i);
    const menu =
      item !== null &&
      (await clickNear(h, item, () => h.snapshot().screen === "mode-select"));

    // A panel control, at the Ore Market with a known bay to sell.
    openScene(h);
    layCamp(h);
    pinDrill(h);
    standAtCamp(h);
    stageCargo(h, { [SOLD.ore]: SOLD.count });
    h.debug.setCredits(0);
    h.debug.setPanel("ore-market");
    const sell = await findText(h, /sell/i);
    const sold =
      sell !== null &&
      (await clickNear(h, sell, () => {
        const s = h.snapshot();
        return s.credits > 0 && s.cargo.slotsUsed === 0;
      }));

    // A status-bar control. Whichever of the three answers first counts, and the
    // game is put back between clicks so the sweep reads one control at a time.
    openScene(h);
    layCamp(h);
    standAtCamp(h);
    const resting = h.snapshot();
    const bar = await sweepStatusBar(
      h,
      () => {
        const s = h.snapshot();
        return (
          s.panel === "inventory" ||
          s.screen === "paused" ||
          s.muted !== resting.muted
        );
      },
      () => {
        h.debug.setPanel(null);
        h.debug.setScreen("in-mine");
      },
    );

    return { menu, sold, bar };
  });

  assertEqual(took.menu, true, "specs/controls.md");
  assertEqual(took.sold, true, "specs/ui.md");
  assertEqual(took.bar, true, "specs/ui.md");
});

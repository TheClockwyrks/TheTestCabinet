// screens/pause-menu-entries — the pause menu shows its three entries, in the
// order the specification fixes.
//
// `specs/ui.md` fixes the pause menu as `PAUSE_ITEMS` — `RESUME`, `RESTART`,
// `QUIT TO MENU`, "in that order" — and `specs/controls.md` states how a menu
// shows that order: "Every menu is vertical." So the point is two readings of
// one frame: all three entries were drawn, and they were drawn top to bottom in
// the order the constant gives them.
//
// THE ORDER MATTERS MORE HERE THAN ANYWHERE ELSE ON THE PAUSE SCREEN, which is
// why it is its own point. The three entries do three very different things —
// one carries on, one throws the run away, one leaves the game — and a player
// takes the entry the highlight is on. A menu that shows them in another order
// is a menu that discards a run when the player meant to carry on.
//
// THE ORDER IS A PLACEMENT, NOT A DRAW ORDER: the reading is where each entry's
// glyphs LANDED, through `harness.ts`'s `drawnTextSpans`, so which call a build
// happens to issue first changes nothing.
//
// NO FIGURE IS FIXED FOR THE SPACING. `specs/ui.md` leaves "the layout of each
// screen" to the build, so the check asserts the sign of each separation and
// nothing about its size — there is no threshold in this file, and none to
// argue about: a menu in the wrong order reads as a separation of the opposite
// sign, and one that draws two entries on a single line reads as zero.
//
// THE SCREEN IS POSED ON A REAL, QUIET GAME. `startPlaying` leaves live play on
// an empty field with the wave loop, the saucer's arrival and the ship's lethal
// contact all off, and `setScreen("paused")` then puts the menu up over it —
// so nothing behind the menu can move while the frame is read.
//
// WHAT THIS DOES NOT DECIDE. Where each entry leads
// (`screens/resume-returns-to-play`, `screens/restart-begins-a-new-game`,
// `screens/quit-returns-to-the-title`), which entry is highlighted
// (`screens/title-menu-highlight` decides the highlight itself), and that the
// field behind the menu is frozen (`screens/pause-freezes-the-field`).

import { afterEach, beforeEach, it } from "vitest";
import { PAUSE_ITEMS } from "../../src/constants";
import { assertContains, assertLessThan } from "../assert";
import {
  captureStill,
  clearCalls,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { drawnRuns, menuRows } from "./reading";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws all three PAUSE_ITEMS, stacked in the order the spec fixes", async () => {
  // The pause menu over the empty, quiet field `startPlaying` leaves, drawn once.
  startPlaying(h);
  h.debug.setScreen("paused");
  clearCalls(h);
  await h.advance(1);
  captureStill(h, "menu");

  const drawn = drawnRuns(h);
  for (const item of PAUSE_ITEMS) {
    assertContains(
      drawn,
      item.toLowerCase(),
      `the pause menu entry ${JSON.stringify(item)} drawn on the paused ` +
        "screen's frame — PAUSE_ITEMS is RESUME, RESTART, QUIT TO MENU " +
        "(specs/ui.md)",
    );
  }

  const rows = menuRows(h, PAUSE_ITEMS);
  for (let above = 0; above + 1 < rows.length; above += 1) {
    const upper = rows[above];
    const lower = rows[above + 1];
    assertLessThan(
      upper.y - lower.y,
      0,
      `how far ${JSON.stringify(upper.item)} was drawn BELOW ` +
        `${JSON.stringify(lower.item)}, in logical units — the pause menu is ` +
        "vertical (specs/controls.md) and shows PAUSE_ITEMS in the order the " +
        `specification fixes (specs/ui.md), so entry ${String(above)} is ` +
        `drawn at a smaller y than entry ${String(above + 1)}; ` +
        `${JSON.stringify(upper.item)} landed at y ${String(upper.y)} and ` +
        `${JSON.stringify(lower.item)} at y ${String(lower.y)}`,
    );
  }
});

// states/pause-menu-items — the pause menu draws its three items.
//
// specs/ui.md fixes the pause menu as `RESUME`, `RESTART`, `QUIT TO MENU`, "in
// the order given, stacked one above the next", gives the paused screen as "the
// pause menu, over a maze that stays visible and frozen behind it", and requires
// that "the selected item is drawn distinctly from the others, so a player always
// sees which item `confirm` would take".
//
// SO THIS POINT READS THE FRAME, not the state. `menuIndex` says which item the
// game believes is selected; what a player can act on is what the frame drew, and
// a build that reports a menu it never draws leaves them reading a blank screen
// with two of the three ways out of a dive behind it.
//
// HOW "DRAWN DISTINCTLY" IS DECIDED. specs/ui.md fixes the requirement and not
// the presentation: brighter text, a marker beside the item, a panel behind it
// are all conforming, and asserting any one of them would fail a build that chose
// another. What every one of them has in common is the observable consequence —
// move the selection and the picture changes. So the check measures how much of
// the frame changed when the selection moved, against a baseline taken with the
// selection UNMOVED, and a build whose title animates on its own still passes
// because the baseline is charged for the animation too.
//
// THE SELECTION IS MOVED WITH `setMenuIndex`, never with a key: which key moves a
// selection is `controls`' point, and a build with a broken `down` action must
// still pass this one. WHERE the three items lead is `states.resume-from-pause`
// and the two `navigation` points.

import { afterEach, beforeEach, it } from "vitest";

import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertLessThan,
} from "../assert";
import { PAUSE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { assertDrew, drawnText, frameOps, opDiff } from "./screens";

/**
 * How much more of the frame must change when the selection moves than when it
 * does not, in operations.
 *
 * ONE operation. The bound is deliberately the smallest one that is not zero:
 * specs/ui.md asks that the selected item be "drawn distinctly from the others"
 * and fixes nothing about how much of the picture that costs, so anything larger
 * would be a figure this suite invented. What it rules out is exactly what the
 * requirement rules out — a menu whose items are all drawn the same, which
 * changes the picture by nothing at all when the selection moves.
 */
const SELECTION_CHANGE_MIN = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws RESUME, RESTART and QUIT TO MENU over the maze, one of them selected", async () => {
  await startPlaying(h);
  // The board is emptied of hunters: what this decides is a screen, and a
  // release that came early would end the dive under the reading
  // (specs/instrumentation.md).
  await h.debug.clearPredators();
  await h.debug.setScreen("paused");
  await h.debug.setMenuIndex(0);
  const paused = await h.snapshot();
  assertEqual(paused.screen, "paused", "the screen the menu is read on");

  const selected = await frameOps(h);
  // Before the assertions, so a failing check still leaves the menu it read.
  await captureStill(h, "menu");

  // The same screen again, nothing touched: what one frame of it costs the next
  // all by itself.
  const unmoved = await frameOps(h);
  // And the same screen with the selection moved off the first item.
  await h.debug.setMenuIndex(1);
  const moved = await frameOps(h);

  for (const item of PAUSE_ITEMS) {
    assertDrew(
      selected,
      item,
      `an item of the pause menu, which is ${PAUSE_ITEMS.join(", ")} ` +
        "(specs/ui.md)",
    );
  }

  const drawn = drawnText(selected);
  assertLessThan(
    drawn.indexOf(PAUSE_ITEMS[0]),
    drawn.indexOf(PAUSE_ITEMS[1]),
    `where ${PAUSE_ITEMS[0]} was drawn against ${PAUSE_ITEMS[1]}, which the ` +
      "pause menu stacks in the order specs/ui.md gives",
  );
  assertLessThan(
    drawn.indexOf(PAUSE_ITEMS[1]),
    drawn.indexOf(PAUSE_ITEMS[2]),
    `where ${PAUSE_ITEMS[1]} was drawn against ${PAUSE_ITEMS[2]}, which the ` +
      "pause menu stacks in the order specs/ui.md gives",
  );

  assertDrew(
    selected,
    `DEPTH ${String(paused.depth)}`,
    "the HUD's depth readout, still drawn over the maze that stays visible " +
      "behind the pause menu (specs/ui.md)",
  );

  const idle = opDiff(selected, unmoved);
  assertGreaterThanOrEqual(
    opDiff(selected, moved),
    idle + SELECTION_CHANGE_MIN,
    "operations of the pause frame that changed when the selection moved off " +
      `${PAUSE_ITEMS[0]}, against the ${String(idle)} that changed when it did ` +
      "not — the selected item is drawn distinctly from the others " +
      "(specs/ui.md)",
  );
});

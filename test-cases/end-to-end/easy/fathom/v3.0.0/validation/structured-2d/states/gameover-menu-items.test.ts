// states/gameover-menu-items — the game-over menu draws its two items.
//
// specs/ui.md fixes the game-over menu as `PLAY AGAIN` then `MENU`, "in the order
// given, stacked one above the next", and requires that "the selected item is
// drawn distinctly from the others, so a player always sees which item `confirm`
// would take".
//
// SO THIS POINT READS THE FRAME, not the state. These two entries are the whole
// of what a finished run offers, and a screen that draws neither leaves the
// player reading a dead end whatever `menuIndex` reports.
//
// HOW "DRAWN DISTINCTLY" IS DECIDED, and why the selection is moved with
// `setMenuIndex` rather than with a key, are the same as
// `states.pause-menu-items`: the requirement fixes the consequence and not the
// presentation, so what is measured is that moving the selection changed the
// picture, against a baseline taken with it unmoved.
//
// The screen is posed straight through `setScreen` rather than reached by
// spending three lives, because reaching it is `scoring.three-lives`'s point and
// a longer route only adds failure modes. What the screen REPORTS about the run
// is `states.gameover-reports-the-run`; where the two items lead are
// `states.play-again` and `navigation.gameover-menu`.

import { afterEach, beforeEach, it } from "vitest";

import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertLessThan,
} from "../assert";
import { drewText } from "../case-harness/text";
import { GAMEOVER_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { frameOps, opDiff, runOrder } from "./screens";

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

it("draws PLAY AGAIN then MENU, with one of the two selected", async () => {
  startPlaying(h);
  h.debug.setScreen("gameover");
  h.debug.setMenuIndex(0);
  assertEqual(
    h.snapshot().screen,
    "gameover",
    "the screen the menu is read on",
  );

  const selected = await frameOps(h);
  // Before the assertions, so a failing check still leaves the menu it read.
  captureStill(h, "menu");

  const unmoved = await frameOps(h);
  h.debug.setMenuIndex(1);
  const moved = await frameOps(h);

  for (const item of GAMEOVER_ITEMS) {
    assertEqual(
      drewText(selected, item),
      true,
      `an item of the game-over menu, which is ` +
        `${GAMEOVER_ITEMS.join(" then ")} (specs/ui.md)`,
    );
    // Placed before two placings are compared: `-1` would sort before anything.
    assertGreaterThanOrEqual(
      runOrder(selected, item),
      0,
      `where ${item} was drawn in the game-over frame's reading order`,
    );
  }

  assertLessThan(
    runOrder(selected, GAMEOVER_ITEMS[0]),
    runOrder(selected, GAMEOVER_ITEMS[1]),
    `where ${GAMEOVER_ITEMS[0]} was drawn against ${GAMEOVER_ITEMS[1]}, which ` +
      "the game-over menu stacks in the order specs/ui.md gives",
  );

  const idle = opDiff(selected, unmoved);
  assertGreaterThanOrEqual(
    opDiff(selected, moved),
    idle + SELECTION_CHANGE_MIN,
    "operations of the game-over frame that changed when the selection moved " +
      `off ${GAMEOVER_ITEMS[0]}, against the ${String(idle)} that changed when ` +
      "it did not — the selected item is drawn distinctly from the other " +
      "(specs/ui.md)",
  );
});

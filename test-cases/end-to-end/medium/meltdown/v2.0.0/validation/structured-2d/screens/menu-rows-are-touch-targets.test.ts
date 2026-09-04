// Meltdown — screens/menu-rows-are-touch-targets — every reported menu row is big enough
// to tap, and no two rows of one menu overlap.
//
// THE RULE. `specs/screens.md`, Menus: "A row's rectangle is at least
// `MIN_TOUCH_TARGET` logical units tall and at least `MIN_TOUCH_TARGET` wide, the
// figure `specs/hud.md` gives the panel's controls, and no two rows of one menu
// overlap."
//
// WHY BOTH HALVES ARE ONE REQUIREMENT. They are the two ways a reported rectangle
// can be untappable: too small to hit with a finger, or sitting on top of its
// neighbour so that a hit is ambiguous. A build that reported a hairline row and a
// build that reported every row at the same place have each made the menu
// unusable by touch in the same way, and both are caught here.
//
// ALL SEVEN MENU SCREENS, because the rule is stated of every menu in the game.
// The failure names the screen and the row.
//
// THE FIGURE IS THIS PROJECT'S OWN TRANSCRIPTION of `MIN_TOUCH_TARGET`, which
// `specs/hud.md` states and `specs/screens.md` names again for a menu row, so one
// transcription carries both.
//
// WHAT THIS DOES NOT DECIDE. That the rectangles are reported at all, one per row
// and in order, is `screens.menu-rows-reported`'s; that the panel's own controls
// meet the same figure is `hud.touch-targets`'s; and that a press inside one takes
// the row is `controls.pointer-takes-a-menu-row`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import {
  DIFFICULTY_ITEMS,
  ENDING_ITEMS,
  HOWTO_ITEMS,
  MIN_TOUCH_TARGET,
  MODE_ITEMS,
  PAUSE_ITEMS,
  TITLE_ITEMS,
} from "../constants";
import {
  captureStill,
  createHarness,
  resetTo,
  startRun,
  type Harness,
  type Screen,
} from "../harness";

/**
 * The seven screens that show a menu, and the rows `specs/screens.md` gives each,
 * top to bottom.
 *
 * `playing` is the eighth screen and the one with no menu, so it is read below on
 * its own: `specs/instrumentation.md` leaves `menu` empty there.
 */
const MENUS: readonly { screen: Screen; items: readonly string[] }[] = [
  { screen: "title", items: TITLE_ITEMS },
  { screen: "modeselect", items: MODE_ITEMS },
  { screen: "difficultyselect", items: DIFFICULTY_ITEMS },
  { screen: "howto", items: HOWTO_ITEMS },
  { screen: "paused", items: PAUSE_ITEMS },
  { screen: "victory", items: ENDING_ITEMS },
  { screen: "gameover", items: ENDING_ITEMS },
];

/** The screens a menu is drawn over a live run on, which have to be opened as one. */
const OVER_A_RUN: readonly Screen[] = [
  "playing",
  "paused",
  "victory",
  "gameover",
];

/** One reported row, as much of it as this check reads. */
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Whether two rectangles share any area at all. */
function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Pose one screen with its highlight on `index`, and run the frame that draws it. */
async function open(screen: Screen, index = 0): Promise<void> {
  if (OVER_A_RUN.includes(screen)) startRun(h);
  else resetTo(h);
  h.debug.setScreen(screen);
  h.debug.setMenuIndex(index);
  await h.advance(1);
}

it("reports rows at least MIN_TOUCH_TARGET on a side that do not overlap", async () => {
  for (const { screen, items } of MENUS) {
    await open(screen);
    const rows = h.snapshot().menu;
    if (screen === "modeselect") captureStill(h, "rows");

    assertEqual(
      rows.length,
      items.length,
      `precondition: the rectangles ${screen} reports for its ` +
        `${items.length} rows (specs/screens.md, Menus)`,
    );

    for (const row of rows) {
      const where =
        `row ${row.index} of ${screen}, reported at ` +
        `(${row.x}, ${row.y}) ${row.w}x${row.h}`;
      assertGreaterThanOrEqual(
        row.w,
        MIN_TOUCH_TARGET,
        `${where}: its width, which specs/screens.md holds at ` +
          `MIN_TOUCH_TARGET logical units or more`,
      );
      assertGreaterThanOrEqual(
        row.h,
        MIN_TOUCH_TARGET,
        `${where}: its height, which specs/screens.md holds at ` +
          `MIN_TOUCH_TARGET logical units or more`,
      );
    }

    for (let a = 0; a < rows.length; a += 1) {
      for (let b = a + 1; b < rows.length; b += 1) {
        assertEqual(
          overlaps(rows[a], rows[b]),
          false,
          `rows ${rows[a].index} and ${rows[b].index} of ${screen}, ` +
            `reported at (${rows[a].x}, ${rows[a].y}) ` +
            `${rows[a].w}x${rows[a].h} and (${rows[b].x}, ${rows[b].y}) ` +
            `${rows[b].w}x${rows[b].h}: whether they share any area, ` +
            `which specs/screens.md refuses`,
        );
      }
    }
  }
});

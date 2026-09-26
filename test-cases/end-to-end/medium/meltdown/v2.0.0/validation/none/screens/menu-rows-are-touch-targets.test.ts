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
// WHATEVER THE BUILD REPORTS IS WHAT IS READ. This check does not decide how many
// rectangles a menu ought to report, so it makes no claim about the count and
// measures the ones it is handed. A build that reports the wrong number of rows
// loses `screens.menu-rows-reported` and loses it once.
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
import { MIN_TOUCH_TARGET, type Screen } from "../constants";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";

/**
 * The seven screens that show a menu.
 *
 * `playing` is the eighth screen and the one with no menu, so it is read below on
 * its own: `specs/instrumentation.md` leaves `menu` empty there.
 */
const MENUS: readonly Screen[] = [
  "title",
  "modeselect",
  "difficultyselect",
  "howto",
  "paused",
  "victory",
  "gameover",
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

afterEach(async () => {
  await h?.dispose();
});

/** Pose one screen with its highlight on `index`, and run the frame that draws it. */
async function open(screen: Screen, index = 0): Promise<void> {
  if (OVER_A_RUN.includes(screen)) await startRun(h);
  else await h.debug.reset();
  await h.debug.setScreen(screen);
  await h.debug.setMenuIndex(index);
  await h.advance(1);
}

it("reports rows at least MIN_TOUCH_TARGET on a side that do not overlap", async () => {
  for (const screen of MENUS) {
    await open(screen);
    const rows = (await h.snapshot()).menu;
    if (screen === "modeselect") await captureStill(h, "rows");

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

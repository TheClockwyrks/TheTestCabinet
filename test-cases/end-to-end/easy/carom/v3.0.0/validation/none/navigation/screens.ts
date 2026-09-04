// Carom — reaching each menu screen, for the navigation checks. CASE-PROVIDED.
//
// Every navigation check presses ONE real key at a menu and reads where the game
// went (specs/ui.md, "Menu navigation"). The snapshot reports `screen` AND
// `menuIndex`, so a moved selection is read straight off it. That is what lets
// each point grade one transition: a check about a movement edge reads the index
// and never confirms, and a check about a confirm poses the index and never
// presses an arrow.
//
// These helpers bring the game to the screen a check presses its key from, and
// every one of them POSES it through the debug surface — the title with one item
// highlighted, a live match, the pause menu over it, a finished match. The screen
// a check starts on is its ground rather than its subject, so a build with a
// broken title menu fails the title points alone and still reaches the pause
// ones. The one key press a check makes is the one its point is about.

import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  openIsolatedPauseMenu,
  openMatchOver,
  type Harness,
  type Mode,
  type Side,
} from "../harness";

/** The title menu's three entries, by index (specs/ui.md, `TITLE_ITEMS`). */
export const TITLE_SOLO = TITLE_ITEMS.indexOf("SOLO");
export const TITLE_VERSUS = TITLE_ITEMS.indexOf("VERSUS");
export const TITLE_HOWTO = TITLE_ITEMS.indexOf("HOW TO PLAY");

/**
 * Open the title with item `index` highlighted: the ground every title check
 * presses its one key from.
 *
 * Two operations. `reset` returns every declared field to its title value, which
 * puts `menuIndex` and `titleIndex` both at `0` (specs/state.md), and
 * `setMenuIndex` moves the highlight and nothing else — which is exactly the "on
 * the title with `menuIndex` N" each of these points names. Reached by pose
 * rather than by arrow presses, so a build whose down edge is broken fails
 * `title-down` and still has `title-down-wraps` and `title-howto` graded on their
 * own edges.
 *
 * `titleIndex` is left at `0` on purpose: the two how-to points read `menuIndex`
 * back after a return to the title, and specs/ui.md restores it from
 * `titleIndex`.
 */
export async function selectTitle(h: Harness, index: number): Promise<void> {
  await h.debug.reset();
  await h.debug.setMenuIndex(index);
  const opened = await h.snapshot();
  assertEqual(opened.screen, "title");
  assertEqual(opened.menuIndex, index);
}

/**
 * Open a `mode` match into live play and raise the pause menu over it, through
 * the surface alone.
 *
 * `openIsolatedPauseMenu` poses what specs/ui.md says a `pause` edge sets —
 * `resumeScreen` the screen that was paused, `menuIndex` `0` — so a check about
 * what an item of that menu DOES starts from the stated ground without resting
 * on the key that opens it. That key is `pause-escape`'s point, and its alone.
 *
 * The field is EMPTIED before the menu is posed. A ball left live behind a build
 * whose pause does not really stop the world can bank a shot into a goal and
 * take the screen away from the reading, which would report the pause's defect
 * against a navigation point.
 */
export async function reachPaused(h: Harness, mode: Mode): Promise<void> {
  await openIsolatedPauseMenu(h, { mode, from: "playing" });
  const paused = await h.snapshot();
  assertEqual(paused.screen, "paused");
  assertEqual(paused.menuIndex, 0);
}

/**
 * Reach the match-over screen on a clean win for `winner` in a `mode` match.
 *
 * Posed rather than played out. Driving twenty-two real points to grade one menu
 * transition would fail every one of these points whenever the scoring or the win
 * rule was broken, and those belong to the gameplay checks and to
 * `ui/state-matchover`, which does drive a real match to its end. What is posed
 * here is what specs/balls.md says reaching the screen sets: a winner, the final
 * score, and `menuIndex` at `0`.
 */
export async function reachMatchover(
  h: Harness,
  mode: Mode,
  winner: Side = "left",
): Promise<void> {
  await openMatchOver(h, { winner, mode });
  const over = await h.snapshot();
  assertEqual(over.screen, "matchover");
  assertEqual(over.winner, winner);
  assertEqual(over.menuIndex, 0);
}

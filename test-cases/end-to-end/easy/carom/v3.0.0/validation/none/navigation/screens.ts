// Carom — reaching each menu screen, for the navigation checks. CASE-PROVIDED.
//
// Every navigation check presses real keys at a menu and reads where the game
// went (specs/ui.md, "Menu navigation"). The snapshot reports the screen, the
// mode, the scores and the winner, and not `menuIndex`; a check about the
// selection therefore reads it the way a player does, by confirming and seeing
// which entry was taken. These helpers bring the game to the screen a check
// starts from: through the debug surface where that screen is only the check's
// ground (a live, paused, or finished match — the title menus are the
// navigation checks' own surface to grade, not a route to somewhere else), and
// through the keys where the menu transition itself is what the check decides.

import { assertEqual } from "../assert";
import { WIN_SCORE } from "../constants";
import {
  arrangeGoal,
  driveGoal,
  startPlaying,
  type Harness,
  type Mode,
} from "../harness";

/** Open a `mode` match through the debug surface and run it into live play. */
export async function reachPlaying(h: Harness, mode: Mode): Promise<void> {
  await startPlaying(h, mode);
  assertEqual((await h.snapshot()).screen, "playing");
}

/** Open a `mode` match into live play through the surface, and pause it. */
export async function reachPaused(h: Harness, mode: Mode): Promise<void> {
  await reachPlaying(h, mode);
  await h.tap("Escape");
  assertEqual((await h.snapshot()).screen, "paused");
}

/** Open the how-to screen from the title with keys. */
export async function reachHowto(h: Harness): Promise<void> {
  await h.debug.reset();
  await h.tap("ArrowDown"); // SOLO -> VERSUS
  await h.tap("ArrowDown"); // VERSUS -> HOW TO PLAY
  await h.tap("Enter");
  assertEqual((await h.snapshot()).screen, "howto");
}

/**
 * Drive a `mode` match to its end: the score posed one point short of the win,
 * then a real point out of the right goal, so the match-over screen is reached
 * through the build's own win rule.
 */
export async function reachMatchover(h: Harness, mode: Mode): Promise<void> {
  await startPlaying(h, mode);
  await h.debug.setScore(WIN_SCORE - 1, 0);
  await arrangeGoal(h, "right");
  const ended = await driveGoal(h);
  assertEqual(ended.hit, true);
  const over = await h.snapshot();
  assertEqual(over.screen, "matchover");
  assertEqual(over.winner, "left");
}

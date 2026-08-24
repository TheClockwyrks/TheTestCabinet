// Carom — reaching each menu screen, for the navigation checks. CASE-PROVIDED.
//
// Every navigation check presses real keys at a menu and reads where the game
// went (specs/ui.md, "Menu navigation"). The snapshot reports the screen, the
// mode, the scores and the winner, and not `menuIndex`; a check about the
// selection therefore reads it the way a player does, by confirming and seeing
// which entry was taken. These helpers bring the game to the screen a check
// starts from, through the keys where the specification leaves the build's own
// code to make the transition, and through the surface where only a posed
// precondition (a score one short of the win) can reach it in bounded time.

import { assertEqual } from "../assert";
import { WIN_SCORE } from "../constants";
import {
  arrangeGoal,
  driveGoal,
  startWithKeys,
  startPlaying,
  type Harness,
  type Mode,
} from "../harness";

/** Frames from the title confirm into a live rally: the hold, plus a margin. */
export const INTO_PLAY_TICKS = 156; // 1.3 s

/** Open a `mode` match from the title with keys and run it into live play. */
export async function reachPlaying(h: Harness, mode: Mode): Promise<void> {
  await startWithKeys(h, mode);
  await h.advance(INTO_PLAY_TICKS);
  assertEqual((await h.snapshot()).screen, "playing");
}

/** Open a `mode` match with keys, run it into live play, and pause it. */
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

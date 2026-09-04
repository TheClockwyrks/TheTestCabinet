// screens — reaching the five screens the checks in this directory grade, and
// taking a menu entry. PRIVATE to `screens/`.
//
// WHY THESE LIVE HERE RATHER THAN IN THE HARNESS. `specs/instrumentation.md` gives
// the debug surface one operation per field, so every arrangement is a sequence;
// the shared harness carries the sequences the whole project wants (an empty live
// field, a posed rock, a round on a rock's doorstep) and this file carries the four
// that only this group does. Nothing below asserts a verdict: each helper fails only
// when the game is not even on the screen the caller's scenario needs, and names
// what it needed.
//
// EVERY SCREEN IS POSED, AND EVERY ENTRY IS ADDRESSED. `setScreen` is the direct
// route to a screen whose CONTENT a check grades, and `setMenuIndex(n)` is the
// direct route to the entry whose DESTINATION it grades: the keys that reach a
// screen are `controls/pause-p`, `controls/pause-escape` and `controls/back-escape`'s
// requirement, and the keys that move a highlight are `controls/menu-down-arrow`'s
// and its three siblings', so a check here that counted presses would be grading
// them a second time and would fail for their faults. The one key every route below
// does press is the CONFIRM key, because `specs/instrumentation.md` carries no
// operation that takes a menu entry: confirming is the only way the entry's
// destination can be reached at all.

import { assertEqual } from "../assert";
import {
  KEYS_CONFIRM,
  SAFE_X,
  SAFE_Y,
  START_LIVES,
  type Screen,
} from "../constants";
import { clearWorld, type Harness } from "../harness";

/**
 * The key every route in this group confirms with.
 *
 * `Enter` rather than `Space`: `specs/controls.md` binds `Enter` to "Confirm the
 * selection" on a menu and to NOTHING at all while the game is being played, so a
 * build that resolved the key against the wrong screen cannot have it read as a
 * shot. Which keys confirm is `controls/confirm-enter`'s and
 * `controls/confirm-space`'s requirement, not any of this group's.
 */
const CONFIRM_KEY = KEYS_CONFIRM[1];

/**
 * One tick run after a press, before the reading is taken.
 *
 * {@link Harness.tap} already runs the tick that delivers the key, so a build that
 * acts on the press edge inside that tick has acted before this. This one tick is
 * for the build that LATCHES the edge and drains it at the top of the next tick,
 * which `specs/controls.md` leaves open: it fixes the press edge as the trigger and
 * says nothing about which tick the effect must land on. It costs nothing either
 * way — `tap` has already released the key, so no further edge can arrive in it.
 */
export const SETTLE_TICKS = 1;

/**
 * The game on its title screen, on the first entry, exactly as it opens.
 *
 * `reset()` restores `screen` to `"title"` and `menuIndex` to `0`
 * (`specs/instrumentation.md`), which is the arrangement `specs/ui.md` calls
 * arriving at the title. The harness has already reset the page once when it was
 * built; this states the precondition where a check depends on it rather than
 * leaving a reader to hold that table in mind.
 */
export async function reachTitle(h: Harness): Promise<void> {
  await h.debug.reset();
  const opened = await h.snapshot();
  assertEqual(opened.screen, "title", "the screen reset left the game on");
  assertEqual(opened.menuIndex, 0, "the entry reset left the highlight on");
}

/**
 * The how-to screen, posed.
 *
 * From a reset title, so nothing of a previous scenario is on the field behind it,
 * and by `setScreen` rather than by the title's second entry: that route is
 * `screens/howto-reachable`'s own requirement.
 */
export async function reachHowto(h: Harness): Promise<void> {
  await h.debug.reset();
  await h.debug.setScreen("howto");
  assertEqual(
    (await h.snapshot()).screen,
    "howto",
    'the screen setScreen("howto") posed',
  );
}

/**
 * Pause the game the caller has already posed.
 *
 * The caller reaches its live field through the harness's own `startPlaying` — the
 * empty, quiet, live field every scenario in this project starts from, both world
 * gates shut and the ship's contact gate shut — and poses whatever its requirement
 * concerns onto it first, so what is frozen here is the caller's own scene.
 */
export async function reachPaused(h: Harness): Promise<void> {
  await h.debug.setScreen("paused");
  assertEqual(
    (await h.snapshot()).screen,
    "paused",
    'the screen setScreen("paused") posed',
  );
}

/** What a game-over screen is posed to show: the run it ended on. */
export interface GameOverPose {
  /** The final score the screen reports. */
  score: number;
  /** The wave the run reached. */
  wave: number;
}

/**
 * The game-over screen, posed over an empty field with a finished run behind it.
 *
 * `specs/ui.md` shows `gameover` "on the tick the last ship is lost", so the run
 * behind it has `lives` `0`; reaching the screen by actually losing the last ship is
 * `screens/game-over-on-the-last-life`'s own requirement and nothing else here needs
 * to spend one. The two world gates are shut so no wave and no saucer can arrive
 * into a scenario that runs past the pose, and the field is emptied so what the
 * screen draws is the screen.
 */
export async function reachGameOver(
  h: Harness,
  pose: GameOverPose,
): Promise<void> {
  await h.debug.reset();
  await clearWorld(h);
  await h.debug.setWaveSpawning(false);
  await h.debug.setSaucerSpawning(false);
  await h.debug.setShipPosition(SAFE_X, SAFE_Y);
  await h.debug.setScore(pose.score);
  await h.debug.setWave(pose.wave);
  await h.debug.setLives(0);
  await h.debug.setScreen("gameover");
  const over = await h.snapshot();
  assertEqual(over.screen, "gameover", "the screen the game-over pose reached");
  assertEqual(over.score, pose.score, "the final score posed behind it");
  assertEqual(over.wave, pose.wave, "the wave posed behind it");
}

/**
 * Address `entry` on the menu the current screen shows and confirm it.
 *
 * The whole route a destination check drives: the highlight is placed by
 * `setMenuIndex` — the direct route, and the one that does not lean on the move
 * bindings `controls/menu-down-arrow` and its siblings grade — the pose is read back
 * so a check never confirms an entry it did not reach, and the confirm key is a real
 * one through Chromium's own input pipeline, because no operation of the surface
 * takes a menu entry.
 */
export async function confirmEntry(h: Harness, entry: number): Promise<void> {
  await h.debug.setMenuIndex(entry);
  assertEqual(
    (await h.snapshot()).menuIndex,
    entry,
    "the entry the highlight was addressed to before confirming",
  );
  await h.tap(CONFIRM_KEY);
  await h.advance(SETTLE_TICKS);
}

/** What a check expects of the run a fresh game opens with (`specs/progression.md`). */
export function assertFreshRun(
  snapshot: { screen: Screen; score: number; lives: number },
  what: string,
): void {
  assertEqual(snapshot.screen, "playing", `the screen ${what}`);
  assertEqual(snapshot.score, 0, `the score ${what}`);
  assertEqual(snapshot.lives, START_LIVES, `the ships ${what}`);
}

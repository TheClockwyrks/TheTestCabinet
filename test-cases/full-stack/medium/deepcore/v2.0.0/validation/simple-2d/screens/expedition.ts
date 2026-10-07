// Deepcore — the openings the screen checks share. CASE-PROVIDED.
//
// Not a `.test.ts`, so vitest never collects it. Everything here is built from
// the atomic operations `specs/instrumentation.md` fixes, exactly as the shared
// harness's own sequences are; it lives beside the suites that use it rather than
// in `harness.ts` because only the categories that end an expedition need it.
//
// TWO THINGS ARE WORTH SAYING ABOUT REACHING A SAVE.
//
// The slot outlives the harness. `reset()` deliberately leaves it alone, because
// a save outlives the session, so a check whose subject touches the save clears it
// itself rather than assuming it opened empty. Node has no `localStorage` at all,
// so a check that needs the slot to take a save asks its harness for one.
//
// Restoring is a MENU action and there is no operation for it, which is why
// `menuLength` reads a menu the way a player reads it — by stepping the highlight
// until it wraps — rather than by asking for a list the snapshot does not carry.

import { assertEqual } from "../assert";
import { ROCKET_COMPONENTS, SPAWN_COL } from "../constants";
import {
  ACTION_KEY,
  clearSaveSlot,
  layCamp,
  minerXOn,
  minerYOn,
  openScene,
  pinDrill,
  pinMiner,
  standAtCamp,
  type DeathCause,
  type DeepcoreSnapshot,
  type Harness,
  type Mode,
  type WorldSize,
} from "../harness";

/** How an expedition opens: the size, and the mode it is played in. */
export interface ExpeditionOptions {
  size?: WorldSize;
  mode?: Mode;
}

/**
 * Open an expedition standing at the camp with the save slot empty.
 *
 * `openScene` leaves an EMPTY mine, which is open at `row 1` too, so the camp's
 * ground is laid back the way generation leaves it before the miner is stood on
 * it; otherwise the first frame drops it down the shaft. One frame runs so the
 * miner is settled and reads as grounded before anything is asked of it.
 */
export async function openAtCamp(
  h: Harness,
  options: ExpeditionOptions = {},
): Promise<void> {
  openScene(h, options);
  clearSaveSlot(h);
  layCamp(h);
  standAtCamp(h, SPAWN_COL);
  await h.advance(1);
}

/**
 * Write the save through the control that stands for activating the Save Pad,
 * and confirm the slot took it.
 *
 * The confirmation is the arrangement's, not the verdict's: a check that goes on
 * to read what was restored needs to know a save was written at all, and saying
 * so here names the step that failed instead of leaving a later reading
 * unexplained.
 */
export function bankSave(h: Harness): void {
  h.debug.save();
  assertEqual(
    h.snapshot().hasSave,
    true,
    "specs/expedition.md: activating the Save Pad writes the save on the spot",
  );
}

/**
 * The menu the current screen lists, read the way a player reads it: step the
 * highlight down until it wraps, and report what each index was.
 *
 * The snapshot reports `menuIndex` but not the items, and specs/ui.md fixes both
 * the items and that movement wraps at the ends, so the length is where the
 * highlight comes back to `0`. `limit` bounds a build whose highlight never
 * wraps.
 */
export async function menuLength(h: Harness, limit = 12): Promise<number> {
  h.debug.setMenuIndex(0);
  for (let step = 1; step <= limit; step += 1) {
    await h.tap(ACTION_KEY.down);
    if (h.snapshot().menuIndex === 0) return step;
  }
  return limit + 1;
}

/* -------------------------------------------------------------------------- */
/* Driving a death                                                            */
/* -------------------------------------------------------------------------- */

/** The cell a death that has to happen underground is driven at. */
const DEATH_COL = 12;
const DEATH_ROW = 60;

/** The seconds a Core Sample's timer is wound down to before it is run out. */
const CORE_FUSE = 0.5;

/**
 * Bring one of the three deaths specs/modes.md names about, and run the game on
 * until the expedition has ended at the Game Over screen.
 *
 * NOTHING HERE POSES THE OUTCOME. Each cause is arranged as the condition the
 * specification states — an empty tank below the ground line, a hull standing at
 * `0`, a Core Sample's timer running out while it is carried — and the game's own
 * continuous check is what ends the expedition, exactly as
 * specs/instrumentation.md says of `setHull(0)`.
 *
 * The miner's body and drill are both gated, because no death here is about
 * either: what the gate leaves running is everything that matters, life support,
 * the hull check and the Sample's timer included.
 *
 * The wait afterwards is a sweep rather than a single frame. How long a build
 * plays a death out before it shows the summary is the build's, so this runs the
 * game on in whole seconds until the screen changes, up to a generous ceiling.
 */
export async function driveDeath(
  h: Harness,
  cause: DeathCause,
): Promise<DeepcoreSnapshot> {
  pinMiner(h);
  pinDrill(h);
  if (cause === "hull-destroyed") {
    h.debug.setHull(0);
  } else if (cause === "fuel-out") {
    h.debug.setMinerPosition(minerXOn(DEATH_COL), minerYOn(DEATH_ROW));
    h.debug.setMinerVelocity(0, 0);
    h.debug.setFuel(0);
  } else {
    h.debug.setCoreCarried(true);
    h.debug.setCoreTimer(CORE_FUSE);
  }
  return waitForGameOver(h);
}

/** Seconds of game time a death is given to play out before it counts as failed. */
const DEATH_CEILING = 8;

/** Run the game on until it reaches the Game Over screen, and say so if it never does. */
export async function waitForGameOver(h: Harness): Promise<DeepcoreSnapshot> {
  let snapshot = h.snapshot();
  for (let second = 0; second < DEATH_CEILING; second += 1) {
    if (snapshot.screen === "game-over") return snapshot;
    await h.advanceSeconds(1, 8);
    snapshot = h.snapshot();
  }
  assertEqual(
    snapshot.screen,
    "game-over",
    `specs/modes.md: a death ends the expedition at the Game Over screen, within ${DEATH_CEILING}s`,
  );
  return snapshot;
}

/* -------------------------------------------------------------------------- */
/* Driving a victory                                                          */
/* -------------------------------------------------------------------------- */

/** Seconds of game time the lift-off is given to reach the Victory screen. */
const LAUNCH_CEILING = 12;

/**
 * Win the expedition, and run the game on until it has reached the Victory
 * screen.
 *
 * NOTHING HERE POSES THE OUTCOME. The five components are installed through
 * `setRocketInstalled`, which specs/instrumentation.md says costs no Credits and
 * consumes no material, the launch is the control that stands for the Launch
 * Pad's, and the game's own lift-off is what carries the expedition to the
 * screen — specs/rocket.md: "Launching is the only way to win", and it "takes the
 * game to the Victory screen".
 *
 * The miner's body and drill are both gated, because a launch exercises neither.
 *
 * The wait afterwards is a sweep rather than a single frame. How long a build
 * plays the lift-off out before it shows the screen is the build's, so this runs
 * the game on in whole seconds until the screen changes, up to a generous
 * ceiling, and says so where it never arrives.
 */
export async function driveVictory(
  h: Harness,
  options: ExpeditionOptions = {},
): Promise<DeepcoreSnapshot> {
  openScene(h, options);
  pinMiner(h);
  pinDrill(h);
  h.debug.setRocketInstalled(ROCKET_COMPONENTS.length);
  h.debug.launch();

  let won = h.snapshot();
  for (let second = 0; second < LAUNCH_CEILING; second += 1) {
    if (won.screen === "victory") return won;
    await h.advanceSeconds(1, 8);
    won = h.snapshot();
  }
  assertEqual(
    won.screen,
    "victory",
    `specs/rocket.md: a launch takes the game to the Victory screen, within ${LAUNCH_CEILING}s`,
  );
  return won;
}

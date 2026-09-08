// Deepcore — the openings the save, mode and world-size checks share.
// CASE-PROVIDED.
//
// Not a `.test.ts`, so vitest never collects it. Everything here is built from
// the atomic operations `specs/instrumentation.md` fixes, exactly as the shared
// harness's own sequences are; it lives here rather than in `harness.ts` because
// only the three categories that turn on persistence need it.
//
// TWO THINGS ARE WORTH SAYING ABOUT REACHING A SAVE.
//
// The slot outlives the page. `reset()` deliberately leaves it alone, because it
// outlives the session, so a check whose subject is the save clears it itself
// rather than assuming it opened empty.
//
// Restoring is a MENU action and there is no operation for it. specs/ui.md fixes
// `CONTINUE` as the title menu's first item while a save exists, so
// `continueFromTitle` selects index 0 and confirms. That is the one place these
// checks reach the game through a menu, because the specification puts the
// restore behind one; every other route here is a control or a pose.

import { assertEqual } from "../assert";
import { ROCKET_COMPONENTS, SPAWN_COL } from "../constants";
import {
  ACTION_KEY,
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
  await openScene(h, options);
  await h.debug.clearSave();
  await layCamp(h);
  await standAtCamp(h, SPAWN_COL);
  await h.advance(1);
}

/**
 * Open an expedition on a GENERATED mine, standing at the camp, slot empty.
 *
 * The companion to {@link openAtCamp} for a check whose subject is what the save
 * carries of the world: a cleared mine would make "the same shafts already cut"
 * indistinguishable from a fresh one.
 */
export async function openGeneratedAtCamp(
  h: Harness,
  options: ExpeditionOptions = {},
): Promise<void> {
  await openScene(h, options);
  await h.debug.clearSave();
  await h.debug.generateMine();
  await standAtCamp(h, SPAWN_COL);
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
export async function bankSave(h: Harness): Promise<void> {
  await h.debug.save();
  assertEqual(
    (await h.snapshot()).hasSave,
    true,
    "specs/expedition.md: activating the Save Pad writes the save on the spot",
  );
}

/**
 * Take `CONTINUE` on the title menu, which specs/ui.md fixes as its first item
 * while a save exists.
 */
export async function continueFromTitle(h: Harness): Promise<void> {
  await h.debug.setScreen("title");
  await h.debug.setMenuIndex(0);
  await h.tap(ACTION_KEY.activate);
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
  await h.debug.setMenuIndex(0);
  for (let step = 1; step <= limit; step += 1) {
    await h.tap(ACTION_KEY.down);
    if ((await h.snapshot()).menuIndex === 0) return step;
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
  await pinMiner(h);
  await pinDrill(h);
  if (cause === "hull-destroyed") {
    await h.debug.setHull(0);
  } else if (cause === "fuel-out") {
    await h.debug.setMinerPosition(minerXOn(DEATH_COL), minerYOn(DEATH_ROW));
    await h.debug.setMinerVelocity(0, 0);
    await h.debug.setFuel(0);
  } else {
    await h.debug.setCoreCarried(true);
    await h.debug.setCoreTimer(CORE_FUSE);
  }
  await h.debug.reconcile();
  return waitForGameOver(h);
}

/** Seconds of game time a death is given to play out before it counts as failed. */
const DEATH_CEILING = 8;

/** Run the game on until it reaches the Game Over screen, and say so if it never does. */
export async function waitForGameOver(h: Harness): Promise<DeepcoreSnapshot> {
  let snapshot = await h.snapshot();
  for (let second = 0; second < DEATH_CEILING; second += 1) {
    if (snapshot.screen === "game-over") return snapshot;
    await h.advanceSeconds(1, 8);
    snapshot = await h.snapshot();
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
  await openScene(h, options);
  await pinMiner(h);
  await pinDrill(h);
  await h.debug.setRocketInstalled(ROCKET_COMPONENTS.length);
  await h.debug.launch();

  let won = await h.snapshot();
  for (let second = 0; second < LAUNCH_CEILING; second += 1) {
    if (won.screen === "victory") return won;
    await h.advanceSeconds(1, 8);
    won = await h.snapshot();
  }
  assertEqual(
    won.screen,
    "victory",
    `specs/rocket.md: a launch takes the game to the Victory screen, within ${LAUNCH_CEILING}s`,
  );
  return won;
}

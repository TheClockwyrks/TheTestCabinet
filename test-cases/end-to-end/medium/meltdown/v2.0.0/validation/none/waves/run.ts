// waves/run — how this group reaches the transitions its points are about, and
// nothing about what any of them must read. CASE-PROVIDED.
//
// `specs/waves.md` states the frame around a match as a set of TRANSITIONS
// rather than as a set of fields: a wave clears "on the frame in which its last
// live unit dies or leaks with none of it left to release", a build timer
// "reaching `0` starts the wave", lives "reaching `0` ends the run at once", and
// a send "begins Wave 1". None of them can be posed —
// `specs/instrumentation.md` says in as many words that `setScreen` and
// `setPhase` "set that field alone and run no entry effect", that `setLives`
// "triggers no game over", and that `setWave` "rebuilds nothing, releases
// nothing, and clears nothing" — so each one is REACHED the way the run reaches
// it, and the four arrangements that reach them live here.
//
// THIS FILE FIXES ARRANGEMENT ALONE. Not one figure a point asserts and not one
// tolerance is decided here. In particular the four figures the clock rule's
// points are measured with — the length of a window, how far a running Mote must
// travel, how far a paused one may drift, and how much the simulated clock may
// gain while paused — are stated in each of those points, because they are that
// point's own claim about the build and not a shared setting.
//
// LOCAL TO THIS GROUP ON PURPOSE. Nothing outside `waves/` reaches a phase
// transition to grade the transition itself; the groups that need a live run
// pose one with `startRun` and leave the phase where it stands.

import {
  COLS,
  DIFFICULTIES,
  RIGHT_EXHAUST_ROWS,
  tileCX,
  tileCY,
  type DifficultyId,
  type SurgeType,
} from "../constants";
import { FREE_SITE } from "../fixtures";
import {
  framesFor,
  posePinnedTower,
  poseTarget,
  poseWalker,
  tapAction,
  type Harness,
} from "../harness";

/* ---- The opening phase ---------------------------------------------------- */

/**
 * A live run standing in its untimed opening phase, with the run's own release
 * of surge ON.
 *
 * `reset` is what puts the phase there rather than `setPhase`, and that matters:
 * `specs/instrumentation.md` has `reset` restore `phase` to `"opening"`,
 * `buildTimer` to `0`, `wave` to `1` and the world gate `waveSpawning` back on,
 * and it is those RESTORED values the opening-phase points read. Only the screen
 * is moved afterwards, so the floor is the one a run opens on.
 *
 * THE GATE IS LEFT ON, which is the opposite of what `startRun` does and is the
 * whole point of these scenarios: the opening phase's claim is that it starts no
 * wave OF ITS OWN, and a scenario that had shut the run's own spawner off would
 * be reading a gate it closed itself. Both rosters are emptied so nothing but the
 * run's own release can put a unit on the floor.
 */
export async function poseOpening(h: Harness): Promise<void> {
  const { debug } = h;
  await debug.reset();
  await debug.clearTowers();
  await debug.clearSurge();
  await debug.setScreen("playing");
}

/**
 * Reach a run the way a player reaches one: the title menu, the mode list, then
 * the difficulty list.
 *
 * `specs/screens.md` routes `PLAY` to `modeselect`, `CONTAINMENT` to
 * `difficultyselect`, and a confirmed difficulty row to "`playing` in the
 * `opening` phase, on Containment at that difficulty". The run's own entry
 * effects therefore all run, which is exactly what a point about what a STARTED
 * run holds needs and what `setScreen` cannot give it.
 *
 * The highlight is posed with `setMenuIndex` before each confirm — a pose of that
 * one field (`specs/instrumentation.md`) — so the row taken is the row this
 * scenario names rather than wherever a build happened to leave the highlight.
 * Which row each menu opens on is `screens.*`'s business, not this group's.
 */
export async function startThroughMenus(
  h: Harness,
  difficulty: DifficultyId,
): Promise<void> {
  const { debug } = h;
  await debug.reset();
  await debug.setScreen("title");
  // PLAY, the first row of TITLE_ITEMS.
  await debug.setMenuIndex(0);
  await tapAction(h, "confirm");
  // CONTAINMENT, the first row of MODE_ITEMS.
  await debug.setMenuIndex(0);
  await tapAction(h, "confirm");
  // The difficulty's own row of DIFFICULTY_ITEMS, in the order of DIFFICULTIES.
  await debug.setMenuIndex(DIFFICULTIES.indexOf(difficulty));
  await tapAction(h, "confirm");
}

/* ---- The wave phase ------------------------------------------------------- */

/**
 * Pose the end of wave `wave`: the wave phase, on that wave, with nothing left
 * to release.
 *
 * The shape every clear in this group is reached from. `specs/waves.md` clears a
 * wave on the frame its last live unit goes "with none of it left to release",
 * so `wavePending` is `0` and the one unit the caller poses is the wave's last.
 * The phase is posed rather than reached because `setPhase` runs no entry
 * effect: it is the precondition, and the CLEAR is what the drive then reaches
 * through the game's own transition.
 *
 * It poses no unit. A caller adds exactly the one whose going clears the wave.
 */
export async function poseWaveEnd(h: Harness, wave: number): Promise<void> {
  await h.debug.setWave(wave);
  await h.debug.setPhase("wave");
  await h.debug.setWavePending(0);
}

/**
 * Pose a wave `wave` still mid-release: the wave phase, with `pending` units of
 * it yet to come.
 *
 * The companion to {@link poseWaveEnd}, for the one point whose event must NOT
 * clear a wave. `specs/waves.md` clears a wave only "with none of it left to
 * release", so a phase left holding units cannot clear however its live ones go,
 * and whatever the drive then reaches is the mid-wave event alone. The world gate
 * `startRun` shut stays shut, so those pending units never actually arrive.
 */
export async function poseMidWave(
  h: Harness,
  wave: number,
  pending: number,
): Promise<void> {
  await h.debug.setWave(wave);
  await h.debug.setPhase("wave");
  await h.debug.setWavePending(pending);
}

/**
 * A live run standing in a wave phase with nothing left to release.
 *
 * The frame every point governed by the clock rule watches its subject inside.
 * `wave` is the phase a run has surge and firing towers on the floor in, and
 * `wavePending` at `0` with the world gate `startRun` shut means nothing arrives
 * during a window and nothing this check did not pose is moving. It is safe to
 * leave standing however long a window runs, because `specs/waves.md` clears a
 * wave only when its last LIVE unit goes and "A phase that has released no unit
 * never clears".
 */
export async function poseWavePhase(h: Harness): Promise<void> {
  await h.debug.setPhase("wave");
  await h.debug.setWavePending(0);
}

/**
 * A live run standing in a wave phase with one Mote walking under its own power
 * from the left vent, and that Mote's id.
 *
 * What every point governed by the clock rule watches. The phase is `wave`
 * because that is the phase a run has surge on the floor in, and `wavePending`
 * is `0` with the world gate shut, so the Mote is the only thing moving and
 * nothing else arrives to move beside it. Nothing about the unit is posed beyond
 * its entry: its motion is on and its route is the game's own, so what a window
 * measures is the floor advancing rather than a position this scenario wrote.
 *
 * The Mote enters at the left vent and walks the left corridor, which is
 * forty-nine tiles long (`specs/floor.md`), so several seconds of watching never
 * carries it as far as its exhaust and no leak interrupts a reading.
 */
export async function poseRunningFloor(h: Harness): Promise<number> {
  await poseWavePhase(h);
  return poseWalker(h, "mote", "left");
}

/* ---- The leak ------------------------------------------------------------- */

/**
 * The tile a leaker is posed on: one tile short of the right exhaust, on a row
 * the opening covers.
 *
 * `specs/floor.md` puts the right exhaust on tiles `(49, 16)` through
 * `(49, 19)`, and a unit entering at the left vent is assigned the right exhaust
 * for its whole life. So a walker posed here has one tile left to travel and
 * reaches its exhaust in a fraction of a second, which keeps a point about a
 * TRANSITION from spending game time on a walk across the floor that
 * `specs/mazing.md` already decides.
 */
export const LEAK_TILE = {
  col: COLS - 2,
  row: RIGHT_EXHAUST_ROWS[1],
} as const;

/**
 * How long a leak is waited for: three seconds of game time.
 *
 * Geometry rather than a tolerance — it says how long the drive runs, not how
 * far a build may miss a figure by. A Mote's specified `60` logical units per
 * second covers the one `TILE` (`19`) it has left in about a third of a second,
 * so three seconds carries a build walking at a ninth of that speed out through
 * the opening, and every transition this group reaches by a leak rests on the
 * unit arriving at its exhaust rather than on how fast it got there.
 */
export const LEAK_FRAMES = framesFor(3);

/**
 * A Mote walking under its own power with one tile left to its exhaust, and its
 * id.
 *
 * Nothing is posed beyond the entry and the position: its motion is on, and its
 * route is recomputed from the tile the position falls in
 * (`specs/instrumentation.md`), so the walk out through the opening is the
 * game's own.
 */
export async function poseLeaker(h: Harness): Promise<number> {
  const id = await poseWalker(h, "mote", "left");
  await h.debug.setUnitPosition(
    id,
    tileCX(LEAK_TILE.col),
    tileCY(LEAK_TILE.row),
  );
  return id;
}

/**
 * Run until the floor is empty of surge, and say whether it emptied.
 *
 * The caller reads its own figure across this drive. Whether the floor emptied is
 * handed back so a point can state, as its precondition, that the event it is
 * about actually happened rather than asserting a transition off a unit that
 * never went anywhere.
 */
export async function runUntilGone(
  h: Harness,
  maxFrames: number,
): Promise<boolean> {
  const swept = await h.until((snapshot) => snapshot.surge.length === 0, {
    maxFrames,
    poll: 2,
  });
  return swept.hit;
}

/** {@link runUntilGone} over {@link LEAK_FRAMES}: the drive a posed leak needs. */
export function runUntilLeaked(h: Harness): Promise<boolean> {
  return runUntilGone(h, LEAK_FRAMES);
}

/* ---- The kill ------------------------------------------------------------- */

/** The gun's footprint anchor: a quiet site, clear of every opening and corridor. */
export const GUN = FREE_SITE;

/**
 * The tile the mark stands on: three tiles right of the gun's anchor, so it is
 * off the footprint and comfortably inside the Arc's `6.0`-tile range measured
 * from the footprint's centre (`specs/combat.md`).
 */
export const MARK = { col: GUN.col + 3, row: GUN.row } as const;

/**
 * How long a kill is waited for: six seconds of game time.
 *
 * Geometry rather than a tolerance. An Arc at its specified `2.0` shots per
 * second lands its first shot half a second in (`specs/combat.md`), so six
 * seconds is a dozen intervals: a build whose fire rate or per-shot damage is off
 * still removes a single hp inside the window, and the death this group reaches
 * therefore rests on a shot landing at all rather than on how hard or how often
 * it lands.
 */
export const KILL_FRAMES = framesFor(6);

/**
 * An Arc at {@link GUN} firing on a one-hp `type` at {@link MARK}, ready to kill
 * it, and the mark's id.
 *
 * The arrangement for the two points whose transition must be reached by a DEATH
 * rather than by a leak. `posePinnedTower` holds the tower's part in the heat
 * model (`specs/instrumentation.md`) so no trip can interrupt the drive, and
 * `poseTarget` holds the mark's motion so it cannot walk out of range or reach an
 * exhaust and leak instead — which would be a different transition paying
 * different figures. One hp is what makes the death follow from a shot landing
 * rather than from any figure `specs/combat.md` gives the shot.
 */
export async function poseKill(
  h: Harness,
  type: SurgeType = "mote",
): Promise<number> {
  await posePinnedTower(h, "arc", GUN.col, GUN.row, 0);
  return poseTarget(h, type, MARK.col, MARK.row, 1);
}

/** {@link runUntilGone} over {@link KILL_FRAMES}: the drive a posed kill needs. */
export function runUntilKilled(h: Harness): Promise<boolean> {
  return runUntilGone(h, KILL_FRAMES);
}

// modes/run — how this group poses a mode, draws the opening it derives, and
// reaches the two transitions a mode changes.
//
// THIS FILE FIXES ARRANGEMENT ALONE. Not one figure a point asserts and not one
// tolerance is decided here; every point states its own beside the figure
// specs/modes.md fixes for it. What lives here is the posing every point in the
// group would otherwise write out again.
//
// WHY THE OPENING IS DRAWN FROM THE BUILD'S OWN FIGURES. Most points in this
// group read numbers rather than motion, and each declares a STILL as its output.
// The shared `startRun` poses the money and the lives from the case's own copy of
// specs/modes.md's table, which is right for a scenario standing on a run — but it
// would put the CASE's number on the HUD in a picture whose whole job is to show
// what the BUILD derived. {@link drawOpening} poses the opening from
// `snapshot().startMoney` and `snapshot().startLives` instead, so the picture a
// reviewer opens is the build's own answer and the assertions beside it are what
// say whether that answer is right.
//
// WHY A LEAK IS THIS GROUP'S CLEAR. specs/waves.md clears a wave "on the frame in
// which its last live unit dies or leaks with none of it left to release", so
// either event reaches the transition, and a leak needs no tower, no target and no
// combat — one walker with one tile left to travel. Two points here are about what
// a mode does when a run ENDS, and `setScreen` and `setPhase` run no entry effect
// (specs/instrumentation.md), so the ending has to be reached the way the run
// reaches it.
//
// Local to this group on purpose. The `economy` group reaches the same events for
// figures of its own and keeps its arrangements in `economy/payment.ts`; nothing
// here belongs in the shared harness.

import {
  BINDINGS,
  COLS,
  HUNDRED_UNITS,
  RIGHT_EXHAUST_ROWS,
  WAVE_SPAWN_INTERVAL,
} from "../constants";
import { tileCentre } from "../geometry";
import {
  createHarness,
  poseWalker,
  startRun,
  ticksFor,
  type DifficultyName,
  type Harness,
  type ModeName,
  type SurgeType,
} from "../harness";
import { ConstantClock } from "@clockwyrks/simple-2d";

/* ---- Posing a mode ------------------------------------------------------- */

/**
 * Pose a mode and a difficulty on a game reset to its title values, and NOTHING
 * else.
 *
 * The whole arrangement the derived-figure points stand on. specs/modes.md has
 * starting money, the wave count, the starting lives, whether interest is paid
 * and the build zone "follow the mode and difficulty and nothing else", and
 * specs/instrumentation.md says `setMode` and `setDifficulty` "change no other
 * field" while the derived figures follow them. So a point that reads one of those
 * figures needs exactly these three operations: a build that derives them from
 * anything a scenario did earlier is caught by the reset, and a build that derives
 * them from the live run is caught by there being no live run at all.
 *
 * It runs no frame. A point advances the frames its own reading needs.
 */
export function poseMode(
  h: Harness,
  mode: ModeName,
  difficulty: DifficultyName = "medium",
): void {
  h.debug.reset();
  h.debug.setMode(mode);
  h.debug.setDifficulty(difficulty);
}

/**
 * Put the game on the opening of a run at the figures THE BUILD derived, and draw
 * one frame of it.
 *
 * specs/modes.md: "A run that has just started is in the `opening` phase on Wave
 * 1, with its money at that row's starting money and its lives at that row's
 * starting lives." This poses exactly that shape, taking the two figures from the
 * build's own `startMoney` and `startLives` rather than from the case's table, so
 * the still it leaves on the canvas is a picture of the build's answer. It asserts
 * nothing and it decides nothing: whether that answer is right is the reading each
 * point makes for itself, from the same snapshot, in its own terms.
 *
 * Call it after {@link poseMode} and before `captureStill`.
 */
export async function drawOpening(h: Harness): Promise<void> {
  const derived = h.snapshot();
  h.debug.setScreen("playing");
  h.debug.setPhase("opening");
  h.debug.setWave(1);
  h.debug.setBuildTimer(0);
  h.debug.setWavePending(0);
  h.debug.setWaveSpawning(false);
  h.debug.setMoney(derived.startMoney);
  h.debug.setLives(derived.startLives);
  await h.advance(1);
}

/* ---- The clear, reached by a leak ---------------------------------------- */

/**
 * The tile a leaker is posed on: one tile short of the right exhaust, on a row
 * the opening covers.
 *
 * specs/floor.md puts the right exhaust on tiles `(49, 16)` through `(49, 19)`,
 * and specs/mazing.md fixes a left-vent unit's exhaust as the right one for its
 * whole life. So a walker posed here has one tile left to travel and reaches its
 * exhaust in a fraction of a second, which keeps a point about what a mode does at
 * the end of a run from spending its window on a walk across the floor.
 */
export const LEAK_TILE = {
  col: COLS - 2,
  row: RIGHT_EXHAUST_ROWS[1],
} as const;

/**
 * How long a leak is waited for: three seconds of game time.
 *
 * Geometry rather than a tolerance — it says how long the drive runs, not how far
 * a build may miss a figure by. A Mote's specified `60` logical units per second
 * covers the one `TILE` (`19`) it has left in about a third of a second, so three
 * seconds carries a build walking at a ninth of that speed out through the
 * opening, and what these points read rests on the unit reaching its exhaust
 * rather than on how fast it got there.
 */
export const LEAK_TICKS = ticksFor(3);

/**
 * A Mote walking under its own power with one tile left to its exhaust, and its
 * id.
 *
 * Nothing is posed beyond the entry and the position: its motion is on, and its
 * route is recomputed from the tile the position falls in
 * (specs/instrumentation.md), so the walk out is the game's own. The Mote is the
 * type every mode's ordinary surge is built from and the one specs/surge.md gives
 * a leak value of `1`.
 */
export function poseLeaker(h: Harness): number {
  const id = poseWalker(h, "mote", "left");
  const at = tileCentre(LEAK_TILE.col, LEAK_TILE.row);
  h.debug.setUnitPosition(id, at.x, at.y);
  return id;
}

/** Run until the floor is empty of surge, and say whether it emptied. */
export async function runUntilLeaked(h: Harness): Promise<boolean> {
  const swept = await h.until((snapshot) => snapshot.surge.length === 0, {
    maxFrames: LEAK_TICKS,
    poll: 2,
  });
  return swept.hit;
}

/**
 * Pose the end of wave `wave`: the wave phase, on that wave, with nothing left to
 * release.
 *
 * The shape a clear is reached from. specs/waves.md clears a wave on the frame its
 * last live unit goes "with none of it left to release", so `wavePending` is `0`
 * and the one unit the caller poses is the wave's last. The phase is posed rather
 * than reached because `setPhase` runs no entry effect: it is the precondition,
 * and the CLEAR is what the drive then reaches through the game's own transition.
 *
 * THE BUILD COUNTDOWN IS POSED AT ZERO, and that is load-bearing rather than tidy.
 * specs/waves.md gives a countdown to the `building` phase alone — a wave phase has
 * none, and the opening phase "reports a `buildTimer` of `0`" — while `startRun`
 * leaves the fifteen seconds of the between-wave phase it poses standing. A point
 * that read the timer after the clear would then be reading the figure its own
 * arrangement had put there, whatever the build did. Posed at `0`, a countdown found
 * running afterwards is one the build itself started.
 *
 * It poses no unit. A caller adds exactly the one whose going clears the wave.
 */
export function poseWaveEnd(h: Harness, wave: number): void {
  h.debug.setWave(wave);
  h.debug.setPhase("wave");
  h.debug.setWavePending(0);
  h.debug.setBuildTimer(0);
}

/* ---- The Hundred's onslaught --------------------------------------------- */

/**
 * How long the onslaught is watched for: seventy seconds of game time.
 *
 * Geometry, not a tolerance. specs/modes.md releases the onslaught's
 * `HUNDRED_UNITS` (`100`) units "at the same `WAVE_SPAWN_INTERVAL` cadence every
 * wave uses" and specs/waves.md releases "the first on the frame the wave begins",
 * so the hundredth is due `99 * 0.6` = `59.4` seconds in. Seventy leaves better
 * than ten further seconds — more than seventeen further intervals — so a build
 * that would release a hundred-and-first has ample room to do it inside the
 * window, and a build releasing at a slower cadence than the specification's still
 * gets its whole hundred out.
 */
export const ONSLAUGHT_SECONDS = 70;

/**
 * The clock the onslaught is watched on, in frames per second.
 *
 * COARSER THAN THE SUITE'S `120`, AND THE REASON IS COST RATHER THAN
 * MEASUREMENT. The specification "deliberately fixes no timestep ... an interval
 * of game time reaches the same state however it was divided into frames"
 * (specs/waves.md), and `instrumentation.render-free-core` is the point that
 * grades that claim, so a scenario is free to choose how finely it dices the game
 * time it needs. What this one needs is seventy seconds OF GAME TIME, which at the
 * suite's clock is eight thousand four hundred frames, each of them a full update
 * and a full render of a floor carrying a hundred units — twenty-five seconds of
 * one core on an idle machine, and four minutes of wall clock on a runner sharing
 * twenty cores between two hundred tasks, against a per-check ceiling. None of
 * that arithmetic is anything the point asserts.
 *
 * `1/30` of a second still puts eighteen frames inside one `WAVE_SPAWN_INTERVAL`
 * (`0.6` s), so the release cadence this point counts is resolved eighteen times
 * over, and it is the same clock the structured-2d copy of this point has always
 * used. Nothing read here has a finer resolution than that: a unit is counted from
 * the roster it appears in, not from the frame it appeared on.
 */
export const ONSLAUGHT_HZ = 30;

/** Frames of {@link ONSLAUGHT_HZ} covering `duration` seconds of game time. */
export function onslaughtFrames(duration: number): number {
  return Math.ceil(duration * ONSLAUGHT_HZ);
}

/** A harness whose clock is {@link ONSLAUGHT_HZ}, for the two onslaught points. */
export function createOnslaughtHarness(): Promise<Harness> {
  return createHarness({ clock: new ConstantClock(1000 / ONSLAUGHT_HZ) });
}

export const ONSLAUGHT_TICKS = onslaughtFrames(ONSLAUGHT_SECONDS);

/** The interval the release is paced at, for a failure that names it. */
export const RELEASE_INTERVAL = WAVE_SPAWN_INTERVAL;

/** The units the onslaught is specified to release (`HUNDRED_UNITS`). */
export const ONSLAUGHT_UNITS = HUNDRED_UNITS;

/**
 * How often the onslaught is sampled: every other frame.
 *
 * Geometry rather than a tolerance. specs/modes.md paces the release at
 * `WAVE_SPAWN_INTERVAL` (`0.6`) seconds, which is eighteen frames of this
 * scenario's {@link ONSLAUGHT_HZ} clock, so a sample every other frame falls
 * between two releases nine times over and cannot land on a release and a phase
 * change at once. Nothing can be MISSED at any spacing: a unit held where it
 * arrived never leaves the roster, so a sample sees every unit released before it,
 * however many frames ago. What the spacing costs is only how promptly a unit is
 * held — at most two frames, a fifteenth of a second, in which a Mote covers four
 * logical units.
 */
export const SAMPLE_EVERY = 2;

/** One unit of the onslaught, as it read on the frame it first appeared. */
export interface Released {
  id: number;
  type: SurgeType;
  maxHp: number;
}

/** What watching the onslaught found. */
export interface Onslaught {
  /** Every unit that appeared, in the order it appeared. */
  released: Released[];
  /** Whether the phase stayed `wave` on wave 1 for the whole window. */
  oneContinuousWave: boolean;
}

/**
 * Begin The Hundred's onslaught through the game's own send, on an empty floor.
 *
 * `startRun` leaves a quiet floor with the run's own release of surge held; the
 * opening phase is posed over it because specs/modes.md gives The Hundred "one
 * untimed opening phase and no build phase between waves", and the gate is then
 * OPENED because the spawner's release of `wavePending` is the very thing these
 * two points are about — the one exception specs/instrumentation.md's gate carries.
 *
 * The wave is begun by pressing the key specs/controls.md binds `send` to, because
 * the debug surface carries no operation that sends: sending "begins Wave 1 from
 * the opening phase", and specs/waves.md has the release start on that frame.
 */
export async function beginOnslaught(h: Harness): Promise<void> {
  startRun(h, "hundred");
  h.debug.setPhase("opening");
  h.debug.setBuildTimer(0);
  h.debug.setWaveSpawning(true);
  await h.tap(BINDINGS.send[0]);
}

/**
 * Watch the onslaught for `ticks` frames, noting every unit as it arrives and
 * HOLDING IT WHERE IT ARRIVED.
 *
 * THE FREEZE IS THE ISOLATION, and it is what makes the reading possible at all.
 * These two points are about what the SPAWNER does — how many units it releases,
 * and the hp each carries — so a unit's walk, its leak and the life that leak costs
 * are faculties the requirement does not exercise (specs/instrumentation.md gates
 * locomotion for exactly this). Left walking, the first units reach their exhausts
 * around fifteen seconds in and leak: twenty of them take The Hundred's twenty
 * lives to `0`, the run ends part-way through the release, and the spawner stops
 * with the question unanswered. Held where they arrive, nothing leaves the floor
 * and nothing ends the run, so the roster at the end of the window IS the count
 * released.
 *
 * Nothing else about a unit is touched: its type and its `maxHp` are read on the
 * sample that first sees it, before the hold, and they are the spawner's own.
 */
export async function watchOnslaught(
  h: Harness,
  ticks: number,
): Promise<Onslaught> {
  const released: Released[] = [];
  const held = new Set<number>();
  let oneContinuousWave = true;
  for (let frame = 0; frame < ticks; frame += SAMPLE_EVERY) {
    await h.advance(SAMPLE_EVERY);
    const snapshot = h.snapshot();
    if (snapshot.phase !== "wave" || snapshot.wave !== 1) {
      oneContinuousWave = false;
    }
    for (const unit of snapshot.surge) {
      if (held.has(unit.id)) continue;
      held.add(unit.id);
      released.push({ id: unit.id, type: unit.type, maxHp: unit.maxHp });
      h.debug.setUnitMotion(unit.id, false);
    }
  }
  return { released, oneContinuousWave };
}

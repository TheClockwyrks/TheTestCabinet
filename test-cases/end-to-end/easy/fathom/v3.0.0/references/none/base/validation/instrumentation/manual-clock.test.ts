// instrumentation/manual-clock — the game holds still on the driver's clock, and
// a step of `n` ticks is worth exactly `n` ticks however it is spent.
//
// `specs/instrumentation.md` puts both halves of the deterministic core on the
// clock. `setAutoStep(false)` "stops the frame loop advancing the simulation from
// the wall clock, so the game changes only when `advance` says so", and
// `advance(ticks)` "runs `ticks` whole simulation ticks immediately and in order,
// each worth exactly one `TICK_DT`. The unit is ticks rather than seconds, so
// nothing is rounded: `advance(1)` runs one tick and `advance(120)` covers one
// second of game time."
//
// WHY THIS IS WORTH ITS OWN POINT. Nothing else in this suite can report it.
// Every other check poses a scenario and then measures it, and a build that keeps
// running through the pose simply arrives at the measurement in a different world
// than the one the check set up — so the point that fails is whichever one
// happened to be posed on something that moved. A run failed two movement points
// because the forager had swum off the tile with the opening in it, and an audio
// point because the pellet under the forager had been eaten, cue and all, before
// the window opened. Not one of the three is about the clock. This is where that
// defect belongs.
//
// THE WITNESS IS A PREDATOR, NOT THE FORAGER. A forager with no key held rests
// under either reading of `specs/movement.md`, so it would sit still whether or
// not the clock were running and prove nothing. A released predator patrols on
// the game's own clock whatever the player does (`specs/predators.md`), so it is
// what a still-running clock would visibly carry across its corridor. That it can
// move at all is checked FIRST, over a stretch this check itself steps, so a
// build whose predators never move fails this point instead of passing it on
// nothing.
//
// AND THE WITNESS IS OUT OF REACH BY ARITHMETIC, NOT BY ROCK. A hunter contained
// by a wall is only contained while the build's own movement rule holds, and a
// build that walked a body through rock would end this scenario with a life lost
// and report a movement defect under a heading about the clock. So the witness is
// posed a distance away that no body could cross in the time this check ever runs
// the game for: {@link REACH_TICKS} ticks buys {@link MAX_REACH} units even at
// `GLOAMFIN_CHASE_SPEED` (`134`), the fastest figure `specs/predators.md` gives
// anything, and the separation the fixture poses is read back off the snapshot and
// held above it. It is past `GLOAMFIN_HEAR` (`64`, 2 tiles) many times over, so
// the witness never takes a close-hearing fix at all, and its own ping floods
// corridors that do not reach the forager.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLessThanOrEqual } from "../assert";
import {
  BRIGHT_HOLD,
  GLOAMFIN_CHASE_SPEED,
  TICK_DT,
  TICK_HZ,
} from "../constants";
import { poseMaze, spawnPredator } from "../fixtures";
import {
  captureReplay,
  createHarness,
  type Harness,
  startPlaying,
} from "../harness";
import {
  parkForager,
  requirePredatorMotion,
  requireSceneHeld,
  sceneGuard,
} from "../scene";

/**
 * The board: an eight-tile room for the forager, three rows of solid rock, and,
 * twenty tiles along, a twelve-tile corridor for the patrolling witness.
 *
 * The two are disconnected, and the offset is what puts the witness out of reach
 * by arithmetic rather than by that rock: twenty tiles across and four rows down
 * is over six hundred logical units, several times {@link MAX_REACH}.
 */
const ART = [
  "F.......",
  "########",
  "########",
  "########",
  " ".repeat(20) + "P...........",
] as const;

/** The kind posed loose as the witness. */
const WITNESS = "gloamfin";

/** One second of real time with nothing stepping the game. */
const SETTLE_MS = 1000;

/**
 * The most simulation time that may accrue over that second, in seconds.
 *
 * Two ticks. A conforming build accrues exactly none — `setAutoStep(false)` gates
 * the frame loop's stepping (`specs/instrumentation.md`) — so this is not room
 * for a different reading of the rule. It is room for a single frame already in
 * flight when the flag went down. A build that ignores the flag reports about
 * `1.0` here.
 */
const MAX_DRIFT = 2 * TICK_DT;

/**
 * The furthest anything on the board may drift over that second, in logical
 * units.
 *
 * The slowest thing that moves under its own power is the drifter at
 * `DRIFTER_SPEED` (`64`) and the witness patrols at `PREDATOR_SPEED` (`116`), so
 * a running clock carries the slowest of them two tiles in a second. Four units
 * is an eighth of a tile: rounding, and nothing else.
 */
const MAX_TRAVEL = 4;

/** One second of game time, as `specs/instrumentation.md` counts it. */
const STEP_TICKS = TICK_HZ;

/** The same second, spent sixty steps at a time. */
const SPLIT_STEPS = 60;
const SPLIT_TICKS = STEP_TICKS / SPLIT_STEPS;

/**
 * How far a stepped span's simulation time may sit from the time those ticks are
 * worth, in seconds.
 *
 * One tick. `advance(ticks)` runs whole ticks "each worth exactly one `TICK_DT`",
 * so the exact answer is `ticks * TICK_DT` and this is the accumulation of a
 * double, not a tolerance on the rule.
 */
const STEP_EPS = TICK_DT;

/** Recorded ticks either side of the wait, so the clip opens and closes on it. */
const OPEN_TICKS = 24;

/**
 * Every tick this check ever puts through the game, stepped or not.
 *
 * The clip's two ends, the driver's own second, the same second spent sixty ways,
 * and the second of real time the wait covers — which a build that ignores the
 * flag would run for the whole of.
 */
const REACH_TICKS =
  2 * OPEN_TICKS +
  STEP_TICKS +
  SPLIT_STEPS * SPLIT_TICKS +
  (SETTLE_MS / 1000) * TICK_HZ;

/**
 * The furthest any body could travel across the whole run, in logical units.
 *
 * `GLOAMFIN_CHASE_SPEED` (`134`) is the fastest figure `specs/predators.md` gives
 * anything, so a body travelling flat out for every one of those ticks — through
 * rock, through the border, however a broken build routes it — covers this much
 * and no more. The separation the fixture poses is held above it below.
 */
const MAX_REACH = (GLOAMFIN_CHASE_SPEED * REACH_TICKS) / TICK_HZ;

/** The furthest anything on the board moved between two states, in logical units. */
function widestTravel(
  before: {
    forager: { x: number; y: number };
    predators: readonly { x: number; y: number }[];
  },
  after: {
    forager: { x: number; y: number };
    predators: readonly { x: number; y: number }[];
  },
): number {
  const from = [before.forager, ...before.predators];
  const to = [after.forager, ...after.predators];
  let worst = 0;
  for (let i = 0; i < from.length && i < to.length; i += 1) {
    worst = Math.max(
      worst,
      Math.hypot(to[i].x - from[i].x, to[i].y - from[i].y),
    );
  }
  return worst;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("advances only when the driver steps it, by exactly the ticks it is given", async () => {
  await startPlaying(h);
  // The operation under test. `createHarness` and `reset` both leave manual
  // stepping armed already, so on a conforming build this changes nothing; it is
  // here because the flag is what this point is about and the call is the
  // documented way to set it.
  await h.debug.setAutoStep(false);

  const board = await poseMaze(h, ART);
  const home = board.mark("F");
  const beat = board.mark("P");
  await parkForager(h, home);
  // Full glow, so the clip is a lit room a reviewer can compare frame to frame
  // rather than a black rectangle.
  await h.debug.setBrightness(1);
  await h.debug.setBrightHold(BRIGHT_HOLD);

  // One hunter, loose and patrolling: something on the board that MOVES when the
  // game is stepped, so "nothing advanced" is a reading rather than a picture of
  // an empty room.
  const witness = await spawnPredator(h, WITNESS, beat, { state: "wander" });
  const guard = await sceneGuard(h, { foragerParked: false });

  // The fixture's own geometry: far enough that no body travelling flat out for
  // every tick this check runs could reach the forager, so nothing here rests on
  // the rock between them holding.
  const posed = await h.snapshot();
  assertGreaterThan(
    Math.hypot(
      posed.predators[witness].x - posed.forager.x,
      posed.predators[witness].y - posed.forager.y,
    ),
    MAX_REACH,
    `the units between the witness and the forager, against the ` +
      `${MAX_REACH.toFixed(0)} a body could cover over the ${REACH_TICKS} ticks ` +
      `this check runs at GLOAMFIN_CHASE_SPEED (${GLOAMFIN_CHASE_SPEED})`,
  );

  const run = await captureReplay(h, "held", async () => {
    // The clip opens on the posed room, before the wait.
    await h.advance(OPEN_TICKS);

    const before = await h.snapshot();
    // The measurement: real wall-clock time, with nothing stepping the build.
    // The page is brought forward first, because this is the one reading in the
    // suite that turns on real elapsed time: a browser that throttled a
    // background page would slow the very frame loop a defect here shows up in,
    // and quietly turn a build that ignores the flag into a passing one.
    await h.page.bringToFront().catch(() => undefined);
    await h.page.waitForTimeout(SETTLE_MS);
    const after = await h.snapshot();

    // And closes on it, so the two halves of the clip are the same picture.
    await h.advance(OPEN_TICKS);

    // Now the driver's own step, and the same second spent sixty ways.
    const stepFrom = await h.snapshot();
    await h.advance(STEP_TICKS);
    const stepTo = await h.snapshot();

    const splitFrom = await h.snapshot();
    for (let i = 0; i < SPLIT_STEPS; i += 1) await h.advance(SPLIT_TICKS);
    const splitTo = await h.snapshot();

    return { before, after, stepFrom, stepTo, splitFrom, splitTo };
  });

  requireSceneHeld(await h.snapshot(), guard);

  // The witness has to be able to move for "nothing moved" to mean anything.
  requirePredatorMotion(
    run.stepFrom,
    run.stepTo,
    witness,
    "patrol over a second the driver stepped, which is what makes " +
      "'nothing moved while real time passed' a reading rather than a tautology",
  );

  assertLessThanOrEqual(
    run.after.simTime - run.before.simTime,
    MAX_DRIFT,
    `seconds of simulation time accrued over ${SETTLE_MS} ms of real time with ` +
      `nothing stepping the game`,
  );
  assertLessThanOrEqual(
    widestTravel(run.before, run.after),
    MAX_TRAVEL,
    `the furthest the forager or any predator drifted, in logical units, over ` +
      `that same second — so the clock was held rather than a counter stalled`,
  );

  const stepped = run.stepTo.simTime - run.stepFrom.simTime;
  assertLessThanOrEqual(
    Math.abs(stepped - STEP_TICKS * TICK_DT),
    STEP_EPS,
    `how far simTime moved from the ${STEP_TICKS * TICK_DT} s that ` +
      `advance(${STEP_TICKS}) is worth`,
  );

  const split = run.splitTo.simTime - run.splitFrom.simTime;
  assertLessThanOrEqual(
    Math.abs(split - stepped),
    STEP_EPS,
    `how far the same second differs when it is covered as ${SPLIT_STEPS} ` +
      `steps of ${SPLIT_TICKS} ticks instead of one step of ${STEP_TICKS}`,
  );
});

// instrumentation/manual-clock — the game holds still on the driver's clock, and
// a step of `n` ticks is worth exactly `n` ticks however it is spent.
//
// specs/instrumentation.md rests the surface on a deterministic core: "Game state
// advances from the elapsed time the game is handed, independent of a canvas, of
// the frame loop that measured it, and of wall-clock time", and specs/movement.md
// fixes the step at `TICK_DT` with `TICK_HZ` (`120`) of them a second. Under this
// engine the clock is the harness's own `ConstantClock` and the engine advances
// only when `advance` says so, so both halves of that core are readable here:
// real time passing changes nothing, and a counted run of frames moves `simTime`
// by exactly what those frames are worth.
//
// WHY THIS IS WORTH ITS OWN POINT. Nothing else in this suite can report it.
// Every other check poses a scenario and then measures it, and a build that keeps
// running through the pose simply arrives at the measurement in a different world
// than the one the check set up — so the point that fails is whichever one
// happened to be posed on something that moved. A build that kept a timer of its
// own, or that read the wall clock instead of the delta it is handed, fails here
// and nowhere else that names the cause.
//
// THE WITNESS IS A BONUS DRIFTER, AND THE BOARD CARRIES NO PREDATOR AT ALL. A
// forager with no action held rests under either reading of specs/movement.md, so
// it would sit still whether or not something else were driving the game and
// prove nothing; something has to be moving under its own power. A drifter is the
// narrowest thing that is. specs/gameplay.md has one wander the corridors at
// `DRIFTER_SPEED` on the game's own clock whatever the player does, and it senses
// nothing, chases nothing and takes no life — so nothing about this scenario can
// end except by the clock being stepped. A hunter would have brought its senses,
// its routing and its contact rule along with its travel, and every one of those
// is another point's. That the drifter can move at all is checked FIRST, over a
// stretch this check itself steps, so a build whose drifters never move fails
// this point instead of passing it on nothing.
//
// THE TWO ROOMS NEVER MEET. The drifter wanders a sealed corridor four rows below
// the forager's sealed room, so it can never be eaten and the pair of bodies this
// check watches is the pair it posed.

import { afterEach, beforeEach, it } from "vitest";
import { BRIGHT_HOLD, TICK_DT, TICK_HZ } from "../constants";
import { assertLessThanOrEqual } from "../assert";
import { poseMaze, spawnDrifter } from "../fixtures";
import {
  captureReplay,
  createHarness,
  poseBrightness,
  startPlaying,
  type Harness,
} from "../harness";
import {
  parkForager,
  requireDrifterMotion,
  requireSceneHeld,
  sceneGuard,
  type SceneView,
} from "../scene";

/**
 * The board: an eight-tile room for the forager, three rows of solid rock, and a
 * twelve-tile corridor for the wandering witness.
 *
 * The two are disconnected, so the forager can never reach the witness and eat
 * it, however long either of them runs.
 */
const ART = [
  "F.......",
  "########",
  "########",
  "########",
  "W...........",
] as const;

/** One second of real time with nothing stepping the game. */
const SETTLE_MS = 1000;

/**
 * The most simulation time that may accrue over that second, in seconds.
 *
 * Two ticks. A conforming build accrues exactly none — nothing but the harness's
 * own `advance` steps the game (specs/instrumentation.md) — so this is not room
 * for a different reading of the rule. It is room for a frame already in flight.
 * A build running a loop of its own reports about `1.0` here.
 */
const MAX_DRIFT = 2 * TICK_DT;

/**
 * The furthest anything on the board may drift over that second, in logical
 * units.
 *
 * The witness wanders at `DRIFTER_SPEED` (`64`), so a running clock carries it
 * two tiles in a second. Four units is an eighth of a tile: rounding, and nothing
 * else.
 */
const MAX_TRAVEL = 4;

/** One second of game time, as specs/movement.md counts it. */
const STEP_TICKS = TICK_HZ;

/** The same second, spent sixty steps at a time. */
const SPLIT_STEPS = 60;
const SPLIT_TICKS = STEP_TICKS / SPLIT_STEPS;

/**
 * How far a stepped span's simulation time may sit from the time those ticks are
 * worth, in seconds.
 *
 * One tick. Each advanced frame is exactly one `TICK_DT`, so the exact answer is
 * `ticks * TICK_DT` and this is the accumulation of a double, not a tolerance on
 * the rule.
 */
const STEP_EPS = TICK_DT;

/** Recorded ticks either side of the wait, so the clip opens and closes on it. */
const OPEN_TICKS = 24;

/** The furthest anything on the board moved between two states, in logical units. */
function widestTravel(before: SceneView, after: SceneView): number {
  const from = [before.forager, ...before.drifters];
  const to = [after.forager, ...after.drifters];
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

afterEach(() => {
  h?.dispose();
});

it("advances only when the driver steps it, by exactly the ticks it is given", async () => {
  await startPlaying(h);
  const board = await poseMaze(h, ART);
  const home = board.mark("F");
  const beat = board.mark("W");
  await parkForager(h, home);
  // Full glow, so the clip is a lit room a reviewer can compare frame to frame
  // rather than a black rectangle.
  await poseBrightness(h, 1, BRIGHT_HOLD);

  const witness = await spawnDrifter(h, beat);
  const watch = await sceneGuard(h, { foragerParked: false });

  const run = await captureReplay(h, "held", async () => {
    // The clip opens on the posed room, before the wait.
    await h.advance(OPEN_TICKS);

    const before = h.snapshot();
    // The measurement: real wall-clock time, with nothing stepping the build.
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    const after = h.snapshot();

    // And closes on it, so the two halves of the clip are the same picture.
    await h.advance(OPEN_TICKS);

    // Now the driver's own step, and the same second spent sixty ways.
    const stepFrom = h.snapshot();
    await h.advance(STEP_TICKS);
    const stepTo = h.snapshot();

    const splitFrom = h.snapshot();
    for (let i = 0; i < SPLIT_STEPS; i += 1) await h.advance(SPLIT_TICKS);
    const splitTo = h.snapshot();

    return { before, after, stepFrom, stepTo, splitFrom, splitTo };
  });

  requireSceneHeld(h.snapshot(), watch);

  // The witness has to be able to move for "nothing moved" to mean anything,
  // and whether a drifter wanders under its own power is `amber/*`'s verdict
  // rather than this one's.
  requireDrifterMotion(
    run.stepFrom,
    run.stepTo,
    witness,
    "wander over a second the driver stepped, which is what makes " +
      "'nothing moved while real time passed' a reading rather than a tautology",
  );

  assertLessThanOrEqual(
    run.after.simTime - run.before.simTime,
    MAX_DRIFT,
    `seconds of simulation time accrued over ${SETTLE_MS} ms of real time ` +
      `with nothing stepping the game`,
  );
  assertLessThanOrEqual(
    widestTravel(run.before, run.after),
    MAX_TRAVEL,
    `the furthest the forager or the drifter moved, in logical units, ` +
      `over that same second — so the clock was held rather than a counter ` +
      `stalled`,
  );

  const stepped = run.stepTo.simTime - run.stepFrom.simTime;
  assertLessThanOrEqual(
    Math.abs(stepped - STEP_TICKS * TICK_DT),
    STEP_EPS,
    `how far simTime moved from the ${STEP_TICKS * TICK_DT} s that ` +
      `${STEP_TICKS} ticks are worth`,
  );

  const split = run.splitTo.simTime - run.splitFrom.simTime;
  assertLessThanOrEqual(
    Math.abs(split - stepped),
    STEP_EPS,
    `how far the same second differs when it is covered as ${SPLIT_STEPS} ` +
      `steps of ${SPLIT_TICKS} ticks instead of one step of ${STEP_TICKS}`,
  );
});

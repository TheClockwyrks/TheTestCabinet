// instrumentation/manual-clock — the game holds still on the driver's clock, and
// a step of `n` ticks is worth exactly `n` ticks however it is spent.
//
// specs/instrumentation.md rests the surface on a deterministic core: "Game state
// advances from the elapsed time the game is handed, independent of a canvas, of
// the frame loop that measured it, and of wall-clock time", and specs/movement.md
// fixes the step at `TICK_DT` with `TICK_HZ` (`120`) of them a second. Under this
// engine the clock is the harness's own `ConstantClock` and the engine ticks the
// world only when `advance` says so, so both halves of that core are readable:
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
// THE WITNESS IS A PREDATOR, NOT THE FORAGER. A forager with no action held rests
// under either reading of specs/movement.md, so it would sit still whether or not
// something else were driving the game and prove nothing. A released predator
// patrols on the game's own clock whatever the player does
// (specs/predators.md), so it is what a still-running clock would visibly carry
// across its corridor. That it can move at all is checked FIRST, over a stretch
// this check itself steps, so a build whose predators never move stands the point
// down instead of passing it on nothing.
//
// AND THE WITNESS IS OUT OF REACH BY ARITHMETIC, NOT BY ROCK. A hunter contained
// by a wall is only contained while the build's own movement rule holds, and a
// build that walks a body through rock would end this scenario with a life lost
// and report a movement defect under a heading about the clock. So the witness is
// posed a distance away that no body could cross in the ticks this check ever
// steps: the whole run is {@link REACH_TICKS} ticks, and even at
// `GLOAMFIN_CHASE_SPEED` (`134`) — the fastest anything in `specs/predators.md`
// travels — that buys {@link MAX_REACH} units against the separation the fixture
// poses, which the check reads back off the snapshot and holds to that floor. It
// is past `GLOAMFIN_HEAR` (`64`, 2 tiles) by the same margin, so the witness never
// takes a fix and never chases at all; its own ping floods corridors that do not
// reach the forager.

import { afterEach, beforeEach, it } from "vitest";
import {
  BRIGHT_HOLD,
  GLOAMFIN_CHASE_SPEED,
  TICK_DT,
  TICK_HZ,
} from "../constants";
import { assertGreaterThan, assertLessThanOrEqual } from "../assert";
import { poseMaze, spawnPredator } from "../fixtures";
import {
  captureReplay,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import {
  parkForager,
  requirePredatorMotion,
  requireSceneHeld,
  sceneGuard,
} from "../scene";
import type { SceneView } from "../scene";

/**
 * The board: an eight-tile room for the forager, three rows of solid rock, and a
 * twelve-tile corridor for the patrolling witness.
 *
 * The two are disconnected, so the witness cannot reach the forager however long
 * it patrols, and four rows of separation is `128` logical units — twice
 * `GLOAMFIN_HEAR` (`64`) — so the witness never takes a close-hearing fix either.
 */
const ART = [
  "F.......",
  "########",
  "########",
  "########",
  " ".repeat(20) + "P...........",
] as const;

/** The kind posed loose as the witness. */
const WITNESS = "gloamfin" as const;

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
 * The slowest thing that moves under its own power is the drifter at
 * `DRIFTER_SPEED` (`64`) and the witness patrols at `PREDATOR_SPEED` (`116`), so
 * a running clock carries the slowest of them two tiles in a second. Four units
 * is an eighth of a tile: rounding, and nothing else.
 */
const MAX_TRAVEL = 4;

/** Recorded ticks either side of the wait, so the clip opens and closes on it. */
const OPEN_TICKS = 24;

/** One second of game time, as specs/movement.md counts it. */
const STEP_TICKS = TICK_HZ;

/** The same second, spent sixty steps at a time. */
const SPLIT_STEPS = 60;
const SPLIT_TICKS = STEP_TICKS / SPLIT_STEPS;

/** Every tick this check steps the game, over the whole run. */
const REACH_TICKS = 2 * OPEN_TICKS + STEP_TICKS + SPLIT_STEPS * SPLIT_TICKS;

/**
 * The furthest any body could travel across the whole run, in logical units.
 *
 * `GLOAMFIN_CHASE_SPEED` (`134`) is the fastest figure `specs/predators.md` gives
 * anything, so a body travelling flat out for every stepped tick — through rock,
 * through the border, however a broken build routes it — covers this much and no
 * more. The separation the fixture poses is held above it below, which is what
 * makes contact impossible here without leaning on rock being solid.
 */
const MAX_REACH = (GLOAMFIN_CHASE_SPEED * REACH_TICKS) / TICK_HZ;

/**
 * How far a stepped span's simulation time may sit from the time those ticks are
 * worth, in seconds.
 *
 * One tick. Each advanced frame is exactly one `TICK_DT`, so the exact answer is
 * `ticks * TICK_DT` and this is the accumulation of a double, not a tolerance on
 * the rule.
 */
const STEP_EPS = TICK_DT;

/** The furthest anything on the board moved between two states, in logical units. */
function widestTravel(before: SceneView, after: SceneView): number {
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

afterEach(() => {
  h?.dispose();
});

it("advances only when the driver steps it, by exactly the ticks it is given", async () => {
  startPlaying(h);
  const board = await poseMaze(h, ART);
  const home = board.mark("F");
  const beat = board.mark("P");
  await parkForager(h, home);
  // Full glow, so the clip is a lit room a reviewer can compare frame to frame
  // rather than a black rectangle.
  h.debug.setBrightness(1);
  h.debug.setBrightHold(BRIGHT_HOLD);

  // The one creature on the board: a hunter patrolling the beat it was posed
  // on, which is what makes "nothing moved while real time passed" a reading
  // rather than a tautology.
  const witness = await spawnPredator(h, WITNESS, beat);
  const watch = await sceneGuard(h, { foragerParked: false });

  // The fixture's own geometry: far enough that no body travelling flat out for
  // every tick this check steps could reach the forager, so nothing here rests on
  // the rock between them holding.
  const posed = h.snapshot();
  assertGreaterThan(
    Math.hypot(
      posed.predators[witness].x - posed.forager.x,
      posed.predators[witness].y - posed.forager.y,
    ),
    MAX_REACH,
    `the units between the witness and the forager, against the ${MAX_REACH.toFixed(0)} ` +
      `a body could cover over the ${REACH_TICKS} ticks this check steps at ` +
      `GLOAMFIN_CHASE_SPEED (${GLOAMFIN_CHASE_SPEED})`,
  );

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
  // and whether a predator patrols under its own power is the den and patrol
  // points' verdict rather than this one's.
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
    `seconds of simulation time accrued over ${SETTLE_MS} ms of real time ` +
      `with nothing stepping the game`,
  );
  assertLessThanOrEqual(
    widestTravel(run.before, run.after),
    MAX_TRAVEL,
    `the furthest the forager or any predator drifted, in logical units, ` +
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

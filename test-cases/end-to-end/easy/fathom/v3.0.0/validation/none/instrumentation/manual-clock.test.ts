// instrumentation/manual-clock — the game holds still when it is handed no
// ticks, and a step of `n` ticks is worth exactly `n` ticks.
//
// `specs/instrumentation.md` puts both halves of the render-free core on the
// clock. `advance(ticks)` "runs `ticks` whole simulation ticks immediately and in
// order, each worth exactly one `TICK_DT`. The unit is ticks rather than seconds,
// so nothing is rounded: `advance(1)` runs one tick and `advance(120)` covers one
// second of game time", and "`ticks` is a non-negative whole number, and
// `advance(0)` runs nothing." Both halves are readable with nothing left to real
// time: a step of no ticks changes nothing, and a counted step moves `simTime` by
// exactly what those ticks are worth.
//
// WHY THIS IS WORTH ITS OWN POINT. Nothing else in this suite can report it.
// Every other check poses a scenario and then measures it, and a build whose
// `advance` runs a tick whatever count it was handed, or keeps a timer of its
// own, arrives at the measurement in a different world than the one the check
// set up — so the point that fails is whichever one happened to be posed on
// something that moved. A run failed two movement points because the forager had
// swum off the tile with the opening in it, and an audio point because the pellet
// under the forager had been eaten, cue and all, before the window opened. Not
// one of the three is about the clock. This is where that defect belongs.
//
// THE STEPS ARE COUNTED, NOT WAITED FOR. Whether the build's own loop keeps
// stepping the game on the wall clock once `setAutoStep(false)` has taken it off
// is a question only real time elapsing could answer, and this suite reads no
// real time: what it reads is the surface's own clock operations, which are the
// build's deliverable, so `advance(0)` is called a handful of times with nothing
// else touching the game and the world is read before and after.
//
// THE WITNESS IS A PREDATOR, NOT THE FORAGER. A forager with no key held rests
// under either reading of `specs/movement.md`, so it would sit still whether or
// not the clock were running and prove nothing. A released predator patrols on
// the game's own clock whatever the player does (`specs/predators.md`), so it is
// what a step that ran ticks would visibly carry across its corridor. That it can
// move at all is checked FIRST, over a stretch this check itself steps, so a
// build whose predators never move fails this point instead of passing it on
// nothing.
//
// AND THE WITNESS IS OUT OF REACH BY ARITHMETIC, NOT BY ROCK. A hunter contained
// by a wall is only contained while the build's own movement rule holds, and a
// build that walked a body through rock would end this scenario with a life lost
// and report a movement defect under a heading about the clock. So the witness is
// posed a distance away that no body could cross in the ticks this check ever
// steps: {@link REACH_TICKS} ticks buys {@link MAX_REACH} units even at
// `GLOAMFIN_CHASE_SPEED` (`134`), the fastest figure `specs/predators.md` gives
// anything, and the separation the fixture poses is read back off the snapshot
// and held above it. It is past `GLOAMFIN_HEAR` (`64`, 2 tiles) many times over,
// so the witness never takes a close-hearing fix at all, and its own ping floods
// corridors that do not reach the forager.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import {
  BRIGHT_HOLD,
  GLOAMFIN_CHASE_SPEED,
  SIM_TIME_EPS,
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

/**
 * Steps of no ticks, made with nothing else touching the game.
 *
 * A handful, each a call of its own, so a build whose `advance(0)` runs a tick
 * anyway has run several of them by the time the world is read back.
 */
const HELD_STEPS = 8;

/** The ticks each of those steps asks for: none. */
const HELD_TICKS = 0;

/** One second of game time, as `specs/instrumentation.md` counts it. */
const STEP_TICKS = TICK_HZ;

/** Recorded ticks either side of the held steps, so the clip opens and closes on them. */
const OPEN_TICKS = 24;

/**
 * Every tick this check asks the game for, over the whole run.
 *
 * The clip's two ends and the driver's own second; the held steps ask for none.
 */
const REACH_TICKS = 2 * OPEN_TICKS + STEP_TICKS;

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

it("advances only by the ticks it is stepped, by exactly the ticks it is given", async () => {
  await startPlaying(h);
  // `createHarness` and `reset` both leave manual stepping armed already, so on a
  // conforming build this changes nothing; it is here because the flag is what
  // takes the game off real time and the call is the documented way to set it.
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
  // every tick this check steps could reach the forager, so nothing here rests on
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
      `this check steps at GLOAMFIN_CHASE_SPEED (${GLOAMFIN_CHASE_SPEED})`,
  );

  const run = await captureReplay(h, "held", async () => {
    // The clip opens on the posed room, before the held steps.
    await h.advance(OPEN_TICKS);

    const before = await h.snapshot();
    // The measurement: steps of no ticks, with nothing else touching the build.
    for (let i = 0; i < HELD_STEPS; i += 1) await h.debug.advance(HELD_TICKS);
    const after = await h.snapshot();

    // And closes on it, so the two halves of the clip are the same picture.
    await h.advance(OPEN_TICKS);

    // Now the driver's own second, asked for in the one call the specification
    // states the figure for, rather than a tick at a time through the harness.
    const stepFrom = await h.snapshot();
    await h.debug.advance(STEP_TICKS);
    const stepTo = await h.snapshot();

    return { before, after, stepFrom, stepTo };
  });

  requireSceneHeld(await h.snapshot(), guard);

  // The witness has to be able to move for "nothing moved" to mean anything.
  requirePredatorMotion(
    run.stepFrom,
    run.stepTo,
    witness,
    "patrol over a second the driver stepped, which is what makes " +
      "'nothing moved across steps of no ticks' a reading rather than a tautology",
  );

  assertEqual(
    run.after.simTime - run.before.simTime,
    0,
    `seconds of simulation time accrued over ${HELD_STEPS} calls of ` +
      `advance(${HELD_TICKS}), each of which runs nothing`,
  );
  assertEqual(
    widestTravel(run.before, run.after),
    0,
    `the furthest the forager or any predator moved, in logical units, over ` +
      `those same steps — so the clock was held rather than a counter stalled`,
  );

  assertLessThanOrEqual(
    Math.abs(run.stepTo.simTime - run.stepFrom.simTime - STEP_TICKS * TICK_DT),
    SIM_TIME_EPS,
    `how far simTime moved from the ${STEP_TICKS * TICK_DT} s that ` +
      `advance(${STEP_TICKS}) is worth`,
  );
});

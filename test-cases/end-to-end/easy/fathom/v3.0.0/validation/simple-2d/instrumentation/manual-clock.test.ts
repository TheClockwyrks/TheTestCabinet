// instrumentation/manual-clock — the game holds still when it is handed no time,
// and a counted run of ticks is worth exactly what those ticks add up to.
//
// specs/instrumentation.md rests the surface on a render-free core: "Game state
// advances from the elapsed simulation time the game is handed, independent of a
// canvas, of the frame loop that measured it, and of wall-clock time", and
// specs/movement.md fixes the step at `TICK_DT` with `TICK_HZ` (`120`) of them a
// second, advancing "the whole `TICK_DT` ticks that delta completes". Under this
// engine the clock is the harness's own, so both halves of that core are
// readable with nothing left to real time: a frame handed no elapsed time
// completes no tick and changes nothing, and a counted run of one-tick frames
// moves `simTime` by exactly what those frames are worth.
//
// WHY THIS IS WORTH ITS OWN POINT. Nothing else in this suite can report it.
// Every other check poses a scenario and then measures it, and a build that
// steps a tick on every frame whatever that frame carried, or keeps a timer of
// its own, arrives at the measurement in a different world than the one the
// check set up — so the point that fails is whichever one happened to be posed
// on something that moved. This is where that defect belongs.
//
// THE FRAMES ARE SCRIPTED, NOT WAITED FOR. `frame(0)` hands the engine's loop a
// frame worth no elapsed time: it is drawn and recorded like any other frame,
// and specs/movement.md leaves it completing no tick. A second of such frames is
// what a still world looks like on the clip, and it costs the wall clock nothing,
// so the reading is the same on any host.
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
import { assertEqual, assertLessThanOrEqual } from "../assert";
import { BRIGHT_HOLD, SIM_TIME_EPS, TICK_DT, TICK_HZ } from "../constants";
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

/**
 * Frames handed no elapsed time, with nothing else stepping the game.
 *
 * A second's worth of them at `TICK_HZ`, so the clip holds a second of a world
 * that a running clock would have carried the witness two tiles across.
 */
const HELD_FRAMES = TICK_HZ;

/** The elapsed time each of those frames carries: none. */
const HELD_MS = 0;

/** One second of game time, as specs/movement.md counts it, in one-tick frames. */
const STEP_TICKS = TICK_HZ;

/** Recorded ticks either side of the held second, so the clip opens and closes on it. */
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

it("advances only by the time it is handed, by exactly the ticks it is given", async () => {
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
    // The clip opens on the posed room, before the held second.
    await h.advance(OPEN_TICKS);

    const before = h.snapshot();
    // The measurement: a second of frames, each handed no elapsed time.
    for (let i = 0; i < HELD_FRAMES; i += 1) await h.frame(HELD_MS);
    const after = h.snapshot();

    // And closes on it, so the two halves of the clip are the same picture.
    await h.advance(OPEN_TICKS);

    // Now the driver's own second, a tick a frame.
    const stepFrom = h.snapshot();
    await h.advance(STEP_TICKS);
    const stepTo = h.snapshot();

    return { before, after, stepFrom, stepTo };
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
      "'nothing moved across frames carrying no time' a reading rather than " +
      "a tautology",
  );

  assertEqual(
    run.after.simTime - run.before.simTime,
    0,
    `seconds of simulation time accrued over ${HELD_FRAMES} frames each ` +
      `handed ${HELD_MS} ms of elapsed time, which complete no tick`,
  );
  assertEqual(
    widestTravel(run.before, run.after),
    0,
    `the furthest the forager or the drifter moved, in logical units, over ` +
      `those same frames — so the clock was held rather than a counter stalled`,
  );

  assertLessThanOrEqual(
    Math.abs(run.stepTo.simTime - run.stepFrom.simTime - STEP_TICKS * TICK_DT),
    SIM_TIME_EPS,
    `how far simTime moved from the ${STEP_TICKS * TICK_DT} s that ` +
      `${STEP_TICKS} one-tick frames are worth`,
  );
});

// instrumentation/carries-remainder — the part of a frame's delta that completes
// no tick is carried into the next frame.
//
// specs/movement.md fixes the core this rests on: the simulation advances "by
// the whole `TICK_DT` ticks that delta completes, carrying the remainder into
// the next frame, so the number of ticks run over an interval of game time is
// the same however that interval was divided into frames". So this hands the
// engine's own loop frames each worth less than a tick and reads how many ticks
// the build completed across them.
//
// WHY THIS POINT EXISTS. Every other check in this suite hands a frame exactly
// one tick, and `instrumentation/advances-by-delta` hands frames whole ticks, so
// none of them can tell a build that carries a remainder from one that throws it
// away. A player's display delivers frames no whole number of ticks long, and a
// build that drops the fraction on every frame runs slow by that fraction on
// every one of them. This is the only point whose frames are not whole ticks.
//
// THE FRAMES ARE SCRIPTED, NOT WAITED FOR. `frame(ms)` hands the engine's loop a
// frame worth exactly `ms` of elapsed time, drawn and recorded like any other,
// so the same frames land on any host and the reading is the build's alone.
//
// THE FRACTION SITS A QUARTER TICK FROM EVERY BOUNDARY. Three quarters of a tick
// three times over is two and a quarter ticks: the first frame completes none,
// the second and third complete one each, and no running total lands on a whole
// tick, so nothing here turns on which way a double rounds at a boundary. A
// build that drops the fraction completes nothing across all three; a build that
// steps a tick per frame completes three.
//
// THE READING IS `simTime`. "Every tick adds its own length" (specs/state.md),
// so the ticks a frame completed are read off it exactly, and a frame that
// completed none leaves it where it was. A drifter wanders the board for the
// clip alone, so a reviewer sees a lit room with something moving in it rather
// than a black rectangle; nothing below reads the drifter.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import { BRIGHT_HOLD, SIM_TIME_EPS, TICK_DT } from "../constants";
import { poseMaze, spawnDrifter } from "../fixtures";
import {
  captureReplay,
  createHarness,
  poseBrightness,
  startPlaying,
  TICK_MS,
  type Harness,
} from "../harness";
import { parkForager, requireSceneHeld, sceneGuard } from "../scene";

/**
 * The board: an eight-tile room for the forager, three rows of solid rock, and a
 * twelve-tile corridor for the drifter the clip shows.
 *
 * The two are disconnected, so the forager can never reach the drifter and eat
 * it, however long either of them runs.
 */
const ART = [
  "F.......",
  "########",
  "########",
  "########",
  "W...........",
] as const;

/** The fraction of a tick each scripted frame is worth. */
const PART_OF_TICK = 0.75;

/** The elapsed time each scripted frame is handed, in milliseconds. */
const PART_MS = PART_OF_TICK * TICK_MS;

/** Scripted frames handed over, one after another. */
const PART_FRAMES = 3;

/**
 * The ticks those frames complete between them: the whole part of two and a
 * quarter.
 */
const EXPECTED_TICKS = Math.floor(PART_FRAMES * PART_OF_TICK);

/** Recorded ticks either side of the scripted frames, so the clip opens and closes on them. */
const OPEN_TICKS = 24;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("carries the part of a delta that completes no tick into the next frame", async () => {
  await startPlaying(h);
  const board = await poseMaze(h, ART);
  await parkForager(h, board.mark("F"));
  // Full glow, so the clip is a lit room a reviewer can compare frame to frame
  // rather than a black rectangle.
  await poseBrightness(h, 1, BRIGHT_HOLD);
  await spawnDrifter(h, board.mark("W"));
  const watch = await sceneGuard(h, { foragerParked: false });

  const run = await captureReplay(h, "carried", async () => {
    // The clip opens on the posed room, a tick a frame.
    await h.advance(OPEN_TICKS);

    const before = h.snapshot();
    // The measurement: the first frame, worth three quarters of a tick, alone.
    await h.frame(PART_MS);
    const afterOne = h.snapshot();
    // And the rest of them.
    for (let i = 1; i < PART_FRAMES; i += 1) await h.frame(PART_MS);
    const afterAll = h.snapshot();

    // And closes on it, a tick a frame again.
    await h.advance(OPEN_TICKS);

    return { before, afterOne, afterAll };
  });

  requireSceneHeld(h.snapshot(), watch);

  assertEqual(
    run.afterOne.simTime - run.before.simTime,
    0,
    `seconds of simulation time accrued over one frame handed ${PART_OF_TICK} ` +
      `of a tick, which completes no tick`,
  );
  assertLessThanOrEqual(
    Math.abs(
      run.afterAll.simTime - run.before.simTime - EXPECTED_TICKS * TICK_DT,
    ),
    SIM_TIME_EPS,
    `how far simTime moved from the ${EXPECTED_TICKS} ticks that ${PART_FRAMES} ` +
      `frames each handed ${PART_OF_TICK} of a tick complete between them`,
  );
});

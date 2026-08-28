// maze-movement/constant-speed — the forager covers ground at FORAGER_SPEED, and
// keeps covering it at that rate for the whole run.
//
// `specs/movement.md`: "The forager travels at `FORAGER_SPEED` (`128` logical
// units per second, four tiles per second), and that speed is constant wherever
// it is in the maze." CONSTANT is the whole claim, so one reading taken across a
// whole run is not enough: a build that eases in over the first few tenths and a
// build that drifts slower as the run goes on both average back to something
// close to `128`. The hold is therefore split into four consecutive stretches of
// half a second, and each of them is held to the same figure the whole span is —
// which is what "no ramp at the start and no drift over the run" asks for.
//
// THE CORRIDOR IS POSED. How much straight corridor a board offers, and where, is
// the build's own design (`specs/maze.md` fixes rules, never a layout), so a check
// that went hunting for a run would measure the board it landed in. `setMaze`
// stamps the same fourteen-tile corridor under every build
// (`specs/instrumentation.md` exempts a posed fixture from `specs/maze.md`), and
// the fixture carries the sealed larder, so no amount of grazing along it can
// clear the maze mid-measurement.
//
// WHAT THIS DOES NOT DECIDE. Whether a held key reaches the forager at all, which
// is `controls/move-right`'s; and where a turn is taken, which is
// `maze-movement/turn-at-center`'s. The corridor runs straight past the far end
// of the measured span, so nothing here turns and nothing runs into rock.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual, assertNull } from "../assert";
import { ARROW_KEY, FORAGER_SPEED, TICK_HZ } from "../constants";
import { poseStraightRun } from "../fixtures";
import {
  captureReplay,
  createHarness,
  seconds,
  type FathomSnapshot,
  type Harness,
} from "../harness";
import {
  denAllExcept,
  requireSwim,
  sceneGuard,
  sceneHeld,
  startPlaying,
} from "../scene";

/** The corridor the run is measured on, in tiles. */
const RUN_TILES = 14;

/** The key `specs/movement.md` binds the `right` action to. */
const KEY = ARROW_KEY.right;

/**
 * How long the scenario waits for the held action to reach the forager at all,
 * in ticks.
 *
 * The measured span opens on the first tick the forager has actually moved, so a
 * build that reads its keyboard on the tick after the key lands is measured over
 * travel rather than over its own handover. A quarter of a second is far longer
 * than any such handover; a forager that has not started by then has not
 * travelled under a held action, which `controls/move-right` decides, and this
 * check stands down through {@link requireSwim} rather than answering.
 */
const LAUNCH_TICKS = TICK_HZ / 4;

/**
 * One measured stretch, in ticks: half a second, which is two tiles of travel at
 * `FORAGER_SPEED`.
 */
const SEGMENT_TICKS = TICK_HZ / 2;

/**
 * How many stretches the run is measured in.
 *
 * Four of them is `2 s` and eight tiles of corridor, comfortably past the "at
 * least four tiles" the point asks the reading to be taken over, and it is the
 * split that turns one average into a shape: the first stretch answers "no ramp
 * at the start" and the last three answer "no drift over the run".
 */
const SEGMENTS = 4;

/** Ticks the key stays down past the last reading, purely for the clip. */
const TAIL_TICKS = 30;

/**
 * How far the measured speed may sit from `FORAGER_SPEED`, as a fraction.
 *
 * The point's own bound: two percent. On the fixed timestep `specs/movement.md`
 * defines, a build that integrates whole ticks of `TICK_DT` covers exactly
 * `FORAGER_SPEED / TICK_HZ` per tick, so this is slack for a build that carries
 * its position as a float rather than room for a different speed.
 */
const SPEED_TOLERANCE = 0.02;

/** The speed a stretch was covered at, in logical units per second. */
function speedOver(
  from: FathomSnapshot,
  to: FathomSnapshot,
  ticks: number,
): number {
  const distance = Math.hypot(
    to.forager.x - from.forager.x,
    to.forager.y - from.forager.y,
  );
  return distance / seconds(ticks);
}

let h: Harness;

beforeEach(async (ctx) => {
  h = await createHarness(ctx);
});

afterEach(async () => {
  await h.dispose();
});

it("swims a straight corridor at FORAGER_SPEED, with no ramp and no drift", async () => {
  await startPlaying(h);
  const run = await poseStraightRun(h, RUN_TILES);
  const quiet = await denAllExcept(h);
  // The forager is the SUBJECT, so it is not held to staying put. What the guard
  // still catches is a life lost, a predator loose, or the dive leaving live
  // play — any of which would make this a reading of some other situation.
  const guard = await sceneGuard(h, quiet, { foragerParked: false });

  const drive = await captureReplay(h, "run", async () => {
    const resting = await h.snapshot();
    await h.hold(KEY);
    let launched = resting;
    for (let tick = 0; tick < LAUNCH_TICKS; tick += 1) {
      await h.advance(1);
      launched = await h.snapshot();
      if (launched.forager.x > resting.forager.x) break;
    }
    const marks: FathomSnapshot[] = [];
    for (let segment = 0; segment < SEGMENTS; segment += 1) {
      await h.advance(SEGMENT_TICKS);
      marks.push(await h.snapshot());
    }
    // Held on past the last reading so the clip closes on a forager still
    // swimming. Every state the verdict rests on is already captured.
    await h.advance(TAIL_TICKS);
    await h.release(KEY);
    return { resting, launched, marks };
  });

  assertNull(
    sceneHeld(await h.snapshot(), guard),
    "the scenario held to the end",
  );

  // Whether a held action moves the forager at all is `controls/move-right`'s
  // verdict; with no travel there is no speed to measure, so this stands down
  // rather than reporting a speed of zero as a speed fault.
  const last = drive.marks[SEGMENTS - 1];
  requireSwim(
    h,
    drive.resting.forager,
    last.forager,
    `swim the ${RUN_TILES}-tile corridor this check measures`,
  );

  const span = SEGMENTS * SEGMENT_TICKS;
  assertLessThanOrEqual(
    Math.abs(speedOver(drive.launched, last, span) - FORAGER_SPEED),
    FORAGER_SPEED * SPEED_TOLERANCE,
    `|speed - FORAGER_SPEED| over the whole ${span}-tick run from tile ` +
      `(${run.tx}, ${run.ty}), in logical units per second`,
  );

  let from = drive.launched;
  for (const [index, mark] of drive.marks.entries()) {
    assertLessThanOrEqual(
      Math.abs(speedOver(from, mark, SEGMENT_TICKS) - FORAGER_SPEED),
      FORAGER_SPEED * SPEED_TOLERANCE,
      `|speed - FORAGER_SPEED| over stretch ${index + 1} of ${SEGMENTS}, the ` +
        `${SEGMENT_TICKS} ticks from ${index * SEGMENT_TICKS} to ` +
        `${(index + 1) * SEGMENT_TICKS} of the run`,
    );
    from = mark;
  }
});

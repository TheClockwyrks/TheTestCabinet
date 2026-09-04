// Wireworm — instrumentation/deterministic-core: the simulation advances on the
// elapsed time it is handed and on nothing else, so one second of game time
// reaches the same state however that second was divided into frames.
//
// specs/instrumentation.md rests the whole surface on it, under A deterministic
// core: "every rate integrated against the delta time the game is given, so an
// interval of game time reaches the same state however it was divided into
// frames", and "Game state advances from the elapsed time the game is handed,
// independent of a canvas, of the frame loop that measured it, and of wall-clock
// time." specs/worm.md fixes the one clocked quantity to the same rule: the step
// clock "accumulates the simulated time that passes... so a frame covering
// several intervals runs several steps in order and the remainder carries into
// the next frame."
//
// SO THE SAME SECOND IS SPENT TWICE, AT STEP SIZES SIXTY APART. One harness runs
// a clock whose every frame is worth a whole second and takes one frame; the
// other runs a clock at sixty frames a second and takes sixty. Both report the
// second on `simTime`, which "accumulates every update's delta, whatever the
// screen", and both leave the worm on the same tile — a build whose worm takes
// one step per FRAME rather than per interval ends the two runs seven tiles
// apart, and a build reading a clock of its own ends them anywhere at all.
//
// THE WITNESS IS A WORM BECAUSE IT IS THE ONE CLOCKED THING. Everything else in
// this game is a rate integrated against the delta, which reaches the same place
// under either division by simple arithmetic; only the step clock has to carry a
// remainder to do so. At level 1 the interval is `0.14` s (specs/worm.md), so one
// second is seven whole steps with `0.02` s carried — a remainder a build that
// merely resets its accumulator every frame would lose, and one that resets it
// every step would keep. The worm is posed as a single segment, so the reading is
// of the head's own clock and not of the body's follow.
//
// WHY THIS CHECK BUILDS ITS OWN HARNESSES. Every other point in this suite runs
// on the harness's own `ConstantClock` at a fixed 120 Hz, because a duration is
// then a whole number of frames. This one is ABOUT the step size, so it supplies
// two clocks of its own and compares what they reach.
//
// WHAT THIS DOES NOT DECIDE. Not the step interval itself: nothing here asserts
// how many tiles the worm covered, only that both runs covered the same ground.
// `worm/step-cadence` grades the figure.

import { afterEach, it } from "vitest";
import { ConstantClock } from "@test-cabinet/structured-2d";
import { WORM_STEP_L1 } from "../constants";
import { assertCloseTo, assertEqual, assertNotEqual } from "../assert";
import {
  captureStill,
  createHarness,
  headOf,
  poseWorm,
  resetTo,
  startPlaying,
  wormById,
  type Harness,
  type WirewormSnapshot,
} from "../harness";

/** The span of game time each run covers, in seconds. */
const SPAN_SECONDS = 1;

/** The coarse division: one frame worth the whole second. */
const COARSE_FRAMES = 1;

/** The fine division: sixty frames worth a sixtieth of it each. */
const FINE_FRAMES = 60;

/** The tile the worm's head starts on, on an otherwise empty row. */
const WORM_C = 5;
const WORM_R = 3;

/**
 * How far a run's accumulated `simTime` may sit from the second it was given, in
 * decimal digits for `assertCloseTo`.
 *
 * Nine digits, which is half a nanosecond. A conforming build accumulates
 * exactly the deltas it was handed and the only distance from `1.0` is the sum
 * of sixty doubles — this is that arithmetic, not room for a different reading
 * of the rule. A build running a clock of its own, or dropping a frame's delta,
 * misses by whole hundredths.
 */
const SIM_DIGITS = 9;

/** A worm's head tile as `"c,r"`, or what the snapshot reported instead. */
function headTile(snapshot: WirewormSnapshot, id: number): string {
  const worm = wormById(snapshot, id);
  if (worm === undefined) return `no worm carrying id ${id}`;
  const head = headOf(worm);
  return head === undefined ? "a worm of no segments" : `${head.c},${head.r}`;
}

/** One run of the same second, at the step size a clock of `stepMs` gives. */
interface Run {
  h: Harness;
  id: number;
  simTime: number;
  head: string;
}

const open: Harness[] = [];

afterEach(() => {
  for (const h of open.splice(0)) h.dispose();
});

/**
 * Pose one worm on an empty, quiet board and spend `SPAN_SECONDS` of game time
 * on it in `frames` frames of a clock whose every frame is worth `stepMs`.
 */
async function spendTheSecond(stepMs: number, frames: number): Promise<Run> {
  const h = await createHarness({ clock: new ConstantClock(stepMs) });
  open.push(h);
  // `reset` first, so `simTime` starts from zero and the reading below is the
  // second this run spent rather than one accumulated before it.
  resetTo(h);
  startPlaying(h);
  const id = poseWorm(h, WORM_C, WORM_R);
  await h.advance(frames);
  const snapshot = h.snapshot();
  return { h, id, simTime: snapshot.simTime, head: headTile(snapshot, id) };
}

it("reaches the same state whether a second is one frame or sixty", async () => {
  const coarse = await spendTheSecond(
    (SPAN_SECONDS * 1000) / COARSE_FRAMES,
    COARSE_FRAMES,
  );
  const fine = await spendTheSecond(
    (SPAN_SECONDS * 1000) / FINE_FRAMES,
    FINE_FRAMES,
  );
  // Before the assertions, so a failing run still leaves the picture of the
  // board the finely divided second reached.
  captureStill(fine.h, "stepped");

  assertCloseTo(
    coarse.simTime,
    SPAN_SECONDS,
    SIM_DIGITS,
    `the simulation time ${COARSE_FRAMES} frame worth ${SPAN_SECONDS} s ` +
      `accumulated`,
  );
  assertCloseTo(
    fine.simTime,
    SPAN_SECONDS,
    SIM_DIGITS,
    `the simulation time ${FINE_FRAMES} frames worth ${SPAN_SECONDS / FINE_FRAMES} s ` +
      `each accumulated`,
  );

  // The witness moved at all, so "the same tile" is a reading rather than a
  // tautology: at level 1 a step is WORM_STEP_L1 (0.14 s), and even a build
  // seven times slower than that takes one inside a second.
  assertNotEqual(
    fine.head,
    `${WORM_C},${WORM_R}`,
    `the head tile after ${SPAN_SECONDS} s of game time, which is the tile it ` +
      `was posed on — a step is WORM_STEP_L1 (${WORM_STEP_L1} s) at level 1 ` +
      `(specs/worm.md), so a second carries the worm off it`,
  );

  assertEqual(
    coarse.head,
    fine.head,
    `the head tile after the same ${SPAN_SECONDS} s spent as ` +
      `${COARSE_FRAMES} frame, against the tile it reached spent as ` +
      `${FINE_FRAMES} — the step clock carries its remainder, so both ` +
      `divisions run the same number of steps (specs/worm.md)`,
  );
});

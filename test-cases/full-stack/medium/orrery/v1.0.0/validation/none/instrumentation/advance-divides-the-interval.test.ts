// instrumentation/advance-divides-the-interval — an interval of game time is run as
// the frames it was divided into, each worth its share, at the call.
//
// THE RULE. "`advance(seconds, frames)` — Runs `frames` whole frames covering
// `seconds` of game time, each worth `seconds / frames`, immediately and in order.
// `frames` is a whole number of at least `1` and defaults to `1`"
// (`specs/instrumentation.md`, The clock, under no engine). Under either engine the
// engine's scripted clock covers an interval the same way, and the property behind
// both is the render-free core's: "an interval of game time reaches the same
// state however it was divided into frames."
//
// THE FOUR THINGS THAT SENTENCE CLAIMS, AND HOW EACH IS READ.
//
//   `frames` whole frames — the frame counter moves by exactly the number asked
//     for, and by no more: a build that ran a frame of its own beside them, or
//     that batched the interval into one, is caught here.
//   each worth `seconds / frames` — the whole interval reaches `simTime`, and the
//     same interval delivered as that many SEPARATE one-frame calls of
//     `seconds / frames` each moves the run by exactly a frame's share of cycles,
//     `SPEEDS[sim.speed] * seconds / frames`, and lands where the whole interval
//     lands: the cycles a second covers, and the mote carried across them.
//   in order — those separate calls are read between each other, and each one
//     has moved the run further than the last by that share.
//   immediately — the state has moved by the time the call returns, with nothing
//     awaited and no real time allowed to pass.
//
// AN INTERVAL NAMED WITH NO DIVISION IS COVERED BY ONE FRAME, which is the
// observable half of "defaults to `1`": one frame, worth the whole of the interval.
// The parameter's own default value sits behind each project's harness and is not
// reachable from a suite that must read the same under an engine, where the
// specification puts no `advance` on the surface at all.
//
// EVERY READING IS AGAINST THE SPECIFICATION'S FIGURES rather than against another
// pass: a second at the default speed is `SPEEDS[1]` cycles, which the tape
// `grab`, `rotate-cw`, `drop` fills exactly, so each way of covering it must
// leave `sim.cycle` at `3`, the fraction on the boundary, and the mote on
// `(0, 1)`.
//
// THE MACHINE MOVES, so none of this is decided by a still world: the shortest
// complete carrying cycle, with a mote in its gripper, over an interval long enough
// to carry it.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertNear,
  assertNotNull,
} from "../assert";
import { DEFAULT_SPEED_INDEX, FRACTION_TOLERANCE, SPEEDS } from "../constants";
import { at } from "../field";
import { BARE, CARRY_MACHINE } from "../fixtures";
import {
  captureReplay,
  createHarness,
  moteAt,
  openBareRun,
  spawnMote,
  type Harness,
  type OrrerySnapshot,
} from "../harness";

/** The interval under test, and the frames it is divided into. */
const SECONDS = 1;
const FRAMES = 4;

/** The hex the carried mote starts on, and where `rotate-cw` about (0, 0) lands it. */
const GRIPPED = at(1, 0);
const CARRIED_TO = at(0, 1);

/** The cycles a second covers at the speed a run opens at. */
const CYCLES = SPEEDS[DEFAULT_SPEED_INDEX];

/** The share of a cycle one frame of the divided interval is worth. */
const SHARE = (CYCLES * SECONDS) / FRAMES;

/** How far the run has got: whole cycles plus the fraction of the one in flight. */
function progress(snapshot: OrrerySnapshot): number {
  const sim = snapshot.sim;
  return (sim?.cycle ?? -1) + (sim?.fraction ?? 0);
}

/** Hold what one way of covering the second left to the figures the tape fixes. */
function assertReached(snapshot: OrrerySnapshot, how: string): void {
  assertNotNull(snapshot.sim, `the run is live after ${how}`);
  assertEqual(
    snapshot.sim?.status,
    "running",
    `and still running after ${how}`,
  );
  assertEqual(
    snapshot.sim?.cycle,
    CYCLES,
    `a second of game time is SPEEDS[sim.speed] cycles, ${how}`,
  );
  assertNear(
    snapshot.sim?.fraction ?? -1,
    0,
    FRACTION_TOLERANCE,
    `and lands on the boundary to the rounding of the fraction's sum, ${how}`,
  );
  assertEqual(
    moteAt(snapshot, CARRIED_TO)?.type,
    "sol",
    `and the interval really carried the mote: grab, rotate-cw, drop, ${how}`,
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** The carrying machine with a mote in its gripper, at the default speed. */
async function poseCarry(): Promise<void> {
  await openBareRun(h, { challenge: BARE, machine: CARRY_MACHINE });
  await spawnMote(h, GRIPPED, "sol");
}

it("runs the frames it is told, each worth its share, at the call", async () => {
  await poseCarry();
  const opened = await h.snapshot();
  const framesBefore = h.frame();
  const timeBefore = opened.simTime;

  await captureReplay(h, "advanced", () => h.advanceSeconds(SECONDS, FRAMES));

  // Immediately, and exactly the frames asked for.
  const divided = await h.snapshot();
  assertEqual(
    h.frame() - framesBefore,
    FRAMES,
    "the interval ran exactly the frames it was divided into, and no others",
  );
  assertNear(
    divided.simTime - timeBefore,
    SECONDS,
    FRACTION_TOLERANCE,
    "and those frames were worth the whole interval between them",
  );
  assertGreaterThan(
    progress(divided),
    progress(opened),
    "and the run had already moved by the time the call returned",
  );
  assertEqual(
    divided.sim?.speed,
    DEFAULT_SPEED_INDEX,
    "the run is at the speed the second's cycle count is read at",
  );
  assertReached(divided, "covered by four frames in one call");

  // The same interval, one frame of its share at a time, read between each.
  await poseCarry();
  const stepped: number[] = [progress(await h.snapshot())];
  for (let frame = 0; frame < FRAMES; frame += 1) {
    await h.advanceSeconds(SECONDS / FRAMES, 1);
    stepped.push(progress(await h.snapshot()));
  }
  const oneAtATime = await h.snapshot();

  for (const [i, reachedAt] of stepped.entries()) {
    if (i === 0) continue;
    assertGreaterThan(
      reachedAt,
      stepped[i - 1] ?? Number.POSITIVE_INFINITY,
      `frame ${String(i)} of the interval carried the run further than the read before it: the frames run in order`,
    );
    assertNear(
      reachedAt - (stepped[i - 1] ?? Number.NaN),
      SHARE,
      FRACTION_TOLERANCE,
      `and by exactly one frame's share, SPEEDS[sim.speed] * seconds / frames cycles`,
    );
  }
  assertReached(
    oneAtATime,
    "covered by four one-frame calls of a quarter each",
  );

  // An interval named with no division is covered by a single frame worth all of it.
  await poseCarry();
  const undividedFrom = h.frame();
  const undividedTime = (await h.snapshot()).simTime;
  await h.advanceSeconds(SECONDS);
  const undivided = await h.snapshot();
  assertEqual(
    h.frame() - undividedFrom,
    1,
    "an interval given no division runs one frame",
  );
  assertNear(
    undivided.simTime - undividedTime,
    SECONDS,
    FRACTION_TOLERANCE,
    "worth the whole of it",
  );
  assertReached(undivided, "covered by one frame worth the whole second");
});

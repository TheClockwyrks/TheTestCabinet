// instrumentation/advance-divides-the-interval — an interval of game time is run as
// the frames it was divided into, each worth its share, at the call.
//
// THE RULE. "`advance(seconds, frames)` — Runs `frames` whole frames covering
// `seconds` of game time, each worth `seconds / frames`, immediately and in order.
// `frames` is a whole number of at least `1` and defaults to `1`"
// (`specs/instrumentation.md`, The clock, under no engine). Under either engine the
// engine's scripted clock covers an interval the same way, and the property behind
// both is the deterministic core's: "an interval of game time reaches the same
// state however it was divided into frames."
//
// THE FOUR THINGS THAT SENTENCE CLAIMS, AND HOW EACH IS READ.
//
//   `frames` whole frames — the frame counter moves by exactly the number asked
//     for, and by no more: a build that ran a frame of its own beside them, or
//     that batched the interval into one, is caught here.
//   each worth `seconds / frames` — the whole interval reaches `simTime`, and the
//     same interval delivered as that many SEPARATE one-frame calls of
//     `seconds / frames` each reaches the same state, which is the share spelled
//     out one frame at a time.
//   in order — those separate calls are read between each other, and each one
//     has moved the run further than the last.
//   immediately — the state has moved by the time the call returns, with nothing
//     awaited and no real time allowed to pass.
//
// AN INTERVAL NAMED WITH NO DIVISION IS COVERED BY ONE FRAME, which is the
// observable half of "defaults to `1`": one frame, worth the whole of the interval.
// The parameter's own default value sits behind each project's harness and is not
// reachable from a suite that must read the same under an engine, where the
// specification puts no `advance` on the surface at all.
//
// THE MACHINE MOVES, so none of this is decided by a still world: the shortest
// complete carrying cycle, with a mote in its gripper, over an interval long enough
// to carry it.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertNear,
  assertNotNull,
} from "../assert";
import { FRACTION_TOLERANCE, SPEEDS } from "../constants";
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

/** How far the run has got: whole cycles plus the fraction of the one in flight. */
function progress(snapshot: OrrerySnapshot): number {
  const sim = snapshot.sim;
  return (sim?.cycle ?? -1) + (sim?.fraction ?? 0);
}

/** What the interval left behind, in the terms the specification says are identical. */
function reached(snapshot: OrrerySnapshot): unknown {
  const sim = snapshot.sim;
  return {
    status: sim?.status,
    cycle: sim?.cycle,
    motes: (sim?.motes ?? [])
      .map((mote) => ({ q: mote.q, r: mote.r, type: mote.type }))
      .sort((a, b) => a.q - b.q || a.r - b.r || a.type.localeCompare(b.type)),
    poses: (sim?.poses ?? []).map((pose) => ({
      rotation: pose.rotation,
      length: pose.length,
      cell: pose.cell,
    })),
    grips: (sim?.grips ?? []).length,
    tallies: sim?.tallies,
    area: sim?.area,
  };
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
  assertNotNull(divided.sim, "the run is live");
  assertEqual(
    divided.sim?.cycle,
    SPEEDS[divided.sim?.speed ?? 0],
    "a second of game time is SPEEDS[sim.speed] cycles, however it was divided",
  );
  assertEqual(
    moteAt(divided, CARRIED_TO)?.type,
    "sol",
    "and the interval really carried the mote: grab, rotate-cw, drop",
  );

  // The same interval, one frame of its share at a time, read between each.
  await poseCarry();
  const stepped: number[] = [];
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
      `frame ${i + 1} of the interval carried the run further than frame ${i}: the frames run in order`,
    );
  }
  assertDeepEqual(
    reached(oneAtATime),
    reached(divided),
    "four frames of a quarter each, run one call at a time, reach what one call of four frames reached",
  );
  assertNear(
    oneAtATime.sim?.fraction ?? -1,
    divided.sim?.fraction ?? -2,
    FRACTION_TOLERANCE,
    "and the fraction agrees to the rounding of its sum",
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
  assertDeepEqual(
    reached(undivided),
    reached(divided),
    "and it reaches the state the divided interval reached",
  );
});

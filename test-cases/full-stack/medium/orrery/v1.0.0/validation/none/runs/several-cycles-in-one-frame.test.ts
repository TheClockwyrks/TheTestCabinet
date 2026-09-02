// runs/several-cycles-in-one-frame — one frame may carry the run across many
// boundaries, and each of the cycles it crossed runs in full and in order.
//
// THE RULE. "A frame may complete several cycles; each runs in full, in order"
// (`specs/simulation.md`, Cycles and the clock). The rate that puts several cycles
// inside one frame is the sentence above it: "an update advances the fraction by
// `SPEEDS[sim.speed] * dt` cycles ... and `SPEEDS` is `[1, 3, 10, 30]` cycles per
// second". At step `3` that is `30` cycles in one second of game time, so a single
// frame one second long crosses thirty boundaries.
//
// THE FIRST CONFIGURATION reads "each runs in full". A piston at `(0, 0)`, rest
// length `ARM_MIN_LEN` (`1`), on the tape `extend, extend, retract, retract` —
// period `4`, and "`extend`, `retract` | The piston's length changes by one"
// (`specs/simulation.md`, Motion and carrying), bounded by `ARM_MIN_LEN` (`1`) and
// `ARM_MAX_LEN` (`3`) so no cycle of it ever faults. Thirty cycles is seven and a
// half turns of that tape: cycles `28` and `29` are its two `extend` cells, so a
// run that really executed all thirty ends at length `3`. A build that ran ONE
// cycle inside the frame ends at length `2`, and one that ran none ends at `1`.
// The field is empty and the machine holds nothing else, so nothing but the
// piston's own length can move.
//
// THE SECOND CONFIGURATION reads "and a fault due on the fifth stops the run on
// the fifth". A piston on the tape `blank, blank, extend, extend, extend`: cycles
// `0` and `1` rest, since "A blank cell is a rest on every part ... and never
// faults"; cycle `2` takes it to `2` and cycle `3` to `3`; cycle `4` is `extend` at
// `ARM_MAX_LEN`, which `specs/simulation.md` raises as `overextended`. All five
// cycles fall inside one second at step `3`.
//
// THE VERDICT. The first frame leaves `sim.cycle` at `30` with the piston at
// length `3`; the second leaves `sim.status` `faulted`, the fault `overextended`,
// and the run stopped on the fifth cycle rather than carrying on through the
// twenty-five the frame's remaining time would have covered — which is what the
// piston's length shows, since a run that swept past the fault would have gone on
// retracting and extending.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear, assertNotNull } from "../assert";
import {
  ARM_MAX_LEN,
  ARM_MIN_LEN,
  FRACTION_TOLERANCE,
  SPEEDS,
} from "../constants";
import { armPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureReplay,
  createHarness,
  openBareRun,
  partIds,
  poseOf,
  type Harness,
} from "../harness";

/** The fastest step: `SPEEDS[3]` is 30 cycles per second. */
const FASTEST = 3;

/** One second of game time, which at the fastest step is `SPEEDS[3]` cycles. */
const ONE_SECOND = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("runs all thirty cycles of one frame, and stops on the fifth when the fifth faults", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("piston", ORIGIN.q, ORIGIN.r, 0, ARM_MIN_LEN, [
        "extend",
        "extend",
        "retract",
        "retract",
      ]),
    ]),
    speed: FASTEST,
  });
  const looping = (await partIds(h))[0] ?? -1;

  const opened = await h.snapshot();
  assertEqual(
    opened.sim?.speed,
    FASTEST,
    `the run is set to step ${FASTEST}, where SPEEDS[${FASTEST}] is ${SPEEDS[FASTEST]} cycles per second`,
  );
  assertEqual(
    poseOf(opened, looping)?.length,
    ARM_MIN_LEN,
    "the piston starts the run at its rest length, ARM_MIN_LEN",
  );

  const swept = await captureReplay(h, "burst", async () => {
    await h.advanceSeconds(ONE_SECOND, 1);
    return h.snapshot();
  });

  assertNotNull(
    swept.sim,
    "the run is still live after the frame that swept it",
  );
  assertEqual(
    swept.sim?.cycle,
    SPEEDS[FASTEST],
    `one frame of ${ONE_SECOND} second at step ${FASTEST} completes all ${SPEEDS[FASTEST]} cycles`,
  );
  assertNear(
    swept.sim?.fraction ?? -1,
    0,
    FRACTION_TOLERANCE,
    "the frame's span landed exactly on a boundary, so nothing is carried past it",
  );
  assertEqual(
    poseOf(swept, looping)?.length,
    ARM_MAX_LEN,
    "cycles 28 and 29 are the tape's two extend cells, so every cycle the frame covered ran in full",
  );

  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("piston", ORIGIN.q, ORIGIN.r, 0, ARM_MIN_LEN, [
        null,
        null,
        "extend",
        "extend",
        "extend",
      ]),
    ]),
    speed: FASTEST,
  });
  const doomed = (await partIds(h))[0] ?? -1;

  await h.advanceSeconds(ONE_SECOND, 1);

  const stopped = await h.snapshot();
  assertNotNull(
    stopped.sim,
    "the run is still live after the frame that faulted it",
  );
  assertEqual(
    stopped.sim?.status,
    "faulted",
    "the fifth cycle extends a piston already at ARM_MAX_LEN, which faults",
  );
  assertEqual(
    stopped.sim?.fault?.kind,
    "overextended",
    "extend on a piston already at ARM_MAX_LEN raises overextended",
  );
  assertEqual(
    poseOf(stopped, doomed)?.length,
    ARM_MAX_LEN,
    "the run stopped on the fifth cycle, with the piston as the fourth left it",
  );
});

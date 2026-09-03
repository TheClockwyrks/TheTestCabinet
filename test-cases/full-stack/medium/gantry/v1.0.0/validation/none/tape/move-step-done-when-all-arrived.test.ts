// tape/move-step-done-when-all-arrived — a move step stays live until every one of
// its axes has arrived, so the faster axis does not carry the tape on.
//
// `specs/program.md` § The tape: "The step's commands run together, and the step is
// done when every one of its axes has arrived and stopped." § The tick pipeline
// gives the reading it lands on: "a live move step whose axes have all arrived
// completes... If no step is live, this tick takes the next one", and `specs/state.md`
// has `stepLive` be "whether the step at `stepIndex` has been taken and is not yet
// complete. A move step is live from the tick that issues its commands until the
// tick that finds every one of its axes arrived."
//
// TWO AXES THAT ARRIVE MANY TICKS APART. The step turns the grip four degrees and
// the slew ninety. `specs/program.md` § Axis motion gives the grip
// `GRIP_ACCEL` (`90`) deg/s², so four degrees is a ramp up and straight back down
// inside a fifth of a second, while ninety degrees at `SLEW_MAX_RATE` (`30`) deg/s
// takes over four. So there is a long stretch of the run in which one of the step's
// two axes is done and the other is not — which is exactly the state a build that
// completed a step on its FIRST arrival cannot produce.
//
// THE CHECK READS THAT STRETCH AND THEN ITS END. First, at a tick where the grip
// has arrived and the slew is still driving: the step index is still the first
// step's and the step is still live. Then, once the slew has arrived too: one more
// tick, and the run has moved on to the second step, which is the tick the pipeline
// says takes it — "the step is found complete at the top of the tick after".
//
// A SECOND STEP FOLLOWS, so "moved on" is a reading rather than an ending: with the
// tape exhausted the run would end instead, and the step index would reach the
// tape's length for a different reason (`specs/state.md`).
//
// The crane is the harness's minimal one and the yard is empty: nothing here
// concerns a load.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertNull, assertTrue } from "../assert";
import {
  GRIP_MAX_RATE,
  HOIST_MAX_RATE,
  HOIST_START,
  SLEW_MAX_RATE,
  TICK_HZ,
} from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runTicks,
  runUntil,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** The quick axis: a ramp up and straight back down, a few ticks. */
const GRIP_TARGET = 4;

/** The slow axis: over four seconds of run clock. */
const SLEW_TARGET = 90;

const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [
      { axis: "grip", target: GRIP_TARGET, rate: GRIP_MAX_RATE },
      { axis: "slew", target: SLEW_TARGET, rate: SLEW_MAX_RATE },
    ],
  },
  {
    kind: "move",
    commands: [
      { axis: "hoist", target: HOIST_START + 1, rate: HOIST_MAX_RATE },
    ],
  },
];

/** The grip's four degrees are a fraction of a second. */
const GRIP_CAP = 2 * TICK_HZ;

/** Ninety degrees at 30 deg/s, with a ramp at each end. */
const SLEW_CAP = 10 * TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds the step live until the slower of its two axes has arrived", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);
  await startRun(h);

  const half = await runUntil(
    h,
    (s) =>
      s.run.phase !== "running" ||
      (s.run.stepLive && s.run.axes.grip.command === null),
    GRIP_CAP,
    "the grip, the quicker of the step's two axes, to arrive",
  );
  assertEqual(
    half.run.phase,
    "running",
    "the phase while the step's slower axis is still driving",
  );
  assertNull(
    half.run.axes.grip.command,
    "the grip's live command once it arrived (specs/program.md)",
  );
  assertNotNull(
    half.run.axes.slew.command,
    "the slew's live command, which is still driving while the grip is done",
  );
  assertEqual(
    half.run.stepIndex,
    0,
    "the step the run is on while one of its two axes is still driving " +
      "(specs/program.md)",
  );
  assertTrue(
    half.run.stepLive,
    "the step is live: it is done only when EVERY one of its axes has " +
      "arrived and stopped (specs/program.md)",
  );

  const arrived = await runUntil(
    h,
    (s) =>
      s.run.phase !== "running" ||
      (s.run.stepLive && s.run.axes.slew.command === null),
    SLEW_CAP,
    "the slew, the slower of the step's two axes, to arrive",
  );
  assertEqual(
    arrived.run.stepIndex,
    0,
    "the step the run is on at the top of the tick the slower axis arrived on",
  );

  const next = await runTicks(h, 1);
  await h.capture("state", "The driven state this point decides");
  assertEqual(
    next.run.stepIndex,
    1,
    "the step the run takes on the tick after every one of the first step's " +
      "axes arrived (specs/program.md)",
  );
});

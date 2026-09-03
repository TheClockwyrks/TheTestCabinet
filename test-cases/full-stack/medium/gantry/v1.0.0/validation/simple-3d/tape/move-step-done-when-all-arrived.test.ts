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
// TWO AXES THAT ARRIVE MANY TICKS APART. The step turns the grip one degree and
// the slew four. `specs/program.md` § Axis motion gives the grip `GRIP_ACCEL`
// (`90`) deg/s², so one degree is a ramp up and straight back down in
// `2 * sqrt(1 / 90)` seconds — some thirteen ticks — while four degrees under
// `SLEW_ACCEL` (`30`) takes `2 * sqrt(4 / 30)`, some forty-four. So there is a
// stretch of thirty ticks in which one of the step's two axes is done and the
// other is not — which is exactly the state a build that completed a step on its
// FIRST arrival cannot produce.
//
// BOTH TARGETS ARE THE SMALLEST THAT LEAVE THAT STRETCH UNMISTAKABLE. What the
// rule turns on is that the step outlives the quicker axis, not how far either
// axis travelled, so driving ninety degrees of slew to reach the same reading
// spends four seconds of run clock on nothing the point decides.
//
// THE CHECK READS THAT STRETCH AND THEN ITS END. First, at the tick the grip
// arrives on: the step index is still the first step's and the step is still
// live. The run is then carried in one batch to a tick still well inside the
// slew's travel, and swept a tick at a time from there to the tick the slew
// arrives on — where the step index is still `0`. Then one more tick, and the run
// has moved on to the second step, which is the tick the pipeline says takes it —
// "the step is found complete at the top of the tick after".
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
} from "../constants";
import {
  createHarness,
  emptyYard,
  openSite,
  poseTape,
  runTicks,
  runUntil,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** The quick axis: a ramp up and straight back down, some thirteen ticks. */
const GRIP_TARGET = 1;

/** The slow axis: some forty-four ticks, thirty of them after the grip is done. */
const SLEW_TARGET = 4;

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

/** The grip's one degree is a fifth of a second; this bounds a build that hangs. */
const GRIP_CAP = 40;

/**
 * The tick the batched carry stops at, comfortably inside the slew's travel.
 *
 * The grip is done by some thirteen and the slew arrives at some forty-four, so
 * a stop at thirty is past the one and well short of the other whichever end of
 * that stretch a conformant build lands on.
 */
const MIDWAY_TICK = 30;

/** From MIDWAY_TICK to the slew's arrival, with room for a build that hangs. */
const SLEW_CAP = 40;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds the step live until the slower of its two axes has arrived", async () => {
  await openSite(h, 0);
  // The YARD alone, rather than the whole world: the crane pose below empties
  // the structure itself, and a site opens with an empty tape
  // (`specs/state.md`), so there is nothing else here to clear.
  await emptyYard(h);
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

  // The stretch between the two arrivals is carried in one batch: every tick of
  // it is the same reading already taken, so it is driven rather than sampled.
  const midway = await runTicks(h, Math.max(0, MIDWAY_TICK - half.run.tick));
  assertEqual(
    midway.run.stepIndex,
    0,
    `the step the run is on ${MIDWAY_TICK} ticks in, with the grip long since ` +
      "arrived and the slew still driving (specs/program.md)",
  );
  assertTrue(
    midway.run.stepLive,
    `the step is still live ${MIDWAY_TICK} ticks in (specs/program.md)`,
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

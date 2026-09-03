// tape/failed-run-leaves-the-scene-as-it-stood — a failed run stands exactly as
// its failing tick left it.
//
// `specs/program.md` § Starting and ending a run: "A failed run stays on the run
// screen with its cause read out and the scene as it stood, so the player reads
// what went wrong before going back to edit." `specs/state.md` § The idle run and
// a finished one says the same from the state's side: "A run that ends is left as
// it ended until the next one starts: its verdict, its cause, its clock, and its
// broken list stay readable". Frames keep coming — the loop runs whatever the
// screen — and none of them may move the scene.
//
// THE SCENE IS MADE WORTH READING BEFORE IT IS FROZEN. The run drives the trolley
// to the far end of the track and pays the cable in, so the axes stand away from
// the run-start posture `specs/program.md` fixes; a heavy crate is hung on the
// hook, so the bob's mass and the load's phase are not the start's either; and
// the crate's weight then takes the tie that holds the rail's tip past its
// capacity, so the failing tick breaks a member and the broken list is not empty.
// `specs/statics.md` gives what follows: the tie carries the cable force at the
// far end, "every member whose utilization exceeds `1` breaks", both solves then
// "run again at the same tick, over the members still intact", and the tip left
// with only members lying in one plane is a mechanism, which ends the run as
// `collapse`.
//
// THE HOOK IS STILLED FIRST. Driving the trolley out sets the hook swinging, and
// a swinging cable pulls with less than the weight it carries, so `setBob` and
// `setBobVelocity` hang it at rest under the pivot the drive left — "the
// pendulum's own constraint runs on the next tick either way"
// (`specs/instrumentation.md`) — and a couple of ticks pass before the crate goes
// on, so the tick that overloads the crane is one the cable hangs straight on.
//
// THE LOAD IS HUNG WITH A POSE RATHER THAN AN ATTACH STEP. `setLoadPhase` to
// `"attached"` "hangs that load on the hook exactly as a successful `attach`
// leaves it, without the candidate search and without the `attach-missed`
// verdict" (`specs/instrumentation.md`) — a precondition, with the failure that
// follows left to the run's own rules.
//
// TWO SECONDS OF FRAMES THEN PASS, and every figure is read again: the four axes,
// the bob, the loads and the broken list, along with the tick the run stopped on.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNotEqual } from "../assert";
import {
  GRIP_MAX_RATE,
  HOIST_MAX_RATE,
  HOIST_MIN,
  HOIST_START,
  TICK_HZ,
  TROLLEY_MAX_RATE,
} from "../constants";
import {
  addOneLoad,
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runTicks,
  runUntil,
  standMinimalCrane,
  startRun,
  type GantrySnapshot,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** The far end of the minimal crane's four-unit track. */
const TROLLEY_TARGET = 4;

/** Heavy enough to take the tip's tie past its capacity, light enough to hang. */
const LOAD_MASS = 200;

/** Where the crate stands in the yard; the pose is not what hangs it. */
const FROM = { x: 8, y: 2, z: 0, yaw: 0 };
const TO = { x: -6, y: 2, z: 0, yaw: 0 };

/** Drive out and pay in, then turn the grip: a step that outlives the reading. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [
      { axis: "trolley", target: TROLLEY_TARGET, rate: TROLLEY_MAX_RATE },
      { axis: "hoist", target: HOIST_MIN, rate: HOIST_MAX_RATE },
    ],
  },
  {
    kind: "move",
    commands: [{ axis: "grip", target: 720, rate: GRIP_MAX_RATE }],
  },
];

/** Ticks the sweep is given: four units of track take about a hundred and twenty. */
const CAP = 400;

/** Ticks the hook is left hanging still before the crate is hung on it. */
const SETTLE = 2;

/** Frames driven after the failure: two seconds of them. */
const AFTER = 2 * TICK_HZ;

/** Everything the failing tick left, as one comparable string. */
function scene(s: GantrySnapshot): string {
  return JSON.stringify({
    phase: s.run.phase,
    cause: s.run.cause,
    tick: s.run.tick,
    axes: s.run.axes,
    bob: s.run.bob,
    attached: s.run.attached,
    loads: s.run.loads,
    broken: s.run.broken,
  });
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds the axes, the bob, the loads and the broken list a failure left", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await addOneLoad(h, "crate", LOAD_MASS, FROM, TO);
  await poseTape(h, TAPE);
  await startRun(h);

  const driven = await runUntil(
    h,
    (s) => s.run.stepIndex === 1,
    CAP,
    "the run to drive the trolley out and pay the cable in",
  );

  // Hang the hook dead still under the pivot the drive left, so what the cable
  // pulls with is the crate's weight rather than the swing the drive started.
  // `setBob` "puts the bob where it is asked for", and the pendulum's own
  // constraint runs on the next tick either way (`specs/instrumentation.md`).
  const pivot = driven.run.pivot;
  await h.debug.setBob(pivot.x, pivot.y - driven.run.axes.hoist.value, pivot.z);
  await h.debug.setBobVelocity(0, 0, 0);
  await runTicks(h, SETTLE);

  await h.debug.setLoadPhase(0, "attached");
  const failed = await runTicks(h, 1);

  await h.capture("state", "The scene the failing tick left");

  assertEqual(
    failed.run.phase,
    "failed",
    "the run after the tick the hung crate overloaded the crane on",
  );
  assertGreaterThan(
    failed.run.broken.length,
    0,
    "the members the failing tick broke, so the broken list read again below " +
      "is one with something in it (specs/statics.md)",
  );
  assertNotEqual(
    failed.run.axes.trolley.value,
    0,
    "the trolley on the failing tick, against the `0` a run starts it at, so " +
      "the axes read again below stand away from the run-start posture",
  );
  assertNotEqual(
    failed.run.axes.hoist.value,
    HOIST_START,
    "the hoist on the failing tick, against the HOIST_START a run starts it at",
  );

  const stood = scene(failed);
  const later = await runTicks(h, AFTER);

  assertEqual(
    scene(later),
    stood,
    `the run's axes, bob, loads and broken list after ${AFTER} further ` +
      "frames: a failed run is left as its failing tick left it " +
      "(specs/program.md, specs/state.md)",
  );
});

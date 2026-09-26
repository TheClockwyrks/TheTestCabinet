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
// THE SCENE IS MADE WORTH READING BEFORE IT IS FROZEN. The trolley is POSED at
// the far end of the track and the cable POSED paid in, so the axes stand away
// from the run-start posture `specs/program.md` fixes; a heavy crate is hung on
// the hook, so the bob's mass and the load's phase are not the start's either; and
// the crate's weight then takes the tie that holds the rail's tip past its
// capacity, so the failing tick breaks a member and the broken list is not empty.
// `specs/statics.md` gives what follows: the tie carries the cable force at the
// far end, "every member whose utilization exceeds `1` breaks", both solves then
// "run again at the same tick, over the members still intact", and the tip left
// with only members lying in one plane is a mechanism, which ends the run as
// `collapse`.
//
// THE POSTURE IS POSED RATHER THAN DRIVEN. `setAxis` "takes any value the axis can
// hold" and is a precondition like every other pose (`specs/instrumentation.md`);
// what this check is about is what a run does AFTER it has failed, so the two
// seconds of ramping that a trolley move would spend reaching the same posture
// decide nothing here. The tape commands neither of the two axes posed — it turns
// the grip, which "applies no force to anything" (`specs/rigging.md`) — so nothing
// posed is fighting a live command.
//
// THE HOOK IS STILLED FIRST. Moving the pivot leaves the hook hanging off the
// vertical, and a swinging cable pulls with less than the weight it carries, so
// `setBob` and `setBobVelocity` hang it at rest under the pivot the pose left —
// "the pendulum's own constraint runs on the next tick either way"
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
import { GRIP_MAX_RATE, HOIST_MIN, HOIST_START, TICK_HZ } from "../constants";
import {
  addOneLoad,
  createHarness,
  emptyYard,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type GantrySnapshot,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** The far end of the minimal crane's four-unit track. */
const TROLLEY_TARGET = 4;

/** The minimal crane's track, and so its pivot, stands at `y = 4`. */
const PIVOT_Y = 4;

/** Heavy enough to take the tip's tie past its capacity, light enough to hang. */
const LOAD_MASS = 200;

/** Where the crate stands in the yard; the pose is not what hangs it. */
const FROM = { x: 8, y: 2, z: 0, yaw: 0 };
const TO = { x: -6, y: 2, z: 0, yaw: 0 };

/** Turn the grip: a step that outlives the reading and pulls on nothing. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "grip", target: 720, rate: GRIP_MAX_RATE }],
  },
];

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
  await emptyYard(h);
  await standMinimalCrane(h);
  await addOneLoad(h, "crate", LOAD_MASS, FROM, TO);
  await poseTape(h, TAPE);
  await startRun(h);

  await h.debug.setAxis("trolley", TROLLEY_TARGET);
  await h.debug.setAxis("hoist", HOIST_MIN);
  // The hook goes with the trolley, dead still. A pose moves the pivot at the
  // call, and a bob left where the old pivot had it would be a cable's length out
  // of place — which the pendulum's constraint would answer on the next tick with
  // a lurch the cable is not meant to carry. So the bob is hung under the pivot
  // the posed posture puts it under, at rest, before any tick runs.
  await h.debug.setBob(TROLLEY_TARGET, PIVOT_Y - HOIST_MIN, 0);
  await h.debug.setBobVelocity(0, 0, 0);

  // One tick, so `run.pivot` — "the point the cable hangs from at the most recent
  // tick's geometry" (`specs/instrumentation.md`) — is the posed posture's, and
  // the hook is re-hung under the pivot the BUILD reports rather than the one this
  // check computed. `setBob` "puts the bob where it is asked for", and the
  // pendulum's own constraint runs on the next tick either way.
  const posed = await runTicks(h, 1);
  const pivot = posed.run.pivot;
  await h.debug.setBob(pivot.x, pivot.y - posed.run.axes.hoist.value, pivot.z);
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

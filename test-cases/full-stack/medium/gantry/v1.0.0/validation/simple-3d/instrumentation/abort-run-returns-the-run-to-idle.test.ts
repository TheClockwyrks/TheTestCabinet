// instrumentation/abort-run-returns-the-run-to-idle — an abort ends a run with no
// verdict.
//
// `specs/instrumentation.md` § The run and the screens: `abortRun` "Poses the
// abort, ending a running run with no verdict: `run` goes back to its idle
// placeholder". `specs/state.md` fixes what that placeholder is — "phase `idle`,
// no cause, a zero tick, step index, and speed index, no live step, the four axes
// at the run-start posture `specs/program.md` fixes with no command and zero rate,
// a zero pivot, a bob at the origin with zero velocity, no attachment, and an
// empty load, force, and broken list" — and names the abort as one of the three
// things that put it back.
//
// The abort has to land on a run that has moved, or an idle reading afterwards
// would say nothing: the minimal crane runs a tape that drives the hoist, and the
// abort comes a few ticks in, with the clock past zero and the hoist under way. A
// few is all it takes — a run that has taken one tick is a run in progress, and
// the placeholder an abort puts back is the same one whenever it lands, so ticks
// past the first buy the reading nothing. Only what `run` carries is read; the
// screen the abort returns to is its own point.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertNull,
} from "../assert";
import { HOIST_MAX_RATE, HOIST_START } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type AxisName,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** A move long enough that thirty ticks land in the middle of it. */
const SHORT_TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [
      { axis: "hoist", target: HOIST_START + 2, rate: HOIST_MAX_RATE },
    ],
  },
];

const TICKS = 4;

/** The run-start posture `specs/program.md` fixes, per axis. */
const START_POSTURE: Readonly<Record<AxisName, number>> = {
  slew: 0,
  trolley: 0,
  hoist: HOIST_START,
  grip: 0,
};

const ORIGIN = { x: 0, y: 0, z: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("puts the idle placeholder back when a run in progress is aborted", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, SHORT_TAPE);
  await startRun(h);

  const running = await runTicks(h, TICKS);
  assertEqual(
    running.run.phase,
    "running",
    `the run after ${TICKS} ticks, which is what abortRun applies to`,
  );
  assertGreaterThan(
    running.run.tick,
    0,
    "the ticks the run had taken when the abort landed",
  );

  await h.debug.abortRun();
  const { run } = await h.snapshot();

  await h.advance(1);
  await h.capture("state", "The driven state this point decides");

  assertEqual(run.phase, "idle", "the phase an abort leaves");
  assertNull(
    run.cause,
    "the cause an abort leaves: none, an abort has no verdict",
  );
  assertEqual(run.tick, 0, "the tick an abort leaves");
  assertEqual(run.time, 0, "the run clock an abort leaves");
  assertEqual(run.speedIndex, 0, "the speed index an abort leaves");
  assertEqual(run.stepIndex, 0, "the step index an abort leaves");
  assertEqual(run.stepLive, false, "the live step an abort leaves");
  for (const axis of ["slew", "trolley", "hoist", "grip"] as const) {
    const view = run.axes[axis];
    assertEqual(
      view.value,
      START_POSTURE[axis],
      `the ${axis} value an abort leaves: the run-start posture`,
    );
    assertEqual(view.rate, 0, `the ${axis} rate an abort leaves`);
    assertNull(view.command, `the ${axis} command an abort leaves`);
  }
  assertDeepEqual(run.pivot, ORIGIN, "the pivot an abort leaves");
  assertDeepEqual(run.bob.pos, ORIGIN, "the bob position an abort leaves");
  assertDeepEqual(run.bob.vel, ORIGIN, "the bob velocity an abort leaves");
  assertNull(run.attached, "the attachment an abort leaves");
  assertLength(run.loads, 0, "the load entries an abort leaves");
  assertLength(run.forces, 0, "the force entries an abort leaves");
  assertLength(run.broken, 0, "the broken list an abort leaves");
});

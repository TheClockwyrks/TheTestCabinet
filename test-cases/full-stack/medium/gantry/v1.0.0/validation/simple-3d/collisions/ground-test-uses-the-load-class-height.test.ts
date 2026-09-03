// collisions/ground-test-uses-the-load-class-height — the ground test subtracts
// the load's OWN class height.
//
// specs/statics.md § Collisions: "An attached load whose box dips below the
// ground, its lift point's `y` minus its class height falling below `0`, ends the
// run as `load-struck-ground`." specs/world.md § Loads gives the two heights the
// figure is read from: a `crate` is `2 x 2 x 2` and a `drum` is `2 x 3 x 2`, and
// "a load resting on the ground therefore has its lift point at `y` equal to its
// class height".
//
// ONE LIFT POINT, TWO CLASSES, OPPOSITE VERDICTS. The bob is held at `y = 2.5`
// directly below the minimal crane's pivot at `(0, 4, 0)`, on a cable of `1.5`,
// and the pendulum holds a bob that hangs straight down at rest exactly there
// (specs/rigging.md § The pendulum tick). At that one lift point the crate's
// bottom face is at `+0.5` and the drum's is at `-0.5`, so a build reading the
// carried load's own class height clears one and fails the other, while a build
// reading a fixed height — or the lift point itself — treats them alike. That is
// why both halves run here and why nothing but the class changes between them:
// the same crane, the same tape, the same mass, the same pose.
//
// THE CRATE GOES FIRST, so the run that must survive is watched for a full second
// before the run that must fail is posed. The crate's run is then aborted rather
// than left to end, which returns the build screen and takes the yard back
// (specs/instrumentation.md § The run and the screens); the tape and the
// structure are untouched by a run (specs/program.md).

import { afterEach, beforeEach, it } from "vitest";
import { assertClose, assertEqual, assertNull } from "../assert";
import { GRIP_MAX_RATE, LOAD_CLASS_DIMENSIONS } from "../constants";
import {
  addOneLoad,
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type Harness,
  type LoadClass,
  type TapeStepSpec,
} from "../harness";

/** The one lift point both classes are held at. */
const LIFT_Y = 2.5;

/** The minimal crane's pivot at the run-start posture, and the cable it needs. */
const PIVOT = { x: 0, y: 4, z: 0 } as const;
const CABLE = PIVOT.y - LIFT_Y;

/** Ticks the surviving run is watched for: one second of run clock. */
const WINDOW = 60;

/** A tape that turns the grip and moves nothing that carries the load. */
const HOLD: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "grip", target: 360, rate: GRIP_MAX_RATE }],
  },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Hang one load of `cls` at the shared lift point, and run `ticks` ticks. */
async function hangAndRun(cls: LoadClass, count: number) {
  await addOneLoad(
    h,
    cls,
    40,
    { x: PIVOT.x, y: LIFT_Y, z: PIVOT.z, yaw: 0 },
    { x: PIVOT.x, y: LIFT_Y, z: PIVOT.z, yaw: 0 },
  );
  await startRun(h);
  await h.debug.setLoadPhase(0, "attached");
  await h.debug.setAxis("hoist", CABLE);
  await h.debug.setBob(PIVOT.x, LIFT_Y, PIVOT.z);
  await h.debug.setBobVelocity(0, 0, 0);
  return runTicks(h, count);
}

it("clears a crate and sinks a drum held at the one lift point", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, HOLD);

  const crate = await hangAndRun("crate", WINDOW);
  await h.capture("crate", "The crate at the same lift point, clear");
  assertClose(
    crate.run.bob.pos.y,
    LIFT_Y,
    1e-6,
    "the lift point the pendulum held the crate at (specs/rigging.md)",
  );
  assertNull(
    crate.run.cause,
    `the failure cause after ${WINDOW} ticks carrying a crate at y ${LIFT_Y}: ` +
      `its class height is ${LOAD_CLASS_DIMENSIONS.crate.y}, so the figure ` +
      "tested against 0 is +0.5 (specs/statics.md, specs/world.md)",
  );
  assertEqual(
    crate.run.phase,
    "running",
    `the run after ${WINDOW} ticks carrying a crate at y ${LIFT_Y}`,
  );

  await h.debug.abortRun();
  const drum = await hangAndRun("drum", 1);
  await h.capture("drum", "The drum's box below the yard floor");
  assertEqual(
    drum.run.phase,
    "failed",
    `the run carrying a drum at the same y ${LIFT_Y}: its class height is ` +
      `${LOAD_CLASS_DIMENSIONS.drum.y}, so the figure tested against 0 is ` +
      "-0.5 (specs/statics.md, specs/world.md)",
  );
  assertEqual(
    drum.run.cause,
    "load-struck-ground",
    "the cause of a run ended by a drum whose lift point's y minus its own " +
      "class height fell below 0 (specs/statics.md)",
  );
});

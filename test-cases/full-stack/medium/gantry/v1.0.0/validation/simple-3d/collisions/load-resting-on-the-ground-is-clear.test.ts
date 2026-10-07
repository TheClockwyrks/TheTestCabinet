// collisions/load-resting-on-the-ground-is-clear — a load whose bottom face rests
// exactly on `y = 0` is on the ground rather than through it.
//
// specs/statics.md § Collisions: "An attached load whose box dips below the
// ground, its lift point's `y` minus its class height falling below `0`, ends the
// run as `load-struck-ground`. ... A load whose bottom face rests exactly on
// `y = 0` is on the ground, not through it." The figure tested is a strict one,
// so the boundary itself belongs on the clear side, and that is the one direction
// this check decides.
//
// THE SCENARIO IS THE BOUNDARY, HELD EXACTLY. A crate's class height is `2`
// (specs/world.md § Loads), so a lift point at `y = 2` puts the tested figure at
// exactly `0`. The minimal crane's pivot stands at `(0, 4, 0)` and a run starts
// with `hoist` at HOIST_START (`2`), so the bob already hangs at `(0, 2, 0)`: the
// crate is hung there through `setLoadPhase`, the bob is put back at rest
// directly below the pivot, and the pendulum holds a bob that hangs straight down
// at rest exactly there (specs/rigging.md § The pendulum tick — gravity's drift
// is radial, so the constraint puts it back and the constraint velocity step
// takes the radial velocity away). The figure therefore rests ON the boundary for
// every tick of the window rather than crossing it, which is what makes a clear
// run mean what it says.
//
// THE TAPE TURNS THE GRIP AND NOTHING ELSE. A run needs a tape, and the other
// three axes all move the pivot or the cable and would carry the lift point off
// the boundary. The grip turns the hook and the load's yaw with it and "applies
// no force to anything" (specs/rigging.md § The grip), so the height under test
// is untouched; `360` degrees at GRIP_MAX_RATE is eight seconds of run, well past
// the two-second window, so the tape cannot end the run inside it either.

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
  type TapeStepSpec,
} from "../harness";

/** The lift point that puts a crate's bottom face on the ground exactly. */
const RESTING_Y = LOAD_CLASS_DIMENSIONS.crate.y;

/** The minimal crane's pivot at the run-start posture, and its cable. */
const PIVOT = { x: 0, y: 4, z: 0 } as const;
const CABLE = PIVOT.y - RESTING_Y;

/** Ticks the load is held on the boundary for: half a second of run clock. */
const WINDOW = 30;

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

it("carries a load whose bottom face sits on y 0 without striking the ground", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await addOneLoad(
    h,
    "crate",
    40,
    { x: PIVOT.x, y: RESTING_Y, z: PIVOT.z, yaw: 0 },
    { x: PIVOT.x, y: RESTING_Y, z: PIVOT.z, yaw: 0 },
  );
  await poseTape(h, HOLD);
  await startRun(h);

  await h.debug.setLoadPhase(0, "attached");
  await h.debug.setAxis("hoist", CABLE);
  await h.debug.setBob(PIVOT.x, RESTING_Y, PIVOT.z);
  await h.debug.setBobVelocity(0, 0, 0);

  const s = await runTicks(h, WINDOW);
  await h.capture("resting", "The crate resting on the yard floor");

  assertNull(
    s.run.cause,
    `the failure cause after ${WINDOW} ticks carrying a crate whose lift ` +
      `point is held at y ${RESTING_Y}, its bottom face on y 0: the ground ` +
      "test is the lift point's y minus the class height falling BELOW 0, " +
      "and a load resting exactly on the ground is not through it " +
      "(specs/statics.md)",
  );
  assertEqual(
    s.run.phase,
    "running",
    `the run after ${WINDOW} ticks with the crate resting on the ground`,
  );
  // The scenario's own guard: a pass means nothing unless the lift point really
  // stayed on the boundary the whole way.
  assertClose(
    s.run.bob.pos.y,
    RESTING_Y,
    1e-6,
    "the lift point the pendulum held, directly below the pivot at the " +
      "cable's length (specs/rigging.md)",
  );
});

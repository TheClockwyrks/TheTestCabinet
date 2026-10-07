// collisions/load-strikes-the-ground — an attached load whose box dips below the
// ground ends the run.
//
// specs/statics.md § Collisions: "An attached load whose box dips below the
// ground, its lift point's `y` minus its class height falling below `0`, ends the
// run as `load-struck-ground`."
//
// THE POSE PUTS THE FIGURE JUST PAST THE BOUNDARY. A crate's class height is `2`
// (specs/world.md § Loads), so a lift point at `y = 1.9` puts the tested figure
// at `-0.1`: the bottom face is a tenth of a unit under the yard floor, which is
// below and nothing else. A tenth is far enough to be no rounding and small
// enough that the check is about the rule rather than about a load buried in the
// ground.
//
// THE PIVOT AND THE CABLE HOLD IT THERE. The minimal crane's pivot stands at
// `(0, 4, 0)`, so a cable of `2.1` with the bob directly below it holds the lift
// point at `1.9`, and the pendulum leaves a bob hanging straight down at rest
// exactly where it is (specs/rigging.md § The pendulum tick). One tick is all
// this needs: the collision stage runs on every tick (specs/program.md § The tick
// pipeline), so the first one to run over the posed geometry is the one that must
// end the run.
//
// AND THE YARD IS EMPTY OF OBSTACLES, so the only body the load can meet is the
// ground and the cause names it without ambiguity.

import { afterEach, beforeEach, it } from "vitest";
import { assertClose, assertEqual } from "../assert";
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

/** The lift point held: a tenth of a unit below a resting crate's. */
const SUNK_Y = LOAD_CLASS_DIMENSIONS.crate.y - 0.1;

/** The minimal crane's pivot at the run-start posture, and the cable it needs. */
const PIVOT = { x: 0, y: 4, z: 0 } as const;
const CABLE = PIVOT.y - SUNK_Y;

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

it("ends the run as load-struck-ground when the carried box dips below y 0", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await addOneLoad(
    h,
    "crate",
    40,
    { x: PIVOT.x, y: SUNK_Y, z: PIVOT.z, yaw: 0 },
    { x: PIVOT.x, y: SUNK_Y, z: PIVOT.z, yaw: 0 },
  );
  await poseTape(h, HOLD);
  await startRun(h);

  await h.debug.setLoadPhase(0, "attached");
  await h.debug.setAxis("hoist", CABLE);
  await h.debug.setBob(PIVOT.x, SUNK_Y, PIVOT.z);
  await h.debug.setBobVelocity(0, 0, 0);

  const s = await runTicks(h, 1);
  await h.capture("through", "The crate's bottom face below the yard floor");

  // The guard first: the tick must have run over the geometry this check posed.
  assertClose(
    s.run.bob.pos.y,
    SUNK_Y,
    1e-6,
    "the lift point the tick's rigging left, directly below the pivot at the " +
      "cable's length (specs/rigging.md)",
  );
  assertEqual(
    s.run.phase,
    "failed",
    `the run after one tick with the crate's lift point at y ${SUNK_Y}, its ` +
      "bottom face at y -0.1 (specs/statics.md)",
  );
  assertEqual(
    s.run.cause,
    "load-struck-ground",
    "the cause of a run ended by an attached load whose lift point's y minus " +
      "its class height fell below 0 (specs/statics.md)",
  );
});

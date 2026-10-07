// collisions/load-box-hangs-its-full-height-below-the-lift-point — the box the
// obstacle test uses hangs the load's WHOLE CLASS HEIGHT below the lift point.
//
// `specs/world.md` § Loads fixes where the box stands: "Every load pose in this
// specification is the pose of the load's lift point: the center of its top face
// ... The load's box extends half its width and half its depth horizontally from
// the lift point, rotated by its yaw, and ITS FULL HEIGHT BELOW IT." The drum is
// the tall class, `2 x 3 x 2`, so its box reaches three units down.
// `specs/statics.md` § Collisions is what spends that: "An attached load whose
// box, at its current position and yaw, reaches inside an obstacle ends the run as
// `load-struck-obstacle`."
//
// So the body under test is the hanging box and not the lift point, and this check
// is the vertical half of that: a build that tested the lift point, or a box
// centered on it, reads this scenario as clear.
//
// THE LIFT POINT STANDS ABOVE THE OBSTACLE AND THE BOX REACHES INSIDE IT. The
// obstacle is the block `x -2..-0.25`, `y 0..2.5`, `z -0.5..0.5`, whose top is
// `y 2.5`; the drum hangs with its lift point at `(0, 3.5, 0)`, one unit clear
// above that top. Its box is then `x -1..1`, `y 0.5..3.5`, `z -1..1`: the lower
// two units of it stand strictly inside the block's `y` range, its plan overlaps
// the block's on both horizontal axes, and the run ends.
//
// AND IT IS THE OBSTACLE THAT ENDS IT, not the ground and not the crane. The box's
// bottom face stands at `y 0.5`, half a unit above the ground, so
// `load-struck-ground` is not in play (`specs/statics.md`: a load's box dips below
// the ground when "its lift point's `y` minus its class height" falls below `0`).
// The obstacle stands wholly at `x < 0` and every part of the crane at `x >= 0`,
// so no member's segment reaches inside it; the tape turns the grip and nothing
// else, so the arm never moves and the lift point, straight below a still pivot,
// stands where the pendulum leaves it (`specs/rigging.md`).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  addOneLoad,
  addOneObstacle,
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

/** The cable length that hangs the lift point at {@link LIFT} under the pivot. */
const HOIST = 0.5;

/** The drum's lift point: one unit above the block's top face at `y 2.5`. */
const LIFT = { x: 0, y: 3.5, z: 0 };

/** The block `x -2..-0.25`, `y 0..2.5`, `z -0.5..0.5`. */
const OBSTACLE_MIN = { x: -2, y: 0, z: -0.5 };
const OBSTACLE_SIZE = { x: 1.75, y: 2.5, z: 1 };

/** The slowest legal turn of the grip: it holds the run open and moves nothing. */
const HOLD_RATE = 0.001;
const HOLD_TAPE: readonly TapeStepSpec[] = [
  { kind: "move", commands: [{ axis: "grip", target: 360, rate: HOLD_RATE }] },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("ends the run for a drum whose lift point clears an obstacle and whose box does not", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await addOneLoad(
    h,
    "drum",
    60,
    { x: 10, y: 3, z: 0, yaw: 0 },
    { x: -10, y: 3, z: 0, yaw: 0 },
  );
  await addOneObstacle(h, OBSTACLE_MIN, OBSTACLE_SIZE);
  await poseTape(h, HOLD_TAPE);

  await startRun(h);
  await h.debug.setLoadPhase(0, "attached");
  await h.debug.setAxis("hoist", HOIST);
  await h.debug.setBob(LIFT.x, LIFT.y, LIFT.z);
  await h.debug.setBobVelocity(0, 0, 0);

  const struck = await runTicks(h, 1);

  await h.capture(
    "hanging",
    "The drum's lower box inside the block, its lift point above it",
  );

  // The scenario the requirement is about: the lift point itself is clear of the
  // block, so only a box that hangs its full class height below it reaches in.
  assertGreaterThan(
    struck.run.loads[0]?.pos.y ?? Number.NaN,
    OBSTACLE_MIN.y + OBSTACLE_SIZE.y,
    "the drum's lift point against the block's top face, which it stands above",
  );
  assertEqual(
    struck.run.phase,
    "failed",
    "the run with the drum's box (y 0.5..3.5) reaching inside the block " +
      "(y 0..2.5) it hangs into, though its lift point stands a unit above it " +
      "(specs/world.md)",
  );
  assertEqual(
    struck.run.cause,
    "load-struck-obstacle",
    "the cause a carried load reaching inside an obstacle ends the run with " +
      "(specs/statics.md)",
  );
});

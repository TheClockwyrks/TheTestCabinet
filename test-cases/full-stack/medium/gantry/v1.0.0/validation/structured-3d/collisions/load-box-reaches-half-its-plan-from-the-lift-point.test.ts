// collisions/load-box-reaches-half-its-plan-from-the-lift-point — the box the
// obstacle test uses reaches HALF THE CLASS WIDTH and half the class depth
// horizontally from the lift point.
//
// `specs/world.md` § Loads: "The load's box EXTENDS HALF ITS WIDTH AND HALF ITS
// DEPTH HORIZONTALLY FROM THE LIFT POINT, rotated by its yaw, and its full height
// below it." The crate is `2 x 2 x 2`, so its box reaches exactly `1` from the
// lift point on each horizontal axis. `specs/statics.md` § Collisions is what
// spends that: "An attached load whose box, at its current position and yaw,
// reaches inside an obstacle ends the run as `load-struck-obstacle`."
//
// This is the horizontal half of that reach, and its own point: a build that
// tested the lift point alone, or a box narrower than the class, reads this
// scenario as clear. The vertical half — the box hanging its full height below the
// lift point — is a separate check.
//
// THE LIFT POINT STANDS OUTSIDE THE BLOCK AND THE CRATE'S SIDE STANDS INSIDE IT.
// The block is `x -3..-0.9`, `y 0..4`, `z -1..1`, so its near face is at
// `x = -0.9`. The crate hangs with its lift point at `(0, 2.5, 0)`, `0.9` from
// that face — nearer than the `1` that is half its width — so the lift point is
// outside the block by `0.9` while the box's own side reaches `x -1`, a tenth of a
// unit strictly inside it. Its `y 0.5..2.5` and `z -1..1` overlap the block's on
// both remaining axes, so the run ends.
//
// THE YARD HOLDS THIS SCENARIO AND NOTHING ELSE. `addOneLoad` clears the site's
// loads before it adds its own, `addOneObstacle` clears its obstacles, and
// `standMinimalCrane` empties the structure before it poses one, so nothing the
// site was authored with is standing when the run starts.
//
// AND IT IS THE OBSTACLE THAT ENDS IT. The box's bottom face stands at `y 0.5`,
// clear of the ground. The block stands wholly at `x < 0` and every part of the
// crane at `x >= 0`, so no member's segment reaches inside it; the tape turns the
// grip at the slowest legal rate and nothing else, so the arm never moves, the
// yaw stays at `0` to a ten-thousandth of a degree, and the lift point, straight
// below a still pivot, stands where the pendulum leaves it (`specs/rigging.md`).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  addOneLoad,
  addOneObstacle,
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
const HOIST = 1.5;

/** The crate's lift point: `0.9` from the block's face, half a width being `1`. */
const LIFT = { x: 0, y: 2.5, z: 0 };

/** The block `x -3..-0.9`, `y 0..4`, `z -1..1`. */
const OBSTACLE_MIN = { x: -3, y: 0, z: -1 };
const OBSTACLE_SIZE = { x: 2.1, y: 4, z: 2 };

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

it("ends the run for a crate whose lift point clears an obstacle and whose side does not", async () => {
  await openSite(h, 0);
  await standMinimalCrane(h);
  await addOneLoad(
    h,
    "crate",
    40,
    { x: 10, y: 2, z: 0, yaw: 0 },
    { x: -10, y: 2, z: 0, yaw: 0 },
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
    "clipped",
    "The crate's side inside the block with its lift point outside",
  );

  // The scenario the requirement is about: the lift point itself stands outside
  // the block, so only a box reaching half a width from it can strike.
  assertGreaterThan(
    struck.run.loads[0]?.pos.x ?? Number.NaN,
    OBSTACLE_MIN.x + OBSTACLE_SIZE.x,
    "the crate's lift point against the block's face at x -0.9, which it " +
      "stands outside",
  );
  assertEqual(
    struck.run.phase,
    "failed",
    "the run with the crate's box reaching to x -1, a tenth of a unit inside " +
      "the block's face at x -0.9, though its lift point stands at x 0 " +
      "(specs/world.md)",
  );
  assertEqual(
    struck.run.cause,
    "load-struck-obstacle",
    "the cause a carried load reaching inside an obstacle ends the run with " +
      "(specs/statics.md)",
  );
});

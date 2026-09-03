// collisions/member-over-an-obstacle-is-clear — a member that sweeps across an
// obstacle's plan while standing above its top reaches inside nothing.
//
// `specs/world.md` § Obstacles: "a body meets an obstacle when some point of the
// body lies inside the box, strictly between the box's minimum and its maximum ON
// ALL THREE AXES." `specs/statics.md` § Collisions is what a run does with that:
// "A member whose segment reaches inside an obstacle ends the run as
// `structure-struck-obstacle`. Members standing clear at build time can sweep into
// an obstacle as the arm turns; the test catches them tick by tick."
//
// ALL THREE AXES is the requirement here, in the direction that matters most for
// playing the game: an arm has to be able to swing over a block. A build that
// tested the plan alone — the `x` and `z` of a member against the `x` and `z` of a
// box — ends every such run the moment the arm crosses the block's footprint, and
// no site with an obstacle could be cleared. That is why the cap is `broken`.
//
// THE GEOMETRY. The obstacle is the block `x 2.5..4`, `y 0..3`, `z 2..4`, and the
// arm sweeps a quarter turn over it. Every arm member of the minimal crane runs
// between nodes at `y = 4` and `y = 8`, and `specs/statics.md` fixes that the slew
// turns a node about the vertical axis and leaves its `y` alone ("`y' = y`"), so
// no point of the arm ever stands below `y = 4` — a whole unit above the block's
// top at `y = 3` — however far the arm turns. The tower stands still at `x <= 2`
// and `z <= 2`, outside the block's `x` and `z` ranges. So nothing can ever be
// inside the block, and the run must survive the whole sweep.
//
// AND THE SWEEP REALLY DOES CROSS THE PLAN, which the check reads rather than
// assumes: at each tick it turns the rail's far node `(4, 4, 0)` by the slew value
// the run reports, with the formula `specs/statics.md` gives, and requires that
// the point stands inside the block's `x` and `z` ranges on at least one of them.
// Without that a build that simply never turned the arm would pass.
//
// THE YARD HOLDS NOTHING ELSE: no load, so the bare hook is tested against the
// ground alone and hangs a clear two units above it, and no second obstacle.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull, assertTrue } from "../assert";
import { LATTICE_PITCH, SLEW_MAX_RATE } from "../constants";
import {
  addOneObstacle,
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runUntil,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** The block `x 2.5..4`, `y 0..3`, `z 2..4`: the arm's plan crosses it. */
const OBSTACLE_MIN = { x: 2.5, y: 0, z: 2 };
const OBSTACLE_SIZE = { x: 1.5, y: 3, z: 2 };

/** The minimal crane's rail tip, the arm node that reaches furthest out. */
const TIP = { x: 4, y: 4, z: 0 };

/** A quarter turn of the arm at its maximum rate. */
const SWEEP = 90;
const TAPE: readonly TapeStepSpec[] = [
  { kind: "move", commands: [{ axis: "slew", target: SWEEP, rate: SLEW_MAX_RATE }] },
];

/** A quarter turn at `SLEW_MAX_RATE` takes four seconds of run clock. */
const CAP = 900;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises nothing while the arm sweeps across an obstacle's plan above its top", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await addOneObstacle(h, OBSTACLE_MIN, OBSTACLE_SIZE);
  await poseTape(h, TAPE);

  const started = await startRun(h);
  const ring = started.structure.ring;
  assertTrue(ring !== null, "the slew ring the arm turns on (specs/structure.md)");

  // The slew axis: "the vertical line through the flange square's center",
  // half a lattice pitch out from the ring's base corner on each horizontal axis.
  const axisX = (ring?.corner.x ?? 0) + LATTICE_PITCH / 2;
  const axisZ = (ring?.corner.z ?? 0) + LATTICE_PITCH / 2;

  let crossedThePlan = false;
  const swept = await runUntil(
    h,
    (s) => {
      // `specs/statics.md` § Geometry at a tick: an arm node placed at (x, y, z)
      // stands at x' = ax + (x - ax) cos - (z - az) sin, z' = az + (x - ax) sin +
      // (z - az) cos, with theta the slew value in radians.
      const theta = (s.run.axes.slew.value * Math.PI) / 180;
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      const dx = TIP.x - axisX;
      const dz = TIP.z - axisZ;
      const x = axisX + dx * cos - dz * sin;
      const z = axisZ + dx * sin + dz * cos;
      if (
        x > OBSTACLE_MIN.x &&
        x < OBSTACLE_MIN.x + OBSTACLE_SIZE.x &&
        z > OBSTACLE_MIN.z &&
        z < OBSTACLE_MIN.z + OBSTACLE_SIZE.z
      ) {
        crossedThePlan = true;
      }
      return (
        s.run.phase !== "running" ||
        s.run.axes.slew.value >= SWEEP - 1e-9
      );
    },
    CAP,
    "the arm to finish its quarter turn, or the run to end",
  );

  await h.capture("over", "The arm standing over the obstacle mid-sweep");

  assertTrue(
    crossedThePlan,
    "the rail's far node to stand inside the block's x and z ranges on some " +
      "tick of the sweep, so the run really did carry the arm over it",
  );
  assertEqual(
    swept.run.phase,
    "running",
    "the run across a quarter turn whose arm members all stand at y >= 4, a " +
      "unit above the block's top at y 3, so no point of any of them is ever " +
      "strictly inside the box on all three axes (specs/world.md)",
  );
  assertNull(
    swept.run.cause,
    "the cause of a sweep in which nothing reached inside the obstacle",
  );
});

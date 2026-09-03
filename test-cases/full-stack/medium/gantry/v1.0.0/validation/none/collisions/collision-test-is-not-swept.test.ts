// collisions/collision-test-is-not-swept — a body that crosses an obstacle between
// two ticks is not caught.
//
// `specs/statics.md` § Collisions fixes the test's extent as well as its cadence:
// "Collisions are tested ONCE PER TICK, AT THE PRESCRIBED GEOMETRY." The
// prescribed geometry is one arrangement of the crane, the one this tick's axes
// produce (`specs/statics.md` § Geometry at a tick, `specs/program.md` § The tick
// pipeline), and nothing in the specification sweeps a volume between one tick's
// arrangement and the next. So a member that is clear at one tick and clear at the
// next reaches inside nothing, however the two arrangements are joined up.
//
// This is the other half of the tick-by-tick requirement, and its own point: a
// build that swept the motion between ticks ends runs the specification says
// continue, and does it more often the faster the arm turns.
//
// THE JUMP IS MADE THE WAY THE SURFACE MAKES ONE. `specs/instrumentation.md`:
// "`setAxis(axis, value)` | Sets an axis's value, leaving it stopped with no live
// command", and every pose "establishes a precondition and never an outcome". So
// the slew is posed from `-3` to `3` between two ticks and the arm's geometry
// stands at those two angles and never between them.
//
// THE OBSTACLE IS A LEAF ACROSS THE ARM'S PATH: the box `x 3.98..4.02`,
// `y 3.6..4.4`, `z -0.03..0.03`. At the build pose — slew `0`, the angle the jump
// steps over — the rail's far node stands at its lattice position `(4, 4, 0)`,
// which is strictly inside that box on all three axes. Three degrees either side
// of it the whole arm is clear of the box: it is set at the very radius the rail
// tip reaches, so only points within a whisker of the tip can be in it at all, and
// three degrees carries the tip a tenth of a unit past a box four hundredths of a
// unit thick. The check computes both tick geometries from the rotation
// `specs/statics.md` states and requires that each stands the node outside the box
// while the straight line between them runs through it, so the scenario really is
// the one the requirement names.
//
// SIX DEGREES, NOT NINETY, and the reason is the cable: `specs/rigging.md` drives
// the bob from the pivot, and jumping the arm a quarter turn would whip the pivot
// far enough in one tick to snap the hoist cable, ending the run before the
// collision stage on a rule that is not this one. A jump of six degrees moves the
// pivot a seventh of a unit, and the bob is stilled beneath it first, so the only
// stage that can end this run is the one under test. The yard holds no load, so
// the bare hook is tested against the ground alone and hangs two units above it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull, assertTrue } from "../assert";
import { LATTICE_PITCH } from "../constants";
import {
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

/** The box `x 3.98..4.02`, `y 3.6..4.4`, `z -0.03..0.03`. */
const OBSTACLE_MIN = { x: 3.98, y: 3.6, z: -0.03 };
const OBSTACLE_SIZE = { x: 0.04, y: 0.8, z: 0.06 };

/** The minimal crane's rail tip, the arm node the box is set at the radius of. */
const TIP = { x: 4, y: 4, z: 0 };

/** The two angles the arm stands at, one on each side of the build pose. */
const BEFORE = -3;
const AFTER = 3;

/** The slowest legal turn of the grip: it holds the run open and moves nothing. */
const HOLD_RATE = 0.001;
const HOLD_TAPE: readonly TapeStepSpec[] = [
  { kind: "move", commands: [{ axis: "grip", target: 360, rate: HOLD_RATE }] },
];

/** Ticks spent settling at the first angle before the jump. */
const SETTLE = 20;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises nothing when a member jumps from one side of an obstacle to the other", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await addOneObstacle(h, OBSTACLE_MIN, OBSTACLE_SIZE);
  await poseTape(h, HOLD_TAPE);

  const started = await startRun(h);
  const ring = started.structure.ring;
  assertTrue(ring !== null, "the slew ring the arm turns on (specs/structure.md)");

  // "the vertical line through the flange square's center" (specs/structure.md).
  const axisX = (ring?.corner.x ?? 0) + LATTICE_PITCH / 2;
  const axisZ = (ring?.corner.z ?? 0) + LATTICE_PITCH / 2;
  const turned = (degrees: number): { x: number; z: number } => {
    const theta = (degrees * Math.PI) / 180;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const dx = TIP.x - axisX;
    const dz = TIP.z - axisZ;
    return {
      x: axisX + dx * cos - dz * sin,
      z: axisZ + dx * sin + dz * cos,
    };
  };
  const inside = (at: { x: number; z: number }): boolean =>
    at.x > OBSTACLE_MIN.x &&
    at.x < OBSTACLE_MIN.x + OBSTACLE_SIZE.x &&
    at.z > OBSTACLE_MIN.z &&
    at.z < OBSTACLE_MIN.z + OBSTACLE_SIZE.z &&
    TIP.y > OBSTACLE_MIN.y &&
    TIP.y < OBSTACLE_MIN.y + OBSTACLE_SIZE.y;

  const first = turned(BEFORE);
  const second = turned(AFTER);
  assertTrue(
    !inside(first) && !inside(second),
    "the rail's far node standing outside the box at both of the two angles " +
      "the arm is posed at, so each tick's own geometry is clear",
  );
  assertTrue(
    inside({ x: (first.x + second.x) / 2, z: (first.z + second.z) / 2 }),
    "the straight line between those two positions running strictly inside " +
      "the box, so a swept test would catch what a per-tick test does not",
  );

  // The first angle is posed BEFORE the first tick, so no tick ever stands the
  // arm at the build pose, where the node sits inside the box.
  await h.debug.setAxis("slew", BEFORE);
  const before = await runTicks(h, SETTLE);
  assertEqual(before.run.axes.slew.value, BEFORE, "the angle the arm stands at");
  assertEqual(
    before.run.phase,
    "running",
    `the run at slew ${BEFORE}, where nothing reaches inside the box`,
  );
  await h.capture("before", "The arm on the near side of the obstacle");

  // The bob is stilled under its pivot so the jump's tug on the cable is the
  // smallest it can be: `setBob` "puts the bob where it is asked for", and the
  // constraint runs on the tick that follows (`specs/instrumentation.md`).
  await h.debug.setBob(
    before.run.pivot.x,
    before.run.pivot.y - before.run.axes.hoist.value,
    before.run.pivot.z,
  );
  await h.debug.setBobVelocity(0, 0, 0);

  await h.debug.setAxis("slew", AFTER);
  const after = await runTicks(h, 1);

  await h.capture("after", "The arm on the far side of the obstacle");

  assertEqual(after.run.axes.slew.value, AFTER, "the angle the arm jumped to");
  assertEqual(
    after.run.phase,
    "running",
    `the run after the arm was posed from slew ${BEFORE} to slew ${AFTER} in ` +
      "one step, standing clear of the box at both: collisions are tested once " +
      "per tick, at the prescribed geometry, over no swept volume " +
      "(specs/statics.md)",
  );
  assertNull(
    after.run.cause,
    "the cause of a run in which no tick's geometry reached inside anything",
  );
});

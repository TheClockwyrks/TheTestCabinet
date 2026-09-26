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
// arm sweeps over it. Every arm member of the minimal crane runs between nodes at
// `y = 4` and `y = 8`, and `specs/statics.md` fixes that the slew turns a node
// about the vertical axis and leaves its `y` alone ("`y' = y`"), so no point of
// the arm ever stands below `y = 4` — a whole unit above the block's top at
// `y = 3` — however far the arm turns. The tower stands still at `x <= 2` and
// `z <= 2`, outside the block's `x` and `z` ranges. So nothing can ever be inside
// the block, and the run must survive the sweep.
//
// THE ARM IS POSED AT THE EDGE OF THE CROSSING AND THEN DRIVEN INTO IT.
// `specs/instrumentation.md` gives `setAxis` as a precondition pose — "sets an
// axis's value, leaving it stopped with no live command" — so the run starts with
// the arm already at `START` degrees, a couple of degrees short of the angle at
// which the rail's far node first enters the block's plan, and the tape's own slew
// command carries it in from there. Nothing about the crossing is posed: the entry
// and every tick inside the plan are driven by the real controller and judged by
// the real collision stage. What the pose removes is the thirty-four degrees of
// empty yard the arm used to turn through before it reached the block, which
// decided nothing.
//
// AND THE SWEEP REALLY DOES CROSS THE PLAN, which the check reads rather than
// assumes: at each sample it turns the rail's far node `(4, 4, 0)` by the slew
// value the run reports, with the formula `specs/statics.md` gives, and requires
// that the point stands inside the block's `x` and `z` ranges on at least one of
// them. Without that a build that simply never turned the arm would pass.
//
// THE YARD HOLDS NOTHING ELSE: no load, so the bare hook is tested against the
// ground alone and hangs a clear two units above it, and no second obstacle.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertClose,
  assertEqual,
  assertNull,
  assertTrue,
  fail,
} from "../assert";
import { LATTICE_PITCH, SLEW_MAX_RATE, TICK_HZ } from "../constants";
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

/** The block `x 2.5..4`, `y 0..3`, `z 2..4`: the arm's plan crosses it. */
const OBSTACLE_MIN = { x: 2.5, y: 0, z: 2 };
const OBSTACLE_SIZE = { x: 1.5, y: 3, z: 2 };

/** The minimal crane's rail tip, the arm node that reaches furthest out. */
const TIP = { x: 4, y: 4, z: 0 };

/**
 * The arc the sweep is driven over, in degrees of slew.
 *
 * The rail tip turns on a circle about the slew axis at `(1, 1)` — half a lattice
 * pitch out from the ring's base corner on each horizontal axis — and it stands
 * inside the block's `x` and `z` ranges between `37` and `80` degrees. So the run
 * starts posed at `START`, clear of the plan on the near side, and is driven until
 * the arm has turned to `REACHED`, which is well inside it: the tick the arm
 * enters the block's plan and every tick it spends there are driven, which is the
 * whole of what this point is about. The tape's target stays past `REACHED` so the
 * axis is still under way rather than braking to a stop.
 */
const START = 34;
const REACHED = 60;
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "slew", target: 90, rate: SLEW_MAX_RATE }],
  },
];

/**
 * The cap on the sweep, in ticks.
 *
 * `SLEW_ACCEL` is `30` deg/s², so the axis takes a second to reach `SLEW_MAX_RATE`
 * and covers fifteen degrees doing it; the remaining eleven to `REACHED` cruise at
 * `30` deg/s. Ninety ticks is the honest figure and this leaves half as much again
 * for a build that ramps more gently than the controller does.
 */
const CAP = 140;

/** Ticks between samples: the crossing spans forty-three degrees of slew. */
const POLL = 8;

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
  assertTrue(
    ring !== null,
    "the slew ring the arm turns on (specs/structure.md)",
  );

  // The slew axis: "the vertical line through the flange square's center",
  // half a lattice pitch out from the ring's base corner on each horizontal axis.
  const axisX = (ring?.corner.x ?? 0) + LATTICE_PITCH / 2;
  const axisZ = (ring?.corner.z ?? 0) + LATTICE_PITCH / 2;

  // THE PRECONDITION: the run-start posture, turned. `setAxis` poses the arm at
  // START degrees, and the bob is posed where the run-start bob would hang once
  // the arm has turned that far — under the turned pivot, on a cable of exactly
  // the hoist axis's length, at rest, which is the posture specs/state.md gives a
  // run's start and specs/rigging.md keeps. Both halves are needed: the pivot is
  // read at the turned geometry from the tick after the pose (specs/state.md), so
  // an arm posed round without its bob leaves the cable stretched across the yard
  // and the first tick snaps it. Nothing about the crossing is posed — the arm is
  // still short of the block's plan here, and the tape's own command carries it
  // in.
  await h.debug.setAxis("slew", START);
  const posedTheta = (START * Math.PI) / 180;
  const pivot = {
    x:
      axisX +
      (started.run.pivot.x - axisX) * Math.cos(posedTheta) -
      (started.run.pivot.z - axisZ) * Math.sin(posedTheta),
    y: started.run.pivot.y,
    z:
      axisZ +
      (started.run.pivot.x - axisX) * Math.sin(posedTheta) +
      (started.run.pivot.z - axisZ) * Math.cos(posedTheta),
  };
  await h.debug.setBob(
    pivot.x,
    pivot.y - started.run.axes.hoist.value,
    pivot.z,
  );
  await h.debug.setBobVelocity(0, 0, 0);

  const posed = await h.snapshot();
  assertClose(
    posed.run.axes.slew.value,
    START,
    1e-6,
    `the slew axis posed to ${START} degrees before the tape's command is ` +
      "issued, which specs/instrumentation.md's `setAxis` establishes",
  );

  // The sweep is driven in strides and read at the end of each, rather than a
  // snapshot a tick: the crossing spans forty-odd degrees of slew and a stride
  // covers well under two, so every stride inside it is sampled several times
  // over. The collision stage still runs on EVERY tick of the stride — it is
  // "tested once per tick" (specs/statics.md) and a strike ends the run, which
  // the phase read at the end of the stride reports whichever tick it happened
  // on. What the stride saves is the crossing back into the page, not a tick.
  let crossedThePlan = false;
  let swept = started;
  for (let driven = 0; driven < CAP; driven += POLL) {
    swept = await runTicks(h, POLL);

    // `specs/statics.md` § Geometry at a tick: an arm node placed at (x, y, z)
    // stands at x' = ax + (x - ax) cos - (z - az) sin, z' = az + (x - ax) sin +
    // (z - az) cos, with theta the slew value in radians.
    const theta = (swept.run.axes.slew.value * Math.PI) / 180;
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
    if (swept.run.phase !== "running") break;
    if (swept.run.axes.slew.value >= REACHED) break;
  }
  await h.capture("over", "The arm standing over the obstacle mid-sweep");

  if (swept.run.phase === "running" && swept.run.axes.slew.value < REACHED) {
    fail(
      `the arm to turn from ${START} to ${REACHED} degrees within ${CAP} ` +
        `ticks (${(CAP / TICK_HZ).toFixed(2)}s of run clock), which the tape's ` +
        "slew command at SLEW_MAX_RATE reaches in ninety (specs/program.md)",
      `it stands at ${swept.run.axes.slew.value.toFixed(2)} degrees`,
    );
  }

  assertTrue(
    crossedThePlan,
    "the rail's far node to stand inside the block's x and z ranges on some " +
      "tick of the sweep, so the run really did carry the arm over it",
  );
  assertEqual(
    swept.run.phase,
    "running",
    `the run across a sweep from ${START} to ${REACHED} degrees whose arm ` +
      "members all stand at y >= 4, a unit above the block's top at y 3, so no " +
      "point of any of them is ever strictly inside the box on all three axes " +
      "(specs/world.md)",
  );
  assertNull(
    swept.run.cause,
    "the cause of a sweep in which nothing reached inside the obstacle",
  );
});

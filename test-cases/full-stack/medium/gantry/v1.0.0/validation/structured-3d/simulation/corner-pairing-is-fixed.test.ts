// simulation/corner-pairing-is-fixed — a ring corner pairs the same two nodes at
// every slew angle.
//
// specs/structure.md: "A corner pairs the same two nodes for the life of the crane.
// The top flange turns and the bottom flange does not, so a corner's two nodes
// stand over one another at slew `0` and not at a general slew angle; the pairing
// is the ring's, not a reading of where the nodes currently are." specs/statics.md
// says what crosses: "at each bottom-flange node, the negated reaction read at the
// top-flange node it shares a ring corner with ... The corner pairing is the
// ring's own and holds at every slew angle."
//
// The trolley begins every run at the track's origin, which here is the top-flange
// node `(2, 6, 0)`, and specs/statics.md applies the cable force at the trolley
// point and shares the trolley's mass "between the two nodes of the rail member the
// trolley is on ... at a shared node it belongs wholly to that node". So the whole
// of the cable force lands on one top-flange node, and the corner carries it to
// `(2, 4, 0)` — a bottom-flange corner braced by horizontals alone, whose vertical
// leg therefore reads the crossed load exactly.
//
// Hanging a load of mass 95 on the bare hook takes the cable force from
// `HOOK_MASS * GRAVITY` to `(HOOK_MASS + 95) * GRAVITY`, 950 force units more,
// with the bob posed at rest below the pivot so the cable pulls straight down
// (specs/rigging.md: "Hanging at rest this is the bob's weight, straight down").
// The reading is repeated at slew 0, 45, 90 and 180, and at every one of them the
// same leg must take the whole 950. A build that read the pairing off where the
// turned top flange currently stands would send it to a different leg at 90 and to
// the opposite corner at 180.
//
// THE ANGLE IS A PRECONDITION, SO IT IS POSED. Where the arm has been turned to is
// not what this check decides — what the ring does with a load once it is there is
// — so the slew is posed with `setAxis` rather than driven round by a tape. Driving
// it would put the axis controller, the tape executor and the ramp between a build
// and this point, and a build that turns its arm badly must fail those checks and
// pass this one. The bob is posed straight back under where the turn leaves the
// pivot in the same breath, so the pendulum's own pivot-velocity step
// (specs/rigging.md, step 5) takes the turn as the still hang it is rather than as
// a jolt. What is never posed is the reading: the solve that puts the load on the
// leg runs on the real ticks that follow every pose.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear, assertTrue } from "../assert";
import {
  GRAVITY,
  GRIP_MAX_RATE,
  HOIST_START,
  LATTICE_PITCH,
} from "../constants";
import {
  addOneLoad,
  clearAll,
  createHarness,
  openSite,
  poseCrane,
  poseTape,
  runTicks,
  startRun,
  type CraneDesign,
  type DesignMember,
  type Harness,
  type LatticeNode,
  type LoadPose,
  type TapeStepSpec,
  type Vec3,
} from "../harness";

/** The span a force in the hundreds is read to. */
const TOLERANCE = 1e-6;

/** The mass hung on the hook, and the extra cable force it makes. */
const LOAD_MASS = 95;
const EXTRA = LOAD_MASS * GRAVITY;

/** Where the load stands in the yard while it is off the hook. */
const YARD: LoadPose = { x: 20, y: 2, z: 0, yaw: 0 };

/** The bottom-flange corner the trolley's top-flange node is paired with. */
const CORNER = { x: 2, y: 4, z: 0 };

/** The track's origin, which is where the trolley stands at a run's start. */
const ORIGIN: Vec3 = { x: 2, y: 6, z: 0 };

/** The angles the reading is repeated at. */
const ANGLES = [0, 45, 90, 180] as const;

/**
 * Ticks run after each pose before the forces are read.
 *
 * Three, not one: the bob's acceleration for a tick is `(v - v_prev) / dt`
 * (specs/rigging.md), so the first tick after a pose is measured against whatever
 * the bob was doing before it. The ticks after that have a settled `v_prev`, the
 * acceleration is zero, and the cable force is the bob's weight straight down —
 * which is what makes the two readings differ by the hung load's weight and by
 * nothing else.
 */
const SETTLE = 3;

/** How far the posed turn may leave the pivot from where the build put it. */
const PLACED = 1e-6;

/**
 * The jib rig, mirrored in `x` so the corner under the track's origin is bare.
 *
 * The tower is the box between the site's four anchors and the ring's bottom
 * flange at `y = 4`, braced the way a cube on a fixed base has to be so the tower
 * solve is not a mechanism (specs/statics.md, "Singularity") — but with the three
 * inclined anchor braces and the flange diagonal placed so that `(2, 4, 0)` carries
 * its vertical leg and horizontal members alone. That is the bottom-flange node
 * the ring pairs with `(2, 6, 0)`, which is the track's origin and so where the
 * trolley stands at a run's start (specs/structure.md, specs/program.md). At such a
 * corner the leg is the only member with a vertical component, so its force is
 * exactly minus the whole vertical load applied at the node.
 *
 * The arm is a mast head at `(2, 10, 0)` braced back to three top-flange nodes, a
 * two-rail track running out along `+x` from `(2, 6, 0)`, and each outboard rail
 * node hung from the mast head by a cable and braced sideways to `(2, 6, 2)`.
 */
const RIG_MEMBERS: readonly DesignMember[] = [
  [[0, 0, 0], [0, 4, 0], "strut"],
  [[2, 0, 0], [2, 4, 0], "strut"],
  [[0, 0, 2], [0, 4, 2], "strut"],
  [[2, 0, 2], [2, 4, 2], "strut"],
  [[0, 4, 0], [2, 4, 0], "strut"],
  [[0, 4, 2], [2, 4, 2], "strut"],
  [[0, 4, 0], [0, 4, 2], "strut"],
  [[2, 4, 0], [2, 4, 2], "strut"],
  [[2, 4, 0], [0, 4, 2], "strut"],
  [[2, 0, 0], [0, 4, 0], "strut"],
  [[2, 0, 2], [0, 4, 2], "strut"],
  [[0, 0, 2], [0, 4, 0], "strut"],
  [[2, 6, 0], [2, 10, 0], "strut"],
  [[2, 10, 0], [2, 6, 2], "strut"],
  [[2, 10, 0], [0, 6, 2], "strut"],
  [[2, 10, 0], [0, 6, 0], "strut"],
  [[2, 6, 0], [4, 6, 0], "rail"],
  [[4, 6, 0], [6, 6, 0], "rail"],
  [[2, 10, 0], [4, 6, 0], "cable"],
  [[2, 10, 0], [6, 6, 0], "cable"],
  [[4, 6, 0], [2, 6, 2], "strut"],
  [[6, 6, 0], [2, 6, 2], "strut"],
];

const RING: LatticeNode = [0, 4, 0];

const RIG: CraneDesign = {
  site: 1,
  name: "Bare-corner jib rig",
  ring: RING,
  counterweights: [],
  members: RIG_MEMBERS,
  tape: [],
};

/**
 * The tape: one grip command long enough to outlast every reading.
 *
 * The run has to be in progress for the run poses to apply and for the solve to
 * run, and nothing else about the tape matters here — the grip "turns the load,
 * kinematically" and "applies no force to anything" (specs/rigging.md), so a grip
 * under way changes no member force this check reads.
 */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "grip", target: 100000, rate: GRIP_MAX_RATE }],
  },
];

/**
 * Where a node of the arm stands once the arm has turned `degrees`.
 *
 * The ring "turns the top flange about the slew axis by the slew angle and takes
 * the whole arm with it", and the slew axis is "the vertical line through the
 * flange square's centre" — the four nodes at the ring's base corner and one
 * lattice pitch along `x` and `z` from it (specs/structure.md). A positive yaw
 * "turns `+x` toward `+z`" (specs/world.md).
 */
function turned(node: Vec3, base: LatticeNode, degrees: number): Vec3 {
  const ax = base[0] + LATTICE_PITCH / 2;
  const az = base[2] + LATTICE_PITCH / 2;
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = node.x - ax;
  const dz = node.z - az;
  return {
    x: ax + dx * cos - dz * sin,
    y: node.y,
    z: az + dx * sin + dz * cos,
  };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("carries the trolley's cable force to the same bottom-flange leg at every slew angle", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await poseCrane(h, RIG);
  await addOneLoad(h, "crate", LOAD_MASS, YARD, YARD);
  await poseTape(h, TAPE);

  const { structure } = await h.snapshot();
  const leg = structure.members.find((m) => {
    const [low, high] = m.a.y < m.b.y ? [m.a, m.b] : [m.b, m.a];
    return (
      low.y === 0 &&
      high.x === CORNER.x &&
      high.y === CORNER.y &&
      high.z === CORNER.z &&
      low.x === CORNER.x &&
      low.z === CORNER.z
    );
  });
  if (leg === undefined) {
    throw new Error("gantry: the rig has no leg under (2, 4, 0)");
  }

  await startRun(h);

  /**
   * Hang the bob at rest below `pivot` and read the solve `SETTLE` ticks later.
   *
   * BOTH READINGS ARE TAKEN THE SAME WAY, from the same still hang over the same
   * number of ticks, so the only thing that differs between them is the mass on
   * the hook. A reading taken from a bob still carrying the last pose's motion
   * would tilt the cable, and the difference would no longer be the hung load's
   * weight and nothing else.
   */
  const readAtRest = async (pivot: Vec3, what: string) => {
    await h.debug.setBob(pivot.x, pivot.y - HOIST_START, pivot.z);
    await h.debug.setBobVelocity(0, 0, 0);
    const after = await runTicks(h, SETTLE);
    assertTrue(
      after.run.phase === "running",
      `the run still standing while ${what} is read (phase ` +
        `"${after.run.phase}", cause ${String(after.run.cause)})`,
    );
    return {
      run: after.run,
      forces: new Map(after.run.forces.map((f) => [f.id, f.force])),
    };
  };

  for (const angle of ANGLES) {
    // Turn the arm and hang the bob straight back under where that leaves the
    // pivot: a still hang at a new angle, which is the precondition this reading
    // needs, rather than a swing the turn threw.
    const pivot = turned(ORIGIN, RING, angle);
    await h.debug.setAxis("slew", angle);
    await h.debug.setBob(pivot.x, pivot.y - HOIST_START, pivot.z);
    await h.debug.setBobVelocity(0, 0, 0);
    const turnedTo = await runTicks(h, 1);

    const bare = await readAtRest(
      turnedTo.run.pivot,
      `the bare hook at slew ${angle} degrees`,
    );
    assertNear(
      bare.run.axes.slew.value,
      angle,
      1e-9,
      `the slew value the pose asked for (${angle} degrees)`,
    );
    assertTrue(
      Math.abs(bare.run.pivot.x - pivot.x) <= PLACED &&
        Math.abs(bare.run.pivot.z - pivot.z) <= PLACED,
      `the pivot at slew ${angle} degrees to stand where turning the track's ` +
        `origin about the ring's slew axis puts it, (${pivot.x.toFixed(3)}, ` +
        `${pivot.z.toFixed(3)}) in x and z — the ring "turns the top flange ` +
        "about the slew axis by the slew angle and takes the whole arm with " +
        'it" (specs/structure.md) and a positive yaw turns +x toward +z ' +
        `(specs/world.md). It stands at (${bare.run.pivot.x.toFixed(3)}, ` +
        `${bare.run.pivot.z.toFixed(3)})`,
    );

    await h.debug.setLoadPhase(0, "attached");
    const loaded = await readAtRest(
      bare.run.pivot,
      `the hung load at slew ${angle} degrees`,
    );

    for (const [id, force] of loaded.forces) {
      const was = bare.forces.get(id);
      if (was === undefined) continue;
      const expected = id === leg.id ? -EXTRA : 0;
      assertNear(
        force - was,
        expected,
        TOLERANCE,
        `at slew ${angle} degrees, member ${id}` +
          (id === leg.id
            ? ` — the leg under (${CORNER.x}, ${CORNER.y}, ${CORNER.z}), the ` +
              "corner the trolley's top-flange node is paired with — taking the " +
              `whole ${EXTRA} the hung load adds to the cable force`
            : " taking none of the load the corner carries down " +
              "(specs/structure.md: the pairing is the ring's own)"),
      );
    }

    if (angle === ANGLES[ANGLES.length - 1]) {
      await h.capture(
        "corner-pairing",
        "The rig at slew 180 with a load on the hook, the turned trolley's " +
          "load still crossing its own ring corner",
      );
      break;
    }

    // Off the hook and back in the yard, so the next angle is turned to with the
    // bare hook this reading starts from.
    await h.debug.setLoadPhase(0, "waiting");
    await h.debug.setLoadPose(0, YARD.x, YARD.y, YARD.z, YARD.yaw);
  }
});

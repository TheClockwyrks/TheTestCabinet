// simulation/cable-force-at-the-trolley-point — the cable force is applied at the
// trolley point and shared between the two rail nodes in the trolley's own
// proportion.
//
// specs/statics.md: "The trolley's `TROLLEY_MASS` sits at the trolley point and is
// shared between the two nodes of the rail member the trolley is on, linearly by
// its position along that member", and then: "The cable force from
// specs/rigging.md is applied at the trolley point and shared between the same two
// rail nodes the trolley's mass is." So a trolley standing a quarter of the way
// along its rail hands three quarters of the cable force to the near node and one
// quarter to the far one — the same split, at the same instant, as its own mass.
//
// The two nodes are read through their mast cables. At `(4, 6, 0)` and
// `(6, 6, 0)` the cable up to the mast head is the only member with a vertical
// component, so vertical equilibrium at each node fixes that cable's force at the
// node's whole vertical load divided by the cable's own `|n.y|` — a single-member
// reading that no load path or stiffness can move. Hanging a load of mass 95 on the
// hook adds `95 * GRAVITY` to the cable force and changes nothing else, so what
// each mast cable picks up is exactly its node's share.
//
// The trolley is posed rather than driven, and the bob is posed back under the
// pivot in the same breath: `setAxis` "sets an axis's value, leaving it stopped
// with no live command", so the trolley stands at exactly the position the split is
// computed from rather than wherever a controller happened to stop. Both readings
// are then taken with the bob hanging at rest, where specs/rigging.md makes the
// cable force "the bob's weight, straight down", so the only thing that differs
// between them is the mass on the hook.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear, assertTrue } from "../assert";
import { GRAVITY, GRIP_MAX_RATE, HOIST_START } from "../constants";
import {
  addOneLoad,
  createHarness,
  distance3,
  emptyYard,
  openSite,
  poseCrane,
  poseTape,
  runTicks,
  startRun,
  type CraneDesign,
  type DesignMember,
  type Harness,
  type TapeStepSpec,
  type Vec3,
} from "../harness";

/** The span a force in the hundreds is read to. */
const TOLERANCE = 1e-6;

/** The mass hung on the hook, and the cable force it adds. */
const LOAD_MASS = 95;
const EXTRA = LOAD_MASS * GRAVITY;

/** The mast head both rail nodes hang from. */
const MAST = { x: 2, y: 10, z: 0 };

/** The rail the trolley stands on, and where along it: a quarter from its near end. */
const NEAR = { x: 4, y: 6, z: 0 };
const FAR = { x: 6, y: 6, z: 0 };
const FRACTION = 0.25;

/** That rail's near end is 2 units along the track from the origin. */
const TROLLEY = 2 + FRACTION * 2;

/** Where that puts the trolley point at slew 0: the pivot the cable hangs from. */
const PIVOT = {
  x: NEAR.x + FRACTION * (FAR.x - NEAR.x),
  y: NEAR.y,
  z: NEAR.z + FRACTION * (FAR.z - NEAR.z),
};

/**
 * The jib rig, and why it is shaped this way.
 *
 * The tower is the box between the site's four ground anchors and the slew ring's
 * bottom flange at `y = 4`: a vertical leg under each bottom-flange node, the four
 * flange horizontals with one diagonal across them, and three inclined anchor
 * braces — the bracing a cube on a fixed base needs so the tower solve is not a
 * mechanism (specs/statics.md, "Singularity"). The two braces are placed so the
 * corners `(0, 4, 0)` and `(0, 4, 2)` carry their vertical leg and horizontal
 * members alone: at such a corner the leg is the only member with a vertical
 * component, so vertical equilibrium there fixes the leg's force at exactly minus
 * the whole vertical load applied at the node, whatever the rest of the tower does.
 *
 * The arm is a mast head at `(2, 10, 0)` braced back to three top-flange nodes, a
 * two-rail track running out along `+x` from the top-flange node `(2, 6, 0)`, each
 * outboard rail node hung from the mast head by one cable and braced sideways by
 * one horizontal strut back to `(2, 6, 2)`. At `(4, 6, 0)` and `(6, 6, 0)` that
 * mast cable is the only member with a vertical component and that sideways brace
 * the only member with a `z` component, so each of those two equilibria is a
 * single-member reading as well.
 *
 * Every node lies inside site 1's envelope and the crane costs `1066.40` against a
 * budget of `3000`.
 */
const JIB_RIG_MEMBERS: readonly DesignMember[] = [
  // The tower: four legs, the flange square with one diagonal, three braces.
  [[0, 0, 0], [0, 4, 0], "strut"],
  [[2, 0, 0], [2, 4, 0], "strut"],
  [[0, 0, 2], [0, 4, 2], "strut"],
  [[2, 0, 2], [2, 4, 2], "strut"],
  [[0, 4, 0], [2, 4, 0], "strut"],
  [[0, 4, 2], [2, 4, 2], "strut"],
  [[0, 4, 0], [0, 4, 2], "strut"],
  [[2, 4, 0], [2, 4, 2], "strut"],
  [[0, 4, 0], [2, 4, 2], "strut"],
  [[0, 0, 0], [2, 4, 0], "strut"],
  [[0, 0, 2], [2, 4, 2], "strut"],
  [[2, 0, 2], [2, 4, 0], "strut"],
  // The arm: the mast head and its braces.
  [[2, 6, 0], [2, 10, 0], "strut"],
  [[2, 10, 0], [2, 6, 2], "strut"],
  [[2, 10, 0], [0, 6, 2], "strut"],
  [[2, 10, 0], [0, 6, 0], "strut"],
  // The arm: the track, its mast cables, and its sideways braces.
  [[2, 6, 0], [4, 6, 0], "rail"],
  [[4, 6, 0], [6, 6, 0], "rail"],
  [[2, 10, 0], [4, 6, 0], "cable"],
  [[2, 10, 0], [6, 6, 0], "cable"],
  [[4, 6, 0], [2, 6, 2], "strut"],
  [[6, 6, 0], [2, 6, 2], "strut"],
];

const JIB_RIG: CraneDesign = {
  site: 1,
  name: "Jib rig",
  ring: [0, 4, 0],
  counterweights: [],
  members: JIB_RIG_MEMBERS,
  tape: [],
};

/**
 * One move that turns the hook and applies no force to anything
 * (specs/rigging.md), so the run keeps ticking while the readings are taken and
 * nothing but the pose under test moves.
 */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "grip", target: 100000, rate: GRIP_MAX_RATE }],
  },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("shares the cable force between the trolley's two rail nodes in its own proportion", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await poseCrane(h, JIB_RIG);
  await addOneLoad(
    h,
    "crate",
    LOAD_MASS,
    { x: 20, y: 2, z: 0, yaw: 0 },
    { x: 20, y: 2, z: 0, yaw: 0 },
  );
  await poseTape(h, TAPE);

  const started = await startRun(h);
  const mastCable = (node: Vec3) => {
    const member = started.structure.members.find((m) => {
      const ends = [m.a, m.b];
      return (
        m.material === "cable" &&
        ends.some((p) => p.x === MAST.x && p.y === MAST.y && p.z === MAST.z) &&
        ends.some((p) => p.x === node.x && p.y === node.y && p.z === node.z)
      );
    });
    if (member === undefined) {
      throw new Error(
        `gantry: the rig has no mast cable to (${node.x}, ${node.y}, ${node.z})`,
      );
    }
    // How much of a vertical load at that node the cable takes: all of it,
    // divided by its own vertical direction cosine.
    const cosine =
      Math.abs(MAST.y - node.y) /
      distance3({ x: MAST.x, y: MAST.y, z: MAST.z }, node);
    return { id: member.id, cosine };
  };
  const near = mastCable(NEAR);
  const far = mastCable(FAR);

  // Pose the trolley, and put the bob straight back under where that leaves the
  // pivot: `setBob` "puts the bob where it is asked for, so a caller that wants a
  // bob the cable can hold sets the hoist axis to the distance it left between the
  // pivot and the bob" (specs/instrumentation.md).
  await h.debug.setAxis("trolley", TROLLEY);
  await h.debug.setBob(PIVOT.x, PIVOT.y - HOIST_START, PIVOT.z);
  await h.debug.setBobVelocity(0, 0, 0);
  const placed = await runTicks(h, 1);
  assertNear(
    placed.run.axes.trolley.value,
    TROLLEY,
    1e-9,
    "the trolley standing where it was posed, a quarter along its outer rail",
  );

  /**
   * Hang the bob at rest below the pivot and read the settled solve.
   *
   * Posed twice, with ticks between: a tick's bob acceleration is
   * `(v - v_prev) / dt` (specs/rigging.md) and `v_prev` is the velocity the
   * previous tick ended on, so the first tick after a pose still carries whatever
   * the bob was doing before it. The second round is posed onto an already-still
   * bob, so the tick that is read has `v_prev` of zero, no acceleration, and the
   * cable force specs/rigging.md gives for a bob hanging at rest: "the bob's
   * weight, straight down".
   */
  const readAtRest = async () => {
    let after = await h.snapshot();
    for (let round = 0; round < 2; round += 1) {
      await h.debug.setBob(
        after.run.pivot.x,
        after.run.pivot.y - HOIST_START,
        after.run.pivot.z,
      );
      await h.debug.setBobVelocity(0, 0, 0);
      after = await runTicks(h, 2);
    }
    assertTrue(
      after.run.phase === "running",
      "the run still standing while the reading is taken",
    );
    return new Map(after.run.forces.map((f) => [f.id, f.force]));
  };

  const bare = await readAtRest();
  await h.debug.setLoadPhase(0, "attached");
  const loaded = await readAtRest();

  const change = (id: number) =>
    (loaded.get(id) ?? NaN) - (bare.get(id) ?? NaN);

  await h.capture(
    "trolley-share",
    "A load on the hook with the trolley a quarter along its rail",
  );

  assertNear(
    change(near.id),
    ((1 - FRACTION) * EXTRA) / near.cosine,
    TOLERANCE,
    `the mast cable at (${NEAR.x}, ${NEAR.y}, ${NEAR.z}) taking ` +
      `${1 - FRACTION} of the ${EXTRA} the hung load adds to the cable force, ` +
      "the share the trolley's own mass is split in (specs/statics.md)",
  );
  assertNear(
    change(far.id),
    (FRACTION * EXTRA) / far.cosine,
    TOLERANCE,
    `the mast cable at (${FAR.x}, ${FAR.y}, ${FAR.z}) taking ${FRACTION} of ` +
      `the ${EXTRA} the hung load adds to the cable force (specs/statics.md)`,
  );
});

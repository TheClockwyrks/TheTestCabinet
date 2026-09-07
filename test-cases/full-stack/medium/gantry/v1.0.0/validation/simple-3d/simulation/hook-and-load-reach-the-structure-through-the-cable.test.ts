// simulation/hook-and-load-reach-the-structure-through-the-cable — the hook and
// its load are never lumped at a node; what the structure carries is the cable
// force.
//
// specs/statics.md, in the same paragraph that lumps every other mass at a node:
// "The hook and any attached load reach the structure only through the cable force
// below", and the cable force is specs/rigging.md's: "the force the rigging applies
// to the structure at the pivot is `-T`, which is the cable force
// specs/statics.md applies at the trolley point ... Hanging at rest this is the
// bob's weight, straight down; swinging, hoisting, and slewing all show up in it."
// So a swinging bob does not hand the structure `(HOOK_MASS + load) * GRAVITY`; it
// hands it whatever that tick's constraint made, which differs in size and in
// direction.
//
// The trolley begins every run at the track origin, which here is the top-flange
// node `(2, 6, 0)`, so the whole cable force lands on one ring corner and crosses
// to `(2, 4, 0)` — a bottom-flange corner braced by horizontals alone, whose
// vertical leg therefore reads the crossed vertical load exactly. Three readings
// are taken over one geometry: the bare hook at rest, the load at rest, and the
// load swinging. The cable force is not reported, so each reading computes it the
// way specs/rigging.md defines it, from the bob's own velocity across the tick:
// `a = (v - v_prev) / dt` and `T = m * (a - g)`.
//
// What the check then decides is that the leg tracks that computed cable force,
// tick for tick — the resting reading and the swinging one alike — rather than
// tracking the weight of what is hanging.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertNear, assertTrue } from "../assert";
import {
  GRAVITY,
  GRIP_MAX_RATE,
  HOIST_START,
  HOOK_MASS,
  TICK_HZ,
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
  type TapeStepSpec,
} from "../harness";

/** The span a force in the hundreds is read to. */
const TOLERANCE = 1e-6;

/** The mass hung on the hook. */
const LOAD_MASS = 40;

/** The bottom-flange corner the trolley's top-flange node is paired with. */
const CORNER = { x: 2, y: 4, z: 0 };

/** How far off the vertical the bob is posed, in degrees, and how long it swings. */
const SWING_DEGREES = 30;
const SWING_TICKS = 20;

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

const RIG: CraneDesign = {
  site: 1,
  name: "Bare-corner jib rig",
  ring: [0, 4, 0],
  counterweights: [],
  members: RIG_MEMBERS,
  tape: [],
};

/** One move that turns the hook and applies no force (specs/rigging.md). */
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

it("hands the structure the cable force rather than the weight of what hangs", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await poseCrane(h, RIG);
  await addOneLoad(
    h,
    "crate",
    LOAD_MASS,
    { x: 20, y: 2, z: 0, yaw: 0 },
    { x: 20, y: 2, z: 0, yaw: 0 },
  );
  await poseTape(h, TAPE);

  const started = await startRun(h);
  const leg = started.structure.members.find((m) => {
    const [low, high] = m.a.y < m.b.y ? [m.a, m.b] : [m.b, m.a];
    return (
      low.y === 0 &&
      low.x === CORNER.x &&
      low.z === CORNER.z &&
      high.x === CORNER.x &&
      high.y === CORNER.y &&
      high.z === CORNER.z
    );
  });
  if (leg === undefined) {
    throw new Error("gantry: the rig has no leg under (2, 4, 0)");
  }

  /**
   * One tick's reading: the leg's force, and the vertical component of the cable
   * force that tick, computed as specs/rigging.md defines it.
   */
  const read = async (mass: number) => {
    const before = await h.snapshot();
    const after = await runTicks(h, 1);
    assertTrue(
      after.run.phase === "running",
      "the run still standing while the reading is taken",
    );
    const accelerationY =
      (after.run.bob.vel.y - before.run.bob.vel.y) * TICK_HZ;
    // T = m * (a - g), and the structure carries -T at the pivot.
    const cableY = -mass * (accelerationY + GRAVITY);
    const force = after.run.forces.find((f) => f.id === leg.id);
    if (force === undefined) {
      throw new Error("gantry: the run reported no force for the corner's leg");
    }
    return { leg: force.force, cableY, snapshot: after };
  };

  /**
   * Hang the bob at rest below the pivot, twice over, so the tick read is settled.
   *
   * The rounds are ticks the check drives, never a wait: nothing here reads the
   * wall clock, so the same frames land on any host.
   */
  const hangAtRest = async () => {
    let state = await h.snapshot();
    for (let round = 0; round < 2; round += 1) {
      await h.debug.setBob(
        state.run.pivot.x,
        state.run.pivot.y - HOIST_START,
        state.run.pivot.z,
      );
      await h.debug.setBobVelocity(0, 0, 0);
      state = await runTicks(h, 2);
    }
  };

  await hangAtRest();
  const bare = await read(HOOK_MASS);
  assertNear(
    bare.cableY,
    -HOOK_MASS * GRAVITY,
    TOLERANCE,
    "the cable force of a bare hook hanging at rest: its weight, straight down",
  );

  await h.debug.setLoadPhase(0, "attached");
  await hangAtRest();
  const hanging = await read(HOOK_MASS + LOAD_MASS);
  assertNear(
    hanging.cableY,
    -(HOOK_MASS + LOAD_MASS) * GRAVITY,
    TOLERANCE,
    "the cable force of hook and load hanging at rest",
  );
  assertNear(
    hanging.leg - bare.leg,
    hanging.cableY - bare.cableY,
    TOLERANCE,
    "the corner's leg taking exactly the change in the cable force when a load " +
      "of mass " +
      LOAD_MASS +
      " is hung on the hook (specs/statics.md)",
  );

  // Now set the same bob swinging. Nothing about the hook or the load has
  // changed — only what the constraint is doing to it.
  const before = await h.snapshot();
  const theta = (SWING_DEGREES * Math.PI) / 180;
  await h.debug.setBob(
    before.run.pivot.x + HOIST_START * Math.sin(theta),
    before.run.pivot.y - HOIST_START * Math.cos(theta),
    before.run.pivot.z,
  );
  await h.debug.setBobVelocity(0, 0, 0);
  await runTicks(h, SWING_TICKS);
  const swinging = await read(HOOK_MASS + LOAD_MASS);

  await h.capture(
    "swinging-bob",
    "The rig with a load swinging on the hook off the vertical",
  );

  assertGreaterThan(
    Math.abs(swinging.cableY - hanging.cableY),
    1,
    "the cable force of a swinging bob differing from the weight of the same " +
      "hook and load hanging still, so the reading below is about the cable " +
      "force rather than about the mass on the hook",
  );
  assertNear(
    swinging.leg - hanging.leg,
    swinging.cableY - hanging.cableY,
    TOLERANCE,
    "the corner's leg carrying the vertical component of the cable force the " +
      "rigging made on that tick, not (HOOK_MASS + " +
      LOAD_MASS +
      ") * " +
      "GRAVITY (specs/statics.md, specs/rigging.md)",
  );
});

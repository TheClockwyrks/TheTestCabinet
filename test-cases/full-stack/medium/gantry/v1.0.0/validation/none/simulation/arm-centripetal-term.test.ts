// simulation/arm-centripetal-term — an arm node's prescribed acceleration carries
// -omega^2 * r, so the force it applies grows with the square of the slew rate and
// does not care which way the arm is turning.
//
// specs/statics.md, "The load model": "An arm node's acceleration comes from the
// slew motion: with `omega` and `alpha` the slew rate and acceleration in radians
// per second and per second squared, and `r` the horizontal vector from the slew
// axis to the node's rotated position, `a = -omega^2 * r - alpha * (k x r)` ... The
// first term is centripetal and draws the node in toward the axis." Each lumped
// mass applies `F = m * g - m * a`, so that term hands the node `+m * omega^2 * r`
// — outward, quadratic in the rate, and identical at `+omega` and `-omega`.
//
// Four readings are taken at one geometry. Each is a fresh run posed so that the
// tick it reads leaves the slew at exactly 0 degrees while the axis is cruising at
// the rate the reading is about: `setAxis` puts the value one tick's travel short
// of 0, `setAxisRate` poses the rate, and the tape's first step issues a command to
// a far-off target at that same rate, so the controller's clamp "left `v` as it
// was" and specs/program.md has the tick report an acceleration of `0`. Every
// reading therefore shares one geometry and one zero `alpha`, and differs only in
// `omega`.
//
// Only arm members are compared. The trolley begins a run at the track origin,
// which here is the top-flange node `(2, 6, 0)`, and specs/statics.md applies the
// trolley's mass and the cable force at the trolley point — a support of the arm
// solve, where an applied force reaches the reaction and no member. So the swinging
// bob, whose motion does depend on the slew rate, cannot reach these readings at
// all, while the tower below the ring can and is left out.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertNear, assertTrue } from "../assert";
import {
  GRIP_MAX_RATE,
  HOIST_START,
  LATTICE_PITCH,
  SLEW_MAX_RATE,
  TICK_HZ,
} from "../constants";
import {
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

/** The relative span the quadratic law is read to. */
const TOLERANCE = 1e-6;

/** The slew value every reading is taken at. */
const ANGLE = 0;

/** The rates the readings are taken at: half the maximum, and both signs of it. */
const HALF = SLEW_MAX_RATE / 2;

/** The sideways brace whose tension says which way the term pulls. */
const BRACE: readonly [readonly [number, number, number], readonly [number, number, number]] =
  [[6, 6, 0], [2, 6, 2]];

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
 * The two hangers are struts rather than cables, so no member can leave the system
 * between one reading and the next: specs/statics.md drops a slack cable out of the
 * solve entirely, which would change the arm's stiffness rather than its loads, and
 * these readings are a comparison of loads over one unchanging stiffness.
 *
 * Every node lies inside site 1's envelope and the crane is well under the site's
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
  [[2, 10, 0], [4, 6, 0], "strut"],
  [[2, 10, 0], [6, 6, 0], "strut"],
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

/** A move on an axis that applies no force, for the readings that are at rest. */
const IDLE_STEP: TapeStepSpec = {
  kind: "move",
  commands: [{ axis: "grip", target: 100000, rate: GRIP_MAX_RATE }],
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("hands an arm node a force that grows with the square of the slew rate", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await poseCrane(h, JIB_RIG);

  const { structure } = await h.snapshot();
  const ring = structure.ring;
  if (ring === null) throw new Error("gantry: the posed rig carries no ring");
  const axis = {
    x: ring.corner.x + LATTICE_PITCH / 2,
    z: ring.corner.z + LATTICE_PITCH / 2,
  };
  /** Arm members: the ones standing at or above the ring's top flange. */
  const arm = new Set(
    structure.members
      .filter((m) => m.a.y >= ring.corner.y + LATTICE_PITCH && m.b.y >= ring.corner.y + LATTICE_PITCH)
      .map((m) => m.id),
  );
  assertGreaterThan(arm.size, 0, "arm members to read the slew's loads off");
  const brace = structure.members.find(
    (m) =>
      (m.a.x === BRACE[0][0] && m.a.y === BRACE[0][1] && m.a.z === BRACE[0][2] &&
        m.b.x === BRACE[1][0] && m.b.y === BRACE[1][1] && m.b.z === BRACE[1][2]) ||
      (m.b.x === BRACE[0][0] && m.b.y === BRACE[0][1] && m.b.z === BRACE[0][2] &&
        m.a.x === BRACE[1][0] && m.a.y === BRACE[1][1] && m.a.z === BRACE[1][2]),
  );
  if (brace === undefined) {
    throw new Error("gantry: the rig has no sideways brace at (6, 6, 0)");
  }

  /**
   * One reading: the arm's member forces on a tick that leaves the slew at
   * `ANGLE` while the axis holds `rate` with no acceleration of its own.
   */
  const readAt = async (rate: number) => {
    await h.debug.abortRun();
    // The tape poses apply on the program screen alone (specs/instrumentation.md).
    await h.debug.setScreen("program");
    await h.debug.clearProgram();
    const step: TapeStepSpec =
      rate === 0
        ? IDLE_STEP
        : {
            kind: "move",
            commands: [
              { axis: "slew", target: rate > 0 ? 100000 : -100000, rate: Math.abs(rate) },
            ],
          };
    await poseTape(h, [step]);
    await startRun(h);

    // One tick's travel short of the angle, so the tick lands exactly on it.
    const from = ANGLE - rate / TICK_HZ;
    await h.debug.setAxis("slew", from);
    if (rate !== 0) await h.debug.setAxisRate("slew", rate);
    // And put the bob under where that pose leaves the pivot, so the pendulum
    // takes no jolt from the jump. It reaches the arm solve only at a support
    // either way, but a jolted cable can snap and end the run.
    const theta = (from * Math.PI) / 180;
    const node = { x: 2, y: 6, z: 0 };
    await h.debug.setBob(
      axis.x + (node.x - axis.x) * Math.cos(theta) - (node.z - axis.z) * Math.sin(theta),
      node.y - HOIST_START,
      axis.z + (node.x - axis.x) * Math.sin(theta) + (node.z - axis.z) * Math.cos(theta),
    );
    await h.debug.setBobVelocity(0, 0, 0);

    const after = await runTicks(h, 1);
    assertTrue(
      after.run.phase === "running",
      "the run still standing while the reading is taken at rate " + rate,
    );
    assertNear(
      after.run.axes.slew.value,
      ANGLE,
      1e-9,
      "the slew value the reading at rate " + rate + " is taken at",
    );
    assertNear(
      after.run.axes.slew.rate,
      rate,
      1e-9,
      "the slew rate the reading is taken at, cruising rather than accelerating",
    );
    return new Map(
      after.run.forces.filter((f) => arm.has(f.id)).map((f) => [f.id, f.force]),
    );
  };

  const still = await readAt(0);
  const half = await readAt(HALF);
  const full = await readAt(SLEW_MAX_RATE);
  const reversed = await readAt(-SLEW_MAX_RATE);

  const changeAt = (reading: Map<number, number>, id: number) =>
    (reading.get(id) ?? NaN) - (still.get(id) ?? NaN);

  let largest = 0;
  for (const id of arm) largest = Math.max(largest, Math.abs(changeAt(full, id)));
  assertGreaterThan(
    largest,
    1,
    "a slew at SLEW_MAX_RATE changing the arm's member forces at all, so the " +
      "readings below are about a term that is genuinely there",
  );

  for (const id of arm) {
    assertNear(
      changeAt(full, id),
      4 * changeAt(half, id),
      Math.max(Math.abs(changeAt(full, id)), 1) * TOLERANCE,
      "member " + id + "'s load at " + SLEW_MAX_RATE + " deg/s standing at " +
        "four times its load at " + HALF + " deg/s, since the centripetal term " +
        "goes as omega squared (specs/statics.md)",
    );
    assertNear(
      changeAt(reversed, id),
      changeAt(full, id),
      Math.max(Math.abs(changeAt(full, id)), 1) * TOLERANCE,
      "member " + id + "'s load being the same at -" + SLEW_MAX_RATE + " deg/s " +
        "as at +" + SLEW_MAX_RATE + " deg/s, since omega squared does not " +
        "reverse with its sign (specs/statics.md)",
    );
  }

  // And the term pulls the arm outward rather than inward. The outboard rail node
  // stands on the -z side of the slew axis, so a force drawing it away from the
  // axis pushes it further toward -z, and the sideways brace back to (2, 6, 2) is
  // the only member at that node with a z component: it must pull harder.
  assertGreaterThan(
    changeAt(full, brace.id),
    0,
    "the sideways brace at (6, 6, 0) pulling harder as the arm turns, which is " +
      "the arm being drawn outward from the slew axis rather than inward " +
      "(specs/statics.md)",
  );

  await h.capture(
    "centripetal",
    "The jib rig cruising at SLEW_MAX_RATE, its arm carrying the centripetal term",
  );
});

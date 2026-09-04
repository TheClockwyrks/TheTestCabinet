// simulation/arm-tangential-term — an arm node's prescribed acceleration carries
// -alpha * (k x r), the term that turns with the arm and reverses with the
// commanded direction.
//
// specs/statics.md, "The load model": "`a = -omega^2 * r - alpha * (k x r)` with
// `k = (0, 1, 0)` ... where `k x r` is the vector `(r.z, 0, -r.x)`. ... The second
// is tangential and turns with the arm: a positive `alpha` accelerates a node
// standing at `+x` of the axis toward `+z`, the way a positive slew carries it."
// Each lumped mass applies `F = m * g - m * a`, so a positive `alpha` hands a node
// standing at `+x` of the axis a force component toward `-z` of `m * alpha * r.x`.
// specs/program.md fixes `alpha` itself: "a driving tick that changed `v` reports
// `+s * a`", and `SLEW_ACCEL` is `30` degrees per second squared.
//
// The reading is one member. At `(4, 6, 0)` the sideways brace back to `(2, 6, 2)`
// is the only member with a `z` component, so equilibrium along `z` at that node
// fixes its force at minus the node's whole `z` load divided by its own direction
// cosine — no stiffness and no load path enter it. The node's lumped mass is read
// out of the structure the build reports, half of each member ending there
// (specs/statics.md), so the figure compared against is the specification's
// arithmetic over the build's own crane.
//
// Two pairs of readings are taken, all four at slew 0 and at a slew rate of
// `SLEW_MAX_RATE`, so `omega`, the geometry and the weight are identical across a
// pair and only `alpha` differs: a cruising tick, whose clamp left `v` as it was
// and which specs/program.md has report `0`, against a driving tick that changed
// `v` and reports `+s * a`. The second pair commands the move the other way, where
// `s` is `-1`, and the term must reverse with it.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertNear, assertTrue } from "../assert";
import {
  CABLE_MASS_PER_UNIT,
  GRIP_MAX_RATE,
  HOIST_START,
  LATTICE_PITCH,
  RAIL_MASS_PER_UNIT,
  SLEW_ACCEL,
  SLEW_MAX_RATE,
  STRUT_MASS_PER_UNIT,
  TICK_HZ,
} from "../constants";
import {
  clearAll,
  createHarness,
  distance3,
  openSite,
  poseCrane,
  poseTape,
  runTicks,
  startRun,
  type CraneDesign,
  type DesignMember,
  type Harness,
  type MaterialName,
  type TapeStepSpec,
} from "../harness";

/** The span a force in the tens is read to. */
const TOLERANCE = 1e-6;

/** specs/structure.md's mass per unit, by material. */
const MASS_PER_UNIT: Readonly<Record<MaterialName, number>> = {
  strut: STRUT_MASS_PER_UNIT,
  cable: CABLE_MASS_PER_UNIT,
  rail: RAIL_MASS_PER_UNIT,
};

/** The slew value every reading is taken at, and the rate it is taken at. */
const ANGLE = 0;

/** The node the reading is taken at, and the brace that carries its z load. */
const NODE = { x: 4, y: 6, z: 0 };
const BRACE_END = { x: 2, y: 6, z: 2 };

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

/** A move on an axis that applies no force, for a run that must not slew. */
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

it("hands an arm node the tangential term, which reverses with the commanded direction", async () => {
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

  const at = (p: { x: number; y: number; z: number }) =>
    p.x === NODE.x && p.y === NODE.y && p.z === NODE.z;
  const touching = structure.members.filter((m) => at(m.a) || at(m.b));
  const lumped = touching.reduce(
    (sum, m) => sum + (distance3(m.a, m.b) * MASS_PER_UNIT[m.material]) / 2,
    0,
  );
  const brace = touching.find((m) => {
    const other = at(m.a) ? m.b : m.a;
    return other.x === BRACE_END.x && other.y === BRACE_END.y && other.z === BRACE_END.z;
  });
  if (brace === undefined) {
    throw new Error("gantry: the rig has no sideways brace at (4, 6, 0)");
  }
  const cosine =
    (BRACE_END.z - NODE.z) / distance3(brace.a, brace.b);

  /**
   * One reading: the brace's force on a tick that leaves the slew at `ANGLE`
   * turning at `rate`, having either cruised there or driven there.
   */
  const readAt = async (rate: number, driving: boolean) => {
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

    // The tick advances by `rate / TICK_HZ`, so posing the value that far short
    // of ANGLE lands the tick's geometry exactly on it. A driving tick is posed
    // one acceleration step below the rate it is to end on, so the controller
    // drives rather than clamps.
    const from = ANGLE - rate / TICK_HZ;
    await h.debug.setAxis("slew", from);
    const posedRate = driving
      ? rate - Math.sign(rate) * (SLEW_ACCEL / TICK_HZ)
      : rate;
    await h.debug.setAxisRate("slew", posedRate);
    const theta = (from * Math.PI) / 180;
    const origin = { x: 2, y: 6, z: 0 };
    await h.debug.setBob(
      axis.x + (origin.x - axis.x) * Math.cos(theta) - (origin.z - axis.z) * Math.sin(theta),
      origin.y - HOIST_START,
      axis.z + (origin.x - axis.x) * Math.sin(theta) + (origin.z - axis.z) * Math.cos(theta),
    );
    await h.debug.setBobVelocity(0, 0, 0);

    const after = await runTicks(h, 1);
    assertTrue(
      after.run.phase === "running",
      "the run still standing while the reading is taken",
    );
    assertNear(after.run.axes.slew.value, ANGLE, 1e-9, "the slew value read at");
    assertNear(after.run.axes.slew.rate, rate, 1e-9, "the slew rate read at");
    const force = after.run.forces.find((f) => f.id === brace.id);
    if (force === undefined) {
      throw new Error("gantry: the run reported no force for the sideways brace");
    }
    return force.force;
  };

  // The term the specification gives, in this crane's own figures. `r.x` is the
  // node's offset from the slew axis along x at slew 0; `alpha` is in radians.
  const alpha = (SLEW_ACCEL * Math.PI) / 180;
  const expected = (lumped * alpha * (NODE.x - axis.x)) / cosine;
  assertGreaterThan(
    expected,
    1,
    "the tangential term at (4, 6, 0) being large enough to read, so this " +
      "scenario decides something",
  );

  const forward = (await readAt(SLEW_MAX_RATE, true)) - (await readAt(SLEW_MAX_RATE, false));
  assertNear(
    forward,
    expected,
    TOLERANCE,
    "the sideways brace at (4, 6, 0) taking that node's whole tangential load, " +
      "m * alpha * r.x toward -z with alpha in radians per second squared, on a " +
      "tick driving the slew at +SLEW_ACCEL (specs/statics.md, specs/program.md)",
  );

  const backward = (await readAt(-SLEW_MAX_RATE, true)) - (await readAt(-SLEW_MAX_RATE, false));
  await h.capture(
    "tangential",
    "The jib rig on the tick a slew move is driving the arm around",
  );

  assertNear(
    backward,
    -expected,
    TOLERANCE,
    "the same term reversing when the move is commanded the other way, since " +
      "alpha is `+s * a` and `s` is the sign of the distance to go " +
      "(specs/program.md, specs/statics.md)",
  );
});

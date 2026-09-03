// simulation/tower-node-acceleration-zero — a tower node's prescribed acceleration
// is zero, whatever the arm is doing.
//
// specs/statics.md, "The load model": "Each lumped mass `m` at a point with
// prescribed acceleration `a` applies the force `F = m * g - m * a` ... Tower nodes
// have `a = 0`. An arm node's acceleration comes from the slew motion". So a tower
// node's own applied force is its weight and nothing else: the slew rate puts no
// centripetal term on it and the slew acceleration puts no tangential term on it,
// however far out from the axis it stands. specs/structure.md is the same rule from
// the geometry's side: the ring "turns the top flange and takes the whole arm with
// it ... while the bottom flange stands still".
//
// The crane carries an outrigger node three units out from the slew axis — further
// than any other tower node, and so where a term wrongly applied to the tower would
// show up largest — and a counterweight is put on and taken off it. The reading is
// the difference that counterweight makes to every member's force, taken once with
// the arm at rest and once with it cruising at `SLEW_MAX_RATE`. Both solves are
// linear in the applied forces (specs/statics.md assembles `K u = F`), so the
// counterweight's effect is exactly the load it adds pushed through one unchanging
// stiffness — and if that load carried a slew term, the two differences would not
// match.
//
// Differencing is what makes the reading clean: the counterweight sits on a tower
// node, so it changes nothing in the arm solve, nothing in the reaction the ring
// carries down, and nothing in the swinging bob. Everything that does depend on the
// slew rate is identical within each pair and cancels.

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

/** The span a force in the hundreds is read to. */
const TOLERANCE = 1e-6;

/** The slew value every reading is taken at. */
const ANGLE = 0;

/** The tower node the counterweight goes on and off. */
const OUTRIGGER_NODE = { x: -2, y: 2, z: 0 };

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

/**
 * An outrigger node hung off the tower, three units out from the slew axis.
 *
 * It is the tower node furthest from the axis, which is where a slew term wrongly
 * applied to a tower node would show up largest: the centripetal and tangential
 * terms both scale with `r`, the horizontal vector from the axis to the node.
 */
const OUTRIGGER: readonly DesignMember[] = [
  [[-2, 2, 0], [0, 0, 0], "strut"],
  [[-2, 2, 0], [0, 0, 2], "strut"],
  [[-2, 2, 0], [2, 0, 0], "strut"],
  [[-2, 2, 0], [0, 4, 0], "strut"],
];

const JIB_RIG: CraneDesign = {
  site: 1,
  name: "Jib rig with an outrigger",
  ring: [0, 4, 0],
  counterweights: [],
  members: [...JIB_RIG_MEMBERS, ...OUTRIGGER],
  tape: [],
};

/** A move on an axis that applies no force, for the readings at rest. */
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

it("puts no slew term on a tower node, however fast the arm turns", async () => {
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
  assertGreaterThan(
    Math.hypot(OUTRIGGER_NODE.x - axis.x, OUTRIGGER_NODE.z - axis.z),
    LATTICE_PITCH,
    "the outrigger standing well out from the slew axis, where a slew term " +
      "applied to a tower node would be largest",
  );

  let standing = false;
  /**
   * One reading: every member's force on a tick that leaves the slew at `ANGLE`
   * while the axis cruises at `rate`, with or without the outrigger's
   * counterweight.
   */
  const readAt = async (rate: number, counterweight: boolean) => {
    await h.debug.abortRun();
    if (counterweight !== standing) {
      // The structure poses apply on the build screen (specs/instrumentation.md).
      await h.debug.setScreen("build");
      if (counterweight) {
        await h.debug.addCounterweight(
          OUTRIGGER_NODE.x,
          OUTRIGGER_NODE.y,
          OUTRIGGER_NODE.z,
        );
      } else {
        await h.debug.removeCounterweight(
          OUTRIGGER_NODE.x,
          OUTRIGGER_NODE.y,
          OUTRIGGER_NODE.z,
        );
      }
      const posed = await h.snapshot();
      assertTrue(
        posed.structure.counterweights.some(
          (c) =>
            c.x === OUTRIGGER_NODE.x &&
            c.y === OUTRIGGER_NODE.y &&
            c.z === OUTRIGGER_NODE.z,
        ) === counterweight,
        "the outrigger's counterweight standing exactly when the reading wants it",
      );
      standing = counterweight;
    }
    await h.debug.setScreen("program");
    await h.debug.clearProgram();
    const step: TapeStepSpec =
      rate === 0
        ? IDLE_STEP
        : {
            kind: "move",
            commands: [{ axis: "slew", target: 100000, rate }],
          };
    await poseTape(h, [step]);
    await startRun(h);

    // One tick's travel short of the angle, so the tick lands exactly on it and
    // the controller's clamp leaves `v` as it was — a cruising tick, whose own
    // acceleration specs/program.md reports as 0.
    const from = ANGLE - rate / TICK_HZ;
    await h.debug.setAxis("slew", from);
    if (rate !== 0) await h.debug.setAxisRate("slew", rate);
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
    return new Map(after.run.forces.map((f) => [f.id, f.force]));
  };

  const stillBare = await readAt(0, false);
  const stillLoaded = await readAt(0, true);
  const turningLoaded = await readAt(SLEW_MAX_RATE, true);
  const turningBare = await readAt(SLEW_MAX_RATE, false);

  let largest = 0;
  for (const [id, force] of stillLoaded) {
    largest = Math.max(largest, Math.abs(force - (stillBare.get(id) ?? NaN)));
  }
  assertGreaterThan(
    largest,
    1,
    "the counterweight changing the member forces at all, so the comparison " +
      "below decides something",
  );

  for (const [id, force] of turningLoaded) {
    const turning = force - (turningBare.get(id) ?? NaN);
    const still = (stillLoaded.get(id) ?? NaN) - (stillBare.get(id) ?? NaN);
    assertNear(
      turning,
      still,
      Math.max(Math.abs(still), 1) * TOLERANCE,
      "member " + id + " feeling the outrigger's counterweight the same while " +
        "the arm cruises at SLEW_MAX_RATE as while it stands still, since a " +
        "tower node's prescribed acceleration is zero (specs/statics.md)",
    );
  }

  await h.capture(
    "tower-node-still",
    "The counterweighted outrigger with the arm turning above it",
  );
});

// simulation/lumped-mass-ring-flange — each of the ring's eight flange nodes
// carries RING_MASS / 8, the top-flange share crossing its corner to the tower.
//
// specs/statics.md: "Each node's mass is ... plus `RING_MASS / 8` for each flange
// node of the ring", and "A flange node belongs to its solve whether or not a
// member ends there, since it carries ring mass and, on the bottom flange, the
// force carried across." `RING_MASS` is `20` (specs/structure.md), so each of the
// eight flange nodes carries `2.5` mass units — the bottom-flange node in the
// tower's own solve, and the top-flange node as an applied force at a support of
// the arm solve, whose reaction crosses the corner (specs/statics.md, "The two
// solves").
//
// The crane is the jib rig with the mast brace back to `(0, 6, 0)` left out, so
// that top-flange node carries no arm member at all: its whole applied force is
// its ring share, its reaction is exactly that share, and the corner carries it
// down to `(0, 4, 0)`. That bottom-flange corner is braced by horizontals alone,
// so its vertical leg is the only member there with a vertical component and
// vertical equilibrium fixes the leg's force at minus the whole vertical load
// applied at the node — the node's own member half-masses, its own ring share, and
// the share carried down. Every term is read out of the structure the build
// reports, so the figure is the specification's arithmetic rather than a number
// copied off a reference.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear, assertTrue } from "../assert";
import {
  CABLE_MASS_PER_UNIT,
  GRAVITY,
  RAIL_MASS_PER_UNIT,
  RING_MASS,
  STRUT_MASS_PER_UNIT,
} from "../constants";
import {
  createHarness,
  distance3,
  emptyYard,
  openSite,
  poseCrane,
  type CraneDesign,
  type DesignMember,
  type Harness,
  type MaterialName,
} from "../harness";

/** The span a force in the tens is read to. */
const TOLERANCE = 1e-6;

/** specs/structure.md's mass per unit, by material. */
const MASS_PER_UNIT: Readonly<Record<MaterialName, number>> = {
  strut: STRUT_MASS_PER_UNIT,
  cable: CABLE_MASS_PER_UNIT,
  rail: RAIL_MASS_PER_UNIT,
};

/** The corner whose top-flange node no arm member reaches. */
const CORNER = { x: 0, y: 4, z: 0 };

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

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("carries RING_MASS / 8 at a flange node and crosses the top flange's share down", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await poseCrane(h, JIB_RIG);

  const { structure } = await h.snapshot();
  const result = await h.check();
  assertTrue(result.stable, "the jib rig stands, so the check solves it");

  const at = (p: { x: number; y: number; z: number }) =>
    p.x === CORNER.x && p.y === CORNER.y && p.z === CORNER.z;
  const touching = structure.members.filter((m) => at(m.a) || at(m.b));
  const halfMasses = touching.reduce(
    (sum, m) => sum + (distance3(m.a, m.b) * MASS_PER_UNIT[m.material]) / 2,
    0,
  );

  const leg = touching.find(
    (m) =>
      (at(m.a) ? m.b : m.a).y === 0 &&
      (at(m.a) ? m.b : m.a).x === CORNER.x &&
      (at(m.a) ? m.b : m.a).z === CORNER.z,
  );
  if (leg === undefined) {
    throw new Error("gantry: the jib rig has no leg under (0, 4, 0)");
  }
  const reading = result.members.find((m) => m.id === leg.id);
  if (reading === undefined) {
    throw new Error(`gantry: the check reported no force for member ${leg.id}`);
  }

  const own = (halfMasses + RING_MASS / 8) * GRAVITY;
  const crossed = (RING_MASS / 8) * GRAVITY;
  assertNear(
    reading.force,
    -(own + crossed),
    TOLERANCE,
    `the leg under (${CORNER.x}, ${CORNER.y}, ${CORNER.z}) carrying, in ` +
      `compression, its node's member half-masses (${halfMasses.toFixed(4)}) ` +
      `plus RING_MASS / 8 (${RING_MASS / 8}) under GRAVITY, plus the ` +
      `RING_MASS / 8 the untouched top-flange node's reaction carries down ` +
      "the corner (specs/statics.md)",
  );

  await h.advance(1);
  await h.capture(
    "ring-flange-load",
    "The jib rig, whose top-flange corner at (0, 6, 0) carries no arm member",
  );
});

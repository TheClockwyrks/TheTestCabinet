// simulation/lumped-mass-counterweight — a counterweight puts COUNTERWEIGHT_MASS
// at the node it is placed on, and at no other node.
//
// specs/statics.md fixes the lumped mass: "Each node's mass is half of every
// intact member ending at it ... plus `COUNTERWEIGHT_MASS` for a counterweight on
// it". specs/structure.md gives the figure: a counterweight "adds
// `COUNTERWEIGHT_MASS` (`80`) at that node". Weight is mass times `GRAVITY`
// (specs/world.md), so the load the structure carries at that node grows by
// exactly `800` force units and nowhere else.
//
// The reading is one member's force. The counterweight goes on the bottom-flange
// corner `(0, 4, 0)`, where the vertical leg is the only member with a vertical
// component, so vertical equilibrium at that node makes the leg's force exactly
// minus the whole vertical load applied there — no stiffness, no load path, and no
// other member enters it. The corner `(0, 4, 2)` is the same kind of corner and
// carries no counterweight, so its leg is what says the mass landed on one node
// rather than on the tower at large.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear, assertTrue } from "../assert";
import { COUNTERWEIGHT_MASS, GRAVITY } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseCrane,
  type CraneDesign,
  type DesignMember,
  type Harness,
  type Vec3,
} from "../harness";

/** The span a force in the hundreds is read to. */
const TOLERANCE = 1e-6;

/** The corner the counterweight goes on, and the one that must not feel it. */
const LOADED = { x: 0, y: 4, z: 0 };
const UNLOADED = { x: 0, y: 4, z: 2 };

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

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** The id of the vertical leg under `corner`, from the anchor below it. */
function legUnder(
  members: readonly { id: number; a: Vec3; b: Vec3 }[],
  corner: Vec3,
): number {
  const leg = members.find(
    (m) =>
      (m.a.x === corner.x &&
        m.a.z === corner.z &&
        m.a.y === 0 &&
        m.b.x === corner.x &&
        m.b.y === corner.y &&
        m.b.z === corner.z) ||
      (m.b.x === corner.x &&
        m.b.z === corner.z &&
        m.b.y === 0 &&
        m.a.x === corner.x &&
        m.a.y === corner.y &&
        m.a.z === corner.z),
  );
  if (leg === undefined) {
    throw new Error(
      `gantry: the jib rig has no leg under (${corner.x}, ${corner.y}, ${corner.z})`,
    );
  }
  return leg.id;
}

it("adds COUNTERWEIGHT_MASS at the node the counterweight stands on", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await poseCrane(h, JIB_RIG);

  const { structure } = await h.snapshot();
  const loadedLeg = legUnder(structure.members, LOADED);
  const unloadedLeg = legUnder(structure.members, UNLOADED);

  const before = await h.check();
  assertTrue(before.stable, "the jib rig stands, so the check solves it");
  const forceOf = (
    result: { members: { id: number; force: number }[] },
    id: number,
  ) => {
    const reading = result.members.find((m) => m.id === id);
    if (reading === undefined) {
      throw new Error(`gantry: the check reported no force for member ${id}`);
    }
    return reading.force;
  };
  const loadedBefore = forceOf(before, loadedLeg);
  const unloadedBefore = forceOf(before, unloadedLeg);

  await h.debug.addCounterweight(LOADED.x, LOADED.y, LOADED.z);
  const after = await h.check();
  await h.advance(1);
  await h.capture(
    "counterweight-load",
    "A counterweight on one bottom-flange corner of the jib rig",
  );

  assertTrue(
    after.stable,
    "the jib rig still stands with the counterweight on",
  );

  assertNear(
    forceOf(after, loadedLeg),
    loadedBefore - COUNTERWEIGHT_MASS * GRAVITY,
    TOLERANCE,
    `the leg under (${LOADED.x}, ${LOADED.y}, ${LOADED.z}) carrying ` +
      `COUNTERWEIGHT_MASS * GRAVITY = ${COUNTERWEIGHT_MASS * GRAVITY} more in ` +
      "compression once a counterweight stands on that node (specs/statics.md)",
  );
  assertNear(
    forceOf(after, unloadedLeg),
    unloadedBefore,
    TOLERANCE,
    `the leg under (${UNLOADED.x}, ${UNLOADED.y}, ${UNLOADED.z}), which ` +
      "carries no counterweight and must be unchanged",
  );
});

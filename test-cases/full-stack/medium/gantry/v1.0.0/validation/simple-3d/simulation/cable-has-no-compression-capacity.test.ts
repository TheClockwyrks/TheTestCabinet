// simulation/cable-has-no-compression-capacity — a cable never reports a
// compression.
//
// specs/structure.md gives the cable no compression capacity at all: "A cable
// resists tension only; in compression it goes slack and carries nothing", and
// specs/statics.md says what "goes slack" does in the solve: "every cable whose
// force comes back negative goes slack, leaves the system entirely, and carries
// zero force". So the reading a cable in a compression seat gives is `0`, never a
// negative number, and never a utilization scored against a compression capacity
// it does not have.
//
// The seat is the mast brace from `(2, 10, 0)` down to the top-flange node
// `(2, 6, 2)`. The check is run twice over the same geometry: once with that
// member as a strut, which is what establishes that this really is a compression
// seat rather than a place where nothing happens, and once with it as a cable,
// which is the reading the requirement is about. Nothing else differs between the
// two poses, so the second reading is about the material and about nothing else.
//
// AND IT IS LITERALLY THE SAME RIG, not a second one built beside it: the brace is
// swapped in place, by the two edits a player makes to change a member's material
// — `removeMember`, then `addMember` at the same two nodes. Every other member
// keeps the id and the seat it had, so the pair of readings differs in the one
// thing this requirement is about.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThan, assertTrue } from "../assert";
import {
  clearAll,
  createHarness,
  openSite,
  poseCrane,
  type CheckResult,
  type CraneDesign,
  type DesignMember,
  type Harness,
  type MaterialName,
} from "../harness";

/** The member the two poses differ in. */
const SEAT: readonly [
  readonly [number, number, number],
  readonly [number, number, number],
] = [
  [2, 10, 0],
  [2, 6, 2],
];

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

/** The jib rig with the mast brace at `SEAT` made of `material`. */
function rigWith(material: MaterialName): CraneDesign {
  const members: DesignMember[] = JIB_RIG_MEMBERS.map((m) =>
    m[0][0] === SEAT[0][0] &&
    m[0][1] === SEAT[0][1] &&
    m[0][2] === SEAT[0][2] &&
    m[1][0] === SEAT[1][0] &&
    m[1][1] === SEAT[1][1] &&
    m[1][2] === SEAT[1][2]
      ? [m[0], m[1], material]
      : m,
  );
  return { ...JIB_RIG, name: `Jib rig, ${material} brace`, members };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports no compression on a cable standing in a compression seat", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await poseCrane(h, rigWith("strut"));

  const readSeat = async (material: MaterialName) => {
    const { structure } = await h.snapshot();
    const result: CheckResult = await h.check();
    assertTrue(
      result.stable,
      `the jib rig stands with a ${material} mast brace, so the check solves it`,
    );
    const member = structure.members.find(
      (m) =>
        (m.a.x === SEAT[0][0] &&
          m.a.y === SEAT[0][1] &&
          m.a.z === SEAT[0][2] &&
          m.b.x === SEAT[1][0] &&
          m.b.y === SEAT[1][1] &&
          m.b.z === SEAT[1][2]) ||
        (m.b.x === SEAT[0][0] &&
          m.b.y === SEAT[0][1] &&
          m.b.z === SEAT[0][2] &&
          m.a.x === SEAT[1][0] &&
          m.a.y === SEAT[1][1] &&
          m.a.z === SEAT[1][2]),
    );
    if (member === undefined) {
      throw new Error(
        "gantry: the posed rig carries no mast brace at the seat",
      );
    }
    assertEqual(member.material, material, "the mast brace's material");
    const reading = result.members.find((m) => m.id === member.id);
    if (reading === undefined) {
      throw new Error(
        `gantry: the check reported no force for member ${member.id}`,
      );
    }
    return reading;
  };

  // The seat is a compression seat: as a strut the member is pushed.
  const asStrut = await readSeat("strut");
  assertLessThan(
    asStrut.force,
    0,
    "the mast brace at (2, 10, 0)-(2, 6, 2) standing in compression when it is " +
      "a strut, so the same member as a cable is genuinely being pushed",
  );

  // The two edits a player makes to change a member's material, on the build
  // screen the pose left showing: the strut comes out and a cable goes in between
  // the same two lattice nodes, and nothing else in the rig is touched.
  await h.debug.removeMember(asStrut.id);
  await h.debug.addMember(
    SEAT[0][0],
    SEAT[0][1],
    SEAT[0][2],
    SEAT[1][0],
    SEAT[1][1],
    SEAT[1][2],
    "cable",
  );

  // The requirement: as a cable it reports no compression at all.
  const asCable = await readSeat("cable");
  assertEqual(
    asCable.force,
    0,
    "the force a cable in a compression seat reports: it goes slack, leaves " +
      "the system, and carries zero (specs/structure.md, specs/statics.md)",
  );
  assertEqual(
    asCable.utilization,
    0,
    "the utilization a slack cable reports (specs/statics.md)",
  );

  await h.advance(1);
  await h.capture(
    "slack-cable",
    "The jib rig whose mast brace is a cable in a compression seat",
  );
});

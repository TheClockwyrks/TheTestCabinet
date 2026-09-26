// simulation/material-mass-per-unit — a member weighs its length times its
// material's mass per unit, and each of the three figures is the table's.
//
// specs/statics.md: "Each node's mass is half of every intact member ending at it,
// each half being the member's length times its material's mass per unit".
// specs/structure.md gives the three figures: `STRUT_MASS_PER_UNIT` (`0.8`),
// `CABLE_MASS_PER_UNIT` (`0.15`) and `RAIL_MASS_PER_UNIT` (`1.2`). A member of
// length 2 therefore puts `mass per unit` of mass on each of its two end nodes,
// and `GRAVITY` (specs/world.md) turns that into force.
//
// A single member hanging on one supported node cannot be posed — a free node
// carrying one member is a mechanism and the solve goes singular — so the reading
// is taken through a node whose equilibrium isolates one member. The rig hangs the
// outboard rail node `(6, 6, 0)` from the mast head by a cable and braces it
// sideways with two horizontal struts, so that cable is the only member there with
// a vertical component: vertical equilibrium at the node fixes its force at the
// node's whole vertical load divided by the cable's own `|n.y|`, whatever the rest
// of the arm does. The check is then run four times over one geometry — with
// nothing between `(4, 6, 0)` and `(6, 6, 0)`, and with a strut, a cable and a
// rail there — and each material's half-mass is exactly what the cable picks up.
// The rail pose extends the trolley's track, which is the only way a rail member
// can stand at all (specs/structure.md, "The trolley and the rail").
//
// ONE RIG CARRIES ALL FOUR READINGS. The rig is posed once with nothing on the
// span, and each material is then placed on the span and taken off again: an edit
// that lands "pushes the undo history exactly as a click would" and a removal "is
// always allowed" (specs/instrumentation.md), so the geometry the three readings
// are compared over is demonstrably ONE geometry rather than four this file
// asserts are the same. Nothing here advances a tick: `check` "computes the check
// and returns it" on the spot, which is the whole of what this point reads.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear, assertTrue } from "../assert";
import {
  CABLE_MASS_PER_UNIT,
  GRAVITY,
  RAIL_MASS_PER_UNIT,
  STRUT_MASS_PER_UNIT,
} from "../constants";
import {
  clearAll,
  createHarness,
  distance3,
  openSite,
  poseCrane,
  type CraneDesign,
  type DesignMember,
  type Harness,
  type MaterialName,
} from "../harness";

/** The span a force in the tens is read to. */
const TOLERANCE = 1e-6;

/** The member the four poses differ in: present, and of which material. */
const TEST_SPAN: readonly [
  readonly [number, number, number],
  readonly [number, number, number],
] = [
  [4, 6, 0],
  [6, 6, 0],
];

/** The mast cable whose force the reading is taken from. */
const READ_SPAN: readonly [
  readonly [number, number, number],
  readonly [number, number, number],
] = [
  [2, 10, 0],
  [6, 6, 0],
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

/**
 * The rig with `(6, 6, 0)` braced back to a second arm node as well, so it stands
 * on three members of its own and the span under test can be left out entirely.
 */
const EXTRA: readonly DesignMember[] = [
  [[4, 6, 2], [2, 6, 2], "strut"],
  [[4, 6, 2], [2, 6, 0], "strut"],
  [[2, 10, 0], [4, 6, 2], "strut"],
  [[6, 6, 0], [4, 6, 2], "strut"],
];

const spans = (m: DesignMember) =>
  m[0][0] === TEST_SPAN[0][0] &&
  m[0][1] === TEST_SPAN[0][1] &&
  m[0][2] === TEST_SPAN[0][2] &&
  m[1][0] === TEST_SPAN[1][0] &&
  m[1][1] === TEST_SPAN[1][1] &&
  m[1][2] === TEST_SPAN[1][2];

/** The rig with nothing on the span under test: what all four readings share. */
const BARE_RIG: CraneDesign = {
  ...JIB_RIG,
  name: "Jib rig, no span",
  members: [...JIB_RIG_MEMBERS.filter((m) => !spans(m)), ...EXTRA],
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("weighs a member at its length times its material's mass per unit", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await poseCrane(h, BARE_RIG);

  const { structure } = await h.snapshot();
  const cable = structure.members.find(
    (m) =>
      (m.a.x === READ_SPAN[0][0] &&
        m.a.y === READ_SPAN[0][1] &&
        m.a.z === READ_SPAN[0][2] &&
        m.b.x === READ_SPAN[1][0] &&
        m.b.y === READ_SPAN[1][1] &&
        m.b.z === READ_SPAN[1][2]) ||
      (m.b.x === READ_SPAN[0][0] &&
        m.b.y === READ_SPAN[0][1] &&
        m.b.z === READ_SPAN[0][2] &&
        m.a.x === READ_SPAN[1][0] &&
        m.a.y === READ_SPAN[1][1] &&
        m.a.z === READ_SPAN[1][2]),
  );
  if (cable === undefined) {
    throw new Error("gantry: the posed rig carries no mast cable to (6, 6, 0)");
  }

  /** What the mast cable is carrying, as the rig stands right now. */
  const readMastCable = async (material: MaterialName | null) => {
    const result = await h.check();
    assertTrue(
      result.stable,
      `the rig stands with ${material ?? "no"} span at (4, 6, 0)-(6, 6, 0)`,
    );
    const reading = result.members.find((m) => m.id === cable.id);
    if (reading === undefined) {
      throw new Error(
        `gantry: the check reported no force for member ${cable.id}`,
      );
    }
    return reading.force;
  };

  /** Put `material` on the span under test, and answer the id it took. */
  const placeSpan = async (material: MaterialName) => {
    await h.debug.addMember(
      TEST_SPAN[0][0],
      TEST_SPAN[0][1],
      TEST_SPAN[0][2],
      TEST_SPAN[1][0],
      TEST_SPAN[1][1],
      TEST_SPAN[1][2],
      material,
    );
    const placed = (await h.snapshot()).structure;
    const id = placed.nextMemberId - 1;
    assertTrue(
      placed.members.some((m) => m.id === id),
      `the ${material} span at (4, 6, 0)-(6, 6, 0) to be accepted, taking the ` +
        "structure's nextMemberId (specs/instrumentation.md)",
    );
    return id;
  };

  // How much of a vertical load at (6, 6, 0) the mast cable takes: all of it,
  // divided by its own vertical direction cosine.
  const length = distance3(
    { x: READ_SPAN[0][0], y: READ_SPAN[0][1], z: READ_SPAN[0][2] },
    { x: READ_SPAN[1][0], y: READ_SPAN[1][1], z: READ_SPAN[1][2] },
  );
  const cosine = Math.abs(READ_SPAN[0][1] - READ_SPAN[1][1]) / length;
  const spanLength = distance3(
    { x: TEST_SPAN[0][0], y: TEST_SPAN[0][1], z: TEST_SPAN[0][2] },
    { x: TEST_SPAN[1][0], y: TEST_SPAN[1][1], z: TEST_SPAN[1][2] },
  );

  const bare = await readMastCable(null);
  const table: readonly (readonly [MaterialName, number])[] = [
    ["strut", STRUT_MASS_PER_UNIT],
    ["cable", CABLE_MASS_PER_UNIT],
    ["rail", RAIL_MASS_PER_UNIT],
  ];
  try {
    for (const [material, perUnit] of table) {
      const id = await placeSpan(material);
      const withSpan = await readMastCable(material);
      await h.debug.removeMember(id);
      assertNear(
        withSpan - bare,
        (((spanLength * perUnit) / 2) * GRAVITY) / cosine,
        TOLERANCE,
        `the mast cable picking up half of a length-${spanLength} ${material}'s ` +
          `mass — ${spanLength} * ${perUnit} / 2 mass units under GRAVITY — at ` +
          "the node it hangs (specs/statics.md, specs/structure.md)",
      );
    }
  } finally {
    // In a `finally`, so a check that fails inside the sweep still leaves
    // the picture that shows why.
    await h.advance(1);
    await h.capture(
      "material-masses",
      "The rig whose outboard rail node hangs on one mast cable",
    );
  }
});

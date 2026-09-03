// editor/ring-occupies-eight-nodes — the ring is placed by its base corner, and
// the eight flange nodes it occupies are nodes the structure uses.
//
// `specs/structure.md` § The slew ring: the ring "is placed by its base corner, a
// lattice node `(x, y, z)`, and occupies eight nodes: the bottom flange, the four
// nodes `(x, y, z)`, `(x + LATTICE_PITCH, y, z)`, `(x, y, z + LATTICE_PITCH)`,
// and `(x + LATTICE_PITCH, y, z + LATTICE_PITCH)`, and the top flange, the same
// four nodes at `y + LATTICE_PITCH`".
//
// WHY A COUNTERWEIGHT IS THE PROBE. Nothing in the snapshot lists the ring's
// eight nodes: `structure.ring` reports the base corner alone, and the other
// seven exist only in what the rules do with them. `specs/structure.md` §
// Counterweights fixes exactly that reading — a counterweight is "placed on any
// node the structure uses, a node a member ends at or a flange node of the ring",
// and "a counterweight placement is refused on a node the structure does not
// use". So a counterweight lands on each of the eight and on nothing else, and
// asking for nine says which eight the build thinks the ring occupies.
//
// THE NINTH IS THE CONTROL, not a second requirement: without it a build that
// accepted a counterweight on every lattice node in the envelope would pass, and
// the check would have measured nothing. `(4, 4, 0)` is on the bottom flange's
// level and one pitch outside the flange square, so only the ring's extent
// separates it from the eight.
//
// The world is emptied first, so the only nodes the structure uses are the
// ring's: no member ends anywhere, and every acceptance below is the ring's
// doing. Site 0's envelope reaches x/z `-8` to `12` and y `0` to `16`, so all
// nine nodes lie inside it, and its budget of `3000` covers `RING_COST` plus nine
// counterweights, so nothing here is refused for room or for money.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertContains,
  assertEqual,
  assertLength,
  assertNotNull,
} from "../assert";
import { LATTICE_PITCH } from "../constants";
import { createHarness, openSite, type Harness, type Vec3 } from "../harness";

/** The ring's base corner: off the ground, as the ring rule requires. */
const CORNER: Vec3 = { x: 0, y: 4, z: 0 };

/** The eight nodes `specs/structure.md` says that corner puts the ring on. */
const FLANGE_NODES: readonly Vec3[] = [
  { x: CORNER.x, y: CORNER.y, z: CORNER.z },
  { x: CORNER.x + LATTICE_PITCH, y: CORNER.y, z: CORNER.z },
  { x: CORNER.x, y: CORNER.y, z: CORNER.z + LATTICE_PITCH },
  { x: CORNER.x + LATTICE_PITCH, y: CORNER.y, z: CORNER.z + LATTICE_PITCH },
  { x: CORNER.x, y: CORNER.y + LATTICE_PITCH, z: CORNER.z },
  { x: CORNER.x + LATTICE_PITCH, y: CORNER.y + LATTICE_PITCH, z: CORNER.z },
  { x: CORNER.x, y: CORNER.y + LATTICE_PITCH, z: CORNER.z + LATTICE_PITCH },
  {
    x: CORNER.x + LATTICE_PITCH,
    y: CORNER.y + LATTICE_PITCH,
    z: CORNER.z + LATTICE_PITCH,
  },
];

/** One pitch beyond the flange square, on the bottom flange's own level. */
const OUTSIDE: Vec3 = {
  x: CORNER.x + 2 * LATTICE_PITCH,
  y: CORNER.y,
  z: CORNER.z,
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("stands the ring on its base corner and uses the eight flange nodes", async () => {
  await openSite(h, 0);
  // The precondition is an empty structure and nothing else. A site opened
  // after a reset already carries one (specs/state.md), and `clearStructure`
  // states it rather than leaving it implied; emptying the yard and the tape
  // too would drive surface this requirement does not concern.
  await h.debug.clearStructure();

  await h.debug.setRing(CORNER.x, CORNER.y, CORNER.z);
  const posed = await h.snapshot();
  assertNotNull(posed.structure.ring, "the ring setRing places");
  assertEqual(
    posed.structure.ring?.corner.x,
    CORNER.x,
    "the base corner's x, the node the ring was placed by",
  );
  assertEqual(posed.structure.ring?.corner.y, CORNER.y, "the base corner's y");
  assertEqual(posed.structure.ring?.corner.z, CORNER.z, "the base corner's z");

  for (const node of FLANGE_NODES) {
    await h.debug.addCounterweight(node.x, node.y, node.z);
  }
  await h.debug.addCounterweight(OUTSIDE.x, OUTSIDE.y, OUTSIDE.z);
  await h.advance(1);

  const { structure } = await h.snapshot();
  for (const node of FLANGE_NODES) {
    assertContains(
      structure.counterweights,
      node,
      `a counterweight on (${node.x}, ${node.y}, ${node.z}), a flange node of ` +
        `the ring at (${CORNER.x}, ${CORNER.y}, ${CORNER.z})`,
    );
  }
  assertLength(
    structure.counterweights,
    FLANGE_NODES.length,
    `the counterweights that landed: the ring's eight flange nodes and not ` +
      `(${OUTSIDE.x}, ${OUTSIDE.y}, ${OUTSIDE.z}), which the ring does not occupy`,
  );

  await h.capture(
    "ring-occupies-eight-nodes",
    "The ring's eight flange nodes, each carrying a counterweight",
  );
});

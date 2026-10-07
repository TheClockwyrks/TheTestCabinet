// editor/member-refused-joining-arm-to-tower — a member joining the arm to the
// tower outside the ring is refused.
//
// `specs/structure.md` § The editor's rules: "A member placement is refused when:
// ... it would join the arm to the tower anywhere but through the ring: adding it
// would create a path of members between a bottom-flange or anchor node and a
// top-flange node." § The slew ring says why: force crossing between the flanges
// "is the only path between the arm and the tower", and the ring "divides the
// structure in two" — a member from one half to the other would carry load around
// the bearing.
//
// The world is the ring and nothing else, and the member offered joins one of its
// bottom-flange nodes to the top-flange node directly over it: the shortest path
// there is between the two halves, and the one a build that checks nothing at all
// will place. Both nodes are on the lattice inside site 1's envelope, the strut is
// two units long, the yard holds no obstacle, and no member joins them already, so
// this rule is the only one the placement can break. The rule read through a chain
// of members, rather than through the placed member's own ends, is the same rule
// reaching further and has a validator of its own.

import { afterEach, beforeEach, it } from "vitest";
import { assertClose, assertLength, assertNotNull } from "../assert";
import { LATTICE_PITCH, RING_COST } from "../constants";
import { createHarness, emptyYard, openSite, type Harness } from "../harness";

/** The ring's base corner, off the ground as `specs/structure.md` requires. */
const CORNER = { x: 0, y: 4, z: 0 };

/** One bottom-flange node, and the top-flange node at the same x and z. */
const BOTTOM = { x: CORNER.x, y: CORNER.y, z: CORNER.z };
const TOP = { x: CORNER.x, y: CORNER.y + LATTICE_PITCH, z: CORNER.z };

/** Costs are sums of exact figures, so this is float slop and nothing more. */
const COST_TOL = 1e-6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("places no member between a bottom-flange node and a top-flange node", async () => {
  await openSite(h, 0);
  await emptyYard(h);

  await h.debug.setRing(CORNER.x, CORNER.y, CORNER.z);
  const ringed = await h.snapshot();
  assertNotNull(
    ringed.structure.ring,
    "the ring the placement landed, which divides the structure in two " +
      "(specs/structure.md)",
  );

  await h.debug.addMember(
    BOTTOM.x,
    BOTTOM.y,
    BOTTOM.z,
    TOP.x,
    TOP.y,
    TOP.z,
    "strut",
  );

  const s = await h.snapshot();
  await h.advance(1);
  await h.capture("refused", "The flanges the member did not join");

  assertLength(
    s.structure.members,
    0,
    "the members joining the arm to the tower outside the ring " +
      "(specs/structure.md)",
  );
  assertClose(
    s.structure.cost,
    RING_COST,
    COST_TOL,
    "the cost a refused edit spends: none (specs/structure.md)",
  );
});

// editor/member-refused-same-node — a member whose two ends are the same node is
// refused.
//
// `specs/structure.md` § Members opens with what a member is: "A member is a
// straight element between two **distinct** lattice nodes", and § The editor's
// rules enforces it: "A member placement is refused when: either end is outside
// the envelope, **or the ends are the same node**". A refused edit changes
// nothing.
//
// The node is handed over twice on an empty lattice. It is on the lattice and
// inside site 1's envelope, the yard is empty of obstacles, and the crane carries
// no ring, so the ends being the same node is the only rule the placement can
// break — and an empty structure afterwards is the whole reading.

import { afterEach, beforeEach, it } from "vitest";
import { assertClose, assertLength } from "../assert";
import { createHarness, emptyYard, openSite, type Harness } from "../harness";

/** The node handed over as both ends. */
const NODE = { x: 2, y: 0, z: 2 };

/** Costs are sums of exact figures, so this is float slop and nothing more. */
const COST_TOL = 1e-6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("places no member between a node and itself", async () => {
  await openSite(h, 0);
  await emptyYard(h);

  await h.debug.addMember(
    NODE.x,
    NODE.y,
    NODE.z,
    NODE.x,
    NODE.y,
    NODE.z,
    "strut",
  );

  const s = await h.snapshot();
  await h.advance(1);
  await h.capture("refused", "The bare lattice the self-joining member left");

  assertLength(
    s.structure.members,
    0,
    "the members between a node and itself: a member joins two distinct nodes " +
      "(specs/structure.md)",
  );
  assertClose(
    s.structure.cost,
    0,
    COST_TOL,
    "the cost a refused edit spends: none (specs/structure.md)",
  );
});

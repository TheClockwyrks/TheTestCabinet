// controls/pending-node-survives-a-counterweight-click — a click under the
// counterweight tool leaves a held pending node held.
//
// `specs/controls.md` § The build tools: "A pending node belongs to the placement
// rather than the tool, so it survives every tool switch. The ring, counterweight,
// and delete tools neither read it nor clear it: a click under one of them does
// what its bullet says and leaves the pending node held." This item is the
// counterweight tool's third of that sentence, and both halves of it are read:
// the click's own effect landed — "a click on a node without a counterweight
// places one there" — and the pending node is still the node it was given.
//
// THE PENDING NODE IS POSED RATHER THAN CLICKED. `setPendingNode` "holds that
// lattice node as the pending first node of a member placement, as a first click
// does" (`specs/instrumentation.md`), so a build whose picking is broken fails
// the picking items and this one decides the counterweight tool's click alone.
// `(0, 0, 0)` is a ground anchor of site 1, on the lattice pitch and inside its
// envelope, and it is drawn far from the node the click is made at.
//
// THE STRUCTURE IS A RING AND NOTHING ELSE. A counterweight stands only "on any
// node the structure uses, a node a member ends at or a flange node of the ring"
// (`specs/structure.md`), so the click needs a node the structure uses; a lone
// ring at `(0, 2, 0)` gives it eight of them without a member anywhere. The click
// lands on the top-flange node `(0, 4, 0)`, which is not the node held pending,
// so the two readings cannot be confused. Both poses are far inside site 1's
// budget of `3000` and every flange node is inside its envelope.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNotNull,
  assertTrue,
} from "../assert";
import {
  createHarness,
  emptyYard,
  openSite,
  type Harness,
  type Vec3,
} from "../harness";

/** The node held pending: a ground anchor of site 1. */
const PENDING: Vec3 = { x: 0, y: 0, z: 0 };

/** The ring's base corner, and the flange node the click lands on. */
const RING: Vec3 = { x: 0, y: 2, z: 0 };
const NODE: Vec3 = { x: 0, y: 4, z: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("places the counterweight and leaves the pending node held", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await h.debug.setRing(RING.x, RING.y, RING.z);
  await h.debug.setPendingNode(PENDING.x, PENDING.y, PENDING.z);
  assertNotNull(
    (await h.snapshot()).pendingNode,
    "the pending node setPendingNode holds (specs/instrumentation.md)",
  );

  await h.debug.setTool("counterweight");
  const at = await h.project(NODE.x, NODE.y, NODE.z);
  assertTrue(
    at.visible,
    `the flange node (${NODE.x}, ${NODE.y}, ${NODE.z}) is drawn on the stage`,
  );
  await h.click(at.x, at.y);

  const s = await h.snapshot();
  assertLength(
    s.structure.counterweights,
    1,
    "the counterweight the click under the counterweight tool places " +
      "(specs/controls.md)",
  );
  assertEqual(
    JSON.stringify(s.structure.counterweights[0]),
    JSON.stringify(NODE),
    "the node the counterweight was placed on",
  );
  assertNotNull(
    s.pendingNode,
    "the pending node after a click under the counterweight tool, which " +
      "neither reads it nor clears it (specs/controls.md)",
  );
  assertEqual(
    JSON.stringify(s.pendingNode),
    JSON.stringify(PENDING),
    "the node still held pending",
  );

  await h.advance(1);
  await h.capture(
    "state",
    "The counterweight placed with the pending node still held",
  );
});

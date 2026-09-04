// controls/pending-node-survives-a-ring-click — a click under the ring tool
// leaves a held pending node held.
//
// `specs/controls.md` § The build tools: "The ring, counterweight, and delete
// tools neither read it nor clear it: a click under one of them does what its
// bullet says and leaves the pending node held." This item is the ring tool's
// third of that sentence, and both halves of it are read: the click's own effect
// landed — "Ring: a click places the ring by its base corner at the picked node"
// — and the pending node is still the node it was given.
//
// THE PENDING NODE IS POSED RATHER THAN CLICKED. `setPendingNode` "holds that
// lattice node as the pending first node of a member placement, as a first click
// does" (`specs/instrumentation.md`), so a build whose picking is broken fails
// the picking items and this one decides the ring tool's click alone. `(0, 0, 0)`
// is a ground anchor of site 1, on the lattice pitch and inside its envelope, and
// it is drawn far from the node the click is made at.
//
// THE STRUCTURE IS EMPTY, so the ring cannot be refused for a ring already
// standing or for joining the arm to the tower — with no members there is no path
// between the flanges and an anchor. The click lands on `(0, 4, 0)`, whose eight
// flange nodes are the four at `y = 4` and the four at `y = 6` above them, every
// one inside site 1's envelope (`x -8..12`, `y 0..16`, `z -8..12`); the corner's
// `y` is not `0`, since "the ring sits on a tower, not on the ground"; and `300`
// is far inside the site's budget of `3000`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertTrue } from "../assert";
import {
  createHarness,
  emptyYard,
  openSite,
  type Harness,
  type Vec3,
} from "../harness";

/** The node held pending: a ground anchor of site 1. */
const PENDING: Vec3 = { x: 0, y: 0, z: 0 };

/** The node the click is made at, which becomes the ring's base corner. */
const NODE: Vec3 = { x: 0, y: 4, z: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("places the ring and leaves the pending node held", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await h.debug.setPendingNode(PENDING.x, PENDING.y, PENDING.z);
  assertNotNull(
    (await h.snapshot()).pendingNode,
    "the pending node setPendingNode holds (specs/instrumentation.md)",
  );

  await h.debug.setTool("ring");
  const at = await h.project(NODE.x, NODE.y, NODE.z);
  assertTrue(
    at.visible,
    `the lattice node (${NODE.x}, ${NODE.y}, ${NODE.z}) is drawn on the stage`,
  );
  await h.click(at.x, at.y);

  const s = await h.snapshot();
  await h.advance(1);
  await h.capture("state", "The ring placed with the pending node still held");

  assertNotNull(
    s.structure.ring,
    "the ring the click under the ring tool places (specs/controls.md)",
  );
  assertEqual(
    JSON.stringify(s.structure.ring?.corner),
    JSON.stringify(NODE),
    "the base corner the ring was placed at",
  );
  assertNotNull(
    s.pendingNode,
    "the pending node after a click under the ring tool, which neither reads " +
      "it nor clears it (specs/controls.md)",
  );
  assertEqual(
    JSON.stringify(s.pendingNode),
    JSON.stringify(PENDING),
    "the node still held pending",
  );
});

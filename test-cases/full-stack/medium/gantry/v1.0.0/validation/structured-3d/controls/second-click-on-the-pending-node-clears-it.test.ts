// controls/second-click-on-the-pending-node-clears-it — a second click on the
// pending node itself clears it and places nothing.
//
// `specs/controls.md` § The build tools: "A second click on the pending node
// itself, or `back`, clears it without placing." The other half of the sentence,
// `back`, is another item's; this one is the click, and both halves of what the
// click does are read: the pending node is gone and no member joined the
// structure. A member could not have been placed anyway — "the ends are the same
// node" is a refusal in `specs/structure.md` — so the reading that decides the
// point is the cleared pending node, with the empty structure saying the clear
// was a clear rather than a placement.
//
// BOTH CLICKS ARE REAL CLICKS at the same projected point, under the strut tool,
// one of the three tools that hold a node pending. The world is emptied first, so
// nothing else stands that either click could pick or that could be mistaken for
// a placement. `(0, 4, 0)` is on the lattice pitch and inside site 1's envelope.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNotNull,
  assertNull,
  assertTrue,
} from "../assert";
import {
  clearAll,
  createHarness,
  openSite,
  type Harness,
  type Vec3,
} from "../harness";

/** The lattice node both clicks are made at. */
const NODE: Vec3 = { x: 0, y: 4, z: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("clears the pending node without placing a member", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await h.debug.setTool("strut");

  const at = await h.project(NODE.x, NODE.y, NODE.z);
  assertTrue(
    at.visible,
    `the lattice node (${NODE.x}, ${NODE.y}, ${NODE.z}) is drawn on the stage`,
  );
  await h.click(at.x, at.y);
  const held = await h.snapshot();
  assertNotNull(
    held.pendingNode,
    "the pending node the first click holds (specs/controls.md)",
  );
  assertEqual(
    JSON.stringify(held.pendingNode),
    JSON.stringify(NODE),
    "the node held pending before the second click",
  );

  await h.click(at.x, at.y);

  const s = await h.snapshot();
  assertNull(
    s.pendingNode,
    "the pending node after a second click on the pending node itself, which " +
      "clears it without placing (specs/controls.md)",
  );
  assertLength(
    s.structure.members,
    0,
    "the members that second click placed: none (specs/controls.md)",
  );

  await h.advance(1);
  await h.capture("state", "The build screen with the pending node cleared");
});

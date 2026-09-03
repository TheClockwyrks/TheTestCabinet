// controls/first-click-holds-the-node-pending — under a member tool the first
// click holds the node it picks pending and places nothing.
//
// `specs/controls.md` § The build tools: "Strut, cable, rail: the first click
// picks a node and holds it pending, visibly marked; the second click on another
// node places the member between them and clears the pending node." So a first
// click is half a placement: the node is held and the structure does not change,
// which is the pair of readings below.
//
// THE CLICK IS MADE UNDER THE STRUT TOOL, one of the three the sentence names,
// and it is a real click through the pointer rather than a posed `setPendingNode`
// — the point is what a CLICK does, and `specs/instrumentation.md` describes the
// pose by it ("as a first click does") rather than the other way round.
//
// THE WORLD IS EMPTY, so `structure.members` is empty going in and any member
// standing afterwards is one this click placed. A node pick needs no structure:
// "A node pick considers every lattice node in the envelope that stands in front
// of the camera", and `(0, 4, 0)` is on the lattice pitch and inside site 1's
// envelope (`x -8..12`, `y 0..16`, `z -8..12`). The click lands on that node's
// projected point, asked of the build because `specs/controls.md` fixes how a
// click picks and not how the yard is drawn.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNotNull,
  assertTrue,
} from "../assert";
import {
  clearAll,
  createHarness,
  openSite,
  type Harness,
  type Vec3,
} from "../harness";

/** The lattice node the first click picks. */
const NODE: Vec3 = { x: 0, y: 4, z: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds the picked node pending and places no member", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await h.debug.setTool("strut");

  const at = await h.project(NODE.x, NODE.y, NODE.z);
  assertTrue(
    at.visible,
    `the lattice node (${NODE.x}, ${NODE.y}, ${NODE.z}) is drawn on the stage`,
  );
  await h.click(at.x, at.y);

  const s = await h.snapshot();
  assertNotNull(
    s.pendingNode,
    "the pending node a first click under the strut tool holds " +
      "(specs/controls.md)",
  );
  assertEqual(
    JSON.stringify(s.pendingNode),
    JSON.stringify(NODE),
    "the node the first click held pending: the one it was made at",
  );
  assertLength(
    s.structure.members,
    0,
    "the members a first click places: none, the second click places the " +
      "member (specs/controls.md)",
  );

  await h.advance(1);
  await h.capture("state", "The build screen with the first node held pending");
});

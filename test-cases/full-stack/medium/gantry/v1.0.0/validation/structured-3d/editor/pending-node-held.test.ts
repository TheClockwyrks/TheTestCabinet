// editor/pending-node-held — setPendingNode holds a lattice node as the pending
// first node of a member placement.
//
// `specs/instrumentation.md` § The structure: "`setPendingNode(x, y, z)` — Holds
// that lattice node as the pending first node of a member placement, as a first
// click does." `specs/controls.md` § The build tools says what a first click
// does: "the first click picks a node and holds it pending, visibly marked; the
// second click on another node places the member between them". So the pose holds
// the node AND places nothing: a first click is half a placement.
//
// `specs/instrumentation.md` reports the field back — "`pendingNode` — `null`
// until a first node is held" — so a call is checked by setting a value and
// reading it back, which is the reading this check takes.
//
// The world is emptied first so `structure.members` is empty going in, and any
// member standing afterwards is one this pose placed. `(0, 0, 0)` is a ground
// anchor of site 0 and inside its envelope.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNotNull } from "../assert";
import {
  clearAll,
  createHarness,
  openSite,
  type Harness,
  type Vec3,
} from "../harness";

/** The node held pending: a ground anchor of site 0. */
const NODE: Vec3 = { x: 0, y: 0, z: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds the node it was given as the pending first node, placing nothing", async () => {
  await openSite(h, 0);
  await clearAll(h);

  await h.debug.setPendingNode(NODE.x, NODE.y, NODE.z);
  await h.advance(1);

  const s = await h.snapshot();
  await h.capture(
    "pending-node-held",
    "The build screen with a node held pending",
  );

  assertNotNull(s.pendingNode, "the pending first node setPendingNode holds");
  assertEqual(s.pendingNode?.x, NODE.x, "the pending node's x");
  assertEqual(s.pendingNode?.y, NODE.y, "the pending node's y");
  assertEqual(s.pendingNode?.z, NODE.z, "the pending node's z");
  assertLength(
    s.structure.members,
    0,
    "the members standing: a first click holds a node and places nothing " +
      "(specs/controls.md)",
  );
});

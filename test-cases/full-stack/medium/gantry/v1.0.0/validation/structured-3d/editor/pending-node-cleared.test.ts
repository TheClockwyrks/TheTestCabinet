// editor/pending-node-cleared — clearPendingNode drops the pending node without
// placing a member.
//
// `specs/instrumentation.md` § The structure: "`clearPendingNode` — Clears the
// pending node without placing, as `back` does." `specs/controls.md` § The build
// tools states what `back` does with one held: "A second click on the pending
// node itself, or `back`, clears it without placing." Both halves are the one
// requirement — the node goes, and nothing is built out of it — so both are read.
//
// THE HELD NODE IS THE PRECONDITION, so it is read back before the clear: a check
// that cleared nothing would find `pendingNode` `null` afterwards and report a
// pass it had not earned.
//
// The world is emptied first, so `structure.members` is empty going in and any
// member standing afterwards is one the clear placed. `(0, 0, 0)` is a ground
// anchor of site 0 and inside its envelope.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertNotNull, assertNull } from "../assert";
import {
  clearAll,
  createHarness,
  openSite,
  type Harness,
  type Vec3,
} from "../harness";

/** The node held pending before the clear: a ground anchor of site 0. */
const NODE: Vec3 = { x: 0, y: 0, z: 0 };

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

  await h.debug.setPendingNode(NODE.x, NODE.y, NODE.z);
  const posed = await h.snapshot();
  assertNotNull(
    posed.pendingNode,
    `the pending node at (${NODE.x}, ${NODE.y}, ${NODE.z}), which the clear ` +
      "is about to drop",
  );

  await h.debug.clearPendingNode();
  await h.advance(1);

  const s = await h.snapshot();
  await h.capture(
    "pending-node-cleared",
    "The build screen with no node held pending",
  );

  assertNull(s.pendingNode, "the pending node clearPendingNode drops");
  assertLength(
    s.structure.members,
    0,
    "the members standing: the clear places nothing (specs/instrumentation.md)",
  );
});

// instrumentation/reset-clears-the-pending-node — a reset holds no pending first
// node.
//
// `specs/instrumentation.md` § The run and the screens: "`reset` restores every
// field the snapshot reports to its title-screen value, bar one: […] no pending
// node". § Snapshot shape reports it as `pendingNode`, resting at "`null` until a
// first node is held, and again once it is placed or cleared".
//
// A node has to be held for the reading to say anything, and `setPendingNode(x, y,
// z)` is what holds one — it "Holds that lattice node as the pending first node of
// a member placement, as a first click does". The node is `(0, 0, 0)`, a ground
// anchor of every site (`specs/sites.md`) and a multiple of `LATTICE_PITCH`, so it
// is inside the domain the operation states. The pose is made on the build screen,
// which is where "These pose single edits", reached by opening site 1 over an
// emptied world: nothing is built, because a pending first node is the editor's
// own state and not the structure's.

import { afterEach, beforeEach, it } from "vitest";
import { assertNotNull, assertNull } from "../assert";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** A ground anchor of every site, and a lattice node (specs/sites.md). */
const NODE = { x: 0, y: 0, z: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds no pending first node after a reset", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await h.debug.setPendingNode(NODE.x, NODE.y, NODE.z);
  const held = await h.snapshot();
  assertNotNull(
    held.pendingNode,
    "the pending first node setPendingNode holds, which is the scenario this " +
      "point rests on",
  );

  await h.debug.reset();
  const s = await h.snapshot();

  await h.advance(1);
  await h.capture("state", "The driven state this point decides");

  assertNull(
    s.pendingNode,
    "pendingNode after a reset (specs/instrumentation.md)",
  );
});

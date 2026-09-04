// controls/pending-node-survives-a-delete-click — a click under the delete tool
// leaves a held pending node held.
//
// `specs/controls.md` § The build tools: "The ring, counterweight, and delete
// tools neither read it nor clear it: a click under one of them does what its
// bullet says and leaves the pending node held." This item is the delete tool's
// third of that sentence, and both halves of it are read: the click's own effect
// landed — "a click removes what it picks, the nearest in screen distance of a
// member within `MEMBER_PICK_PX`" — and the pending node is still the node it was
// given.
//
// THE PENDING NODE IS POSED RATHER THAN CLICKED. `setPendingNode` "holds that
// lattice node as the pending first node of a member placement, as a first click
// does" (`specs/instrumentation.md`), so a build whose picking is broken fails the
// picking items and this one decides the delete tool's click alone. `(4, 4, 0)`
// is on the lattice pitch, inside site 1's envelope, and is neither end of the
// member the click deletes, so the two readings cannot be confused.
//
// THE STRUCTURE IS ONE MEMBER AND NOTHING ELSE — no ring and no counterweight —
// so the click has exactly one thing to take and what it took is unambiguous. The
// strut runs `(0, 0, 0)` to `(0, 4, 0)`: length `4` inside `STRUT_MAX_LEN` (`6`),
// both ends inside the envelope, on an emptied yard, and `40` against a budget of
// `3000`, so nothing in `specs/structure.md` refuses it. The click lands on the
// midpoint of its drawn segment, which is inside `MEMBER_PICK_PX` of it by any
// reading.

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

/** The node held pending: on the lattice, and off the member. */
const PENDING: Vec3 = { x: 4, y: 4, z: 0 };

/** The lone member's two ends. */
const A: Vec3 = { x: 0, y: 0, z: 0 };
const B: Vec3 = { x: 0, y: 4, z: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("deletes the member and leaves the pending node held", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await h.debug.addMember(A.x, A.y, A.z, B.x, B.y, B.z, "strut");
  await h.debug.setPendingNode(PENDING.x, PENDING.y, PENDING.z);
  const posed = await h.snapshot();
  assertLength(
    posed.structure.members,
    1,
    "the member the click deletes (specs/structure.md)",
  );
  assertNotNull(
    posed.pendingNode,
    "the pending node setPendingNode holds (specs/instrumentation.md)",
  );

  await h.debug.setTool("delete");
  const pa = await h.project(A.x, A.y, A.z);
  const pb = await h.project(B.x, B.y, B.z);
  assertTrue(
    pa.visible && pb.visible,
    "both of the member's ends are drawn on the stage",
  );
  await h.click((pa.x + pb.x) / 2, (pa.y + pb.y) / 2);

  const s = await h.snapshot();
  await h.advance(1);
  await h.capture(
    "state",
    "The member deleted with the pending node still held",
  );

  assertLength(
    s.structure.members,
    0,
    "the members standing after a delete click on the only member's drawn " +
      "segment (specs/controls.md)",
  );
  assertNotNull(
    s.pendingNode,
    "the pending node after a click under the delete tool, which neither " +
      "reads it nor clears it (specs/controls.md)",
  );
  assertEqual(
    JSON.stringify(s.pendingNode),
    JSON.stringify(PENDING),
    "the node still held pending",
  );
});

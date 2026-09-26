// controls/pending-node-survives-an-undo — `undo` reverses the edit and leaves a
// held pending node held.
//
// `specs/controls.md` § The build tools: "Placing the member, a click on the
// pending node itself, `back` on the build screen, and opening a site are the
// whole of what clears it". `undo` is not among the four, and the same section
// gives it its own effect and no more: "`undo` reverses the most recent
// structure-changing edit, as far back as the site was opened, exactly as
// `specs/structure.md` states." So both halves are read: the edit is gone and the
// node is still held.
//
// THE UNDO IS PRESSED. The surface carries no undo pose — `specs/instrumentation.md`
// names none — so the `undo` action's key is the only way to reach it, and
// `specs/controls.md` binds it to `KeyZ` on the build screen.
//
// THE PENDING NODE IS POSED RATHER THAN CLICKED: `setPendingNode` "holds that
// lattice node as the pending first node of a member placement, as a first click
// does" (`specs/instrumentation.md`), so a build whose picking is broken fails
// the picking items and this one decides the undo alone. It is held AFTER the
// member is placed, so the undo is undoing an edit that was already there rather
// than the one that held the node.
//
// THE STRUCTURE IS ONE MEMBER, so the undo has exactly one edit to reverse and
// the reading afterwards is unambiguous. The strut runs `(0, 0, 0)` to
// `(0, 4, 0)`: length `4` inside `STRUT_MAX_LEN` (`6`), both ends inside site 1's
// envelope, on an emptied yard, and `40` against a budget of `3000`, so nothing
// in `specs/structure.md` refuses it. `(4, 4, 0)` is on the lattice pitch, inside
// the envelope, and off the member.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNotNull } from "../assert";
import { BINDINGS } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  type Harness,
  type Vec3,
} from "../harness";

/** `undo`'s binding, as `specs/controls.md` fixes it. */
const UNDO = BINDINGS.undo[0]!;

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

it("reverses the edit and leaves the pending node held", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await h.debug.addMember(A.x, A.y, A.z, B.x, B.y, B.z, "strut");
  await h.debug.setPendingNode(PENDING.x, PENDING.y, PENDING.z);
  const posed = await h.snapshot();
  assertLength(
    posed.structure.members,
    1,
    "the member the undo reverses (specs/structure.md)",
  );
  assertNotNull(
    posed.pendingNode,
    "the pending node setPendingNode holds (specs/instrumentation.md)",
  );

  await h.press(UNDO);

  const s = await h.snapshot();
  await h.advance(1);
  await h.capture(
    "state",
    "The undone placement with the pending node still held",
  );

  assertLength(
    s.structure.members,
    0,
    "the members standing after `undo`, which reverses the most recent " +
      "structure-changing edit (specs/controls.md)",
  );
  assertNotNull(
    s.pendingNode,
    "the pending node after `undo`, which is not among the four things that " +
      "clear it (specs/controls.md)",
  );
  assertEqual(
    JSON.stringify(s.pendingNode),
    JSON.stringify(PENDING),
    "the node still held pending",
  );
});

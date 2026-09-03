// controls/delete-tie-member-over-counterweight — a delete tie between a member
// and a counterweight takes the member.
//
// `specs/controls.md` § The build tools: "Delete: a click removes what it picks,
// the nearest in screen distance of a member within `MEMBER_PICK_PX`, a
// counterweight within `NODE_PICK_PX` of its node, or the ring within
// `NODE_PICK_PX` of any of its eight flange nodes. A tie goes to the member, then
// the counterweight, then the ring." This check is the first step of that order.
//
// THE TIE IS EXACT, AND IT IS MADE BY A SHARED NODE. A counterweight hung on an
// end node of the one member standing is measured from that node, and the
// member's projected segment ends at the same node — so a click at the point the
// build says it drew that node at is zero pixels from both. The two distances are
// the same number, not two numbers that happen to be close, so the reading rests
// on the stated order rather than on any tolerance.
//
// A build that answered such a tie with the counterweight leaves the member
// standing and fails here; the stated order removes the member and leaves the
// counterweight where it hangs, because a delete "removes one member, the ring,
// or one counterweight" — one of the three, never two.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertTrue } from "../assert";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** The one member standing: a leg from an anchor of site 1. */
const MEMBER = {
  a: { x: 0, y: 0, z: 0 },
  b: { x: 0, y: 4, z: 0 },
} as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("removes the member when a member and a counterweight tie", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await h.debug.addMember(
    MEMBER.a.x,
    MEMBER.a.y,
    MEMBER.a.z,
    MEMBER.b.x,
    MEMBER.b.y,
    MEMBER.b.z,
    "strut",
  );
  await h.debug.addCounterweight(MEMBER.b.x, MEMBER.b.y, MEMBER.b.z);
  await h.debug.setTool("delete");

  const posed = await h.snapshot();
  assertLength(
    posed.structure.members,
    1,
    "the one member the scenario stands",
  );
  assertLength(
    posed.structure.counterweights,
    1,
    "the counterweight the scenario hangs on that member's top node",
  );
  assertEqual(posed.tool, "delete", "the tool the click is made under");

  const at = await h.project(MEMBER.b.x, MEMBER.b.y, MEMBER.b.z);
  assertTrue(at.visible, "the node the click is made on is on the stage");
  await h.click(at.x, at.y);

  await h.capture("state", "the yard after the tied delete click");

  const s = await h.snapshot();
  assertLength(
    s.structure.members,
    0,
    "the members after a delete click tied between the member and the " +
      "counterweight, which the tie order takes first (specs/controls.md)",
  );
  assertLength(
    s.structure.counterweights,
    1,
    "the counterweights after that click: a delete removes one member, the " +
      "ring, or one counterweight, so the tie the member won leaves this one " +
      "hanging (specs/structure.md)",
  );
});

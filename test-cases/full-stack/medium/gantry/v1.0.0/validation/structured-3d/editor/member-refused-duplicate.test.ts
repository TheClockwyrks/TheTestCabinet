// editor/member-refused-duplicate — a member joining two nodes already joined is
// refused.
//
// `specs/structure.md` § The editor's rules: "A member placement is refused
// when: ... a member already joins the same two nodes, in either direction", and
// "a refused edit changes nothing. There is no error state to leave: the
// structure on screen always satisfies every rule below."
//
// The same call is made twice on an empty lattice, so the two placements differ
// in exactly one thing — whether a member already joins those nodes — and one
// member standing at the end is the whole reading. The ends are four units apart,
// inside site 1's envelope, on the lattice, clear of every obstacle the yard was
// emptied of, and the crane carries no ring, so nothing else in the rule list can
// account for a second member failing to appear.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { createHarness, emptyYard, openSite, type Harness } from "../harness";

/** The two nodes, joined once and then joined again. */
const A = { x: 0, y: 0, z: 0 };
const B = { x: 0, y: 4, z: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves one member where the same two nodes were joined twice", async () => {
  await openSite(h, 0);
  await emptyYard(h);

  await h.debug.addMember(A.x, A.y, A.z, B.x, B.y, B.z, "strut");
  assertLength(
    (await h.snapshot()).structure.members,
    1,
    "the member the first placement lands (specs/structure.md)",
  );

  await h.debug.addMember(A.x, A.y, A.z, B.x, B.y, B.z, "strut");

  const s = await h.snapshot();
  await h.advance(1);
  await h.capture("refused", "The one member the duplicate did not join");

  assertLength(
    s.structure.members,
    1,
    "the members joining those two nodes: a duplicate is refused " +
      "(specs/structure.md)",
  );
  assertEqual(
    s.structure.members[0]?.id,
    0,
    "the member standing: the one the first placement landed",
  );
});

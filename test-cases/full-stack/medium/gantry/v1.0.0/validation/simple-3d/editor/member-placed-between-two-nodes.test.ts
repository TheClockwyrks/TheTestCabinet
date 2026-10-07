// editor/member-placed-between-two-nodes — an accepted placement joins the two
// nodes it was given, with the material it was given.
//
// specs/structure.md opens with what a member IS: "A member is a straight element
// between two distinct lattice nodes, its ends `a` and `b`. ... Each member
// carries a material". So the reading a landed placement leaves is the pair of
// nodes the placement named and that material, and nothing else — this is the
// point every other editor point stands on, which is why it is capped `broken`.
//
// THE STRUCTURE IS EMPTIED FIRST so exactly one member stands and the reading is
// that placement's. `(0, 0, 0)` to `(0, 4, 0)` is a strut of length `4`, inside
// `STRUT_MAX_LEN` (`6`), with both ends inside site 1's envelope (`x -8..12`,
// `y 0..16`, `z -8..12`); the yard is emptied so no obstacle can reach the
// segment, no ring stands so the arm-to-tower rule has no flange to trip on, and
// `40` is well inside the site's budget of `3000`. Nothing in the editor's rules
// can refuse it, so what stands afterwards is the placement itself.
//
// THE TWO ENDS ARE READ AS A PAIR rather than as `a` first and `b` second: the
// specification names them "its ends `a` and `b`" and never says which argument
// becomes which field, so a build free to store the pair either way round is
// conformant and is passed here.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  clearAll,
  createHarness,
  openSite,
  type Harness,
  type MemberView,
} from "../harness";

/** The two lattice nodes the placement names, and the material it carries. */
const A = { x: 0, y: 0, z: 0 };
const B = { x: 0, y: 4, z: 0 };
const MATERIAL = "strut";

/** A member's two ends, written the same way whichever order they come back in. */
function endsOf(member: MemberView): string {
  const one = `(${member.a.x}, ${member.a.y}, ${member.a.z})`;
  const two = `(${member.b.x}, ${member.b.y}, ${member.b.z})`;
  return one < two ? `${one} and ${two}` : `${two} and ${one}`;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports the two nodes it was given and the material it was placed with", async () => {
  await openSite(h, 0);
  await clearAll(h);

  await h.debug.addMember(A.x, A.y, A.z, B.x, B.y, B.z, MATERIAL);

  await h.advance(1);
  await h.capture(
    "member",
    "The lone member between the two nodes it was given",
  );

  const { members } = (await h.snapshot()).structure;
  assertLength(members, 1, "the members an accepted placement leaves standing");
  const member = members[0] as MemberView;
  assertEqual(
    endsOf(member),
    `(${A.x}, ${A.y}, ${A.z}) and (${B.x}, ${B.y}, ${B.z})`,
    "the member's two ends (specs/structure.md)",
  );
  assertEqual(
    member.material,
    MATERIAL,
    "the material the member carries (specs/structure.md)",
  );
});

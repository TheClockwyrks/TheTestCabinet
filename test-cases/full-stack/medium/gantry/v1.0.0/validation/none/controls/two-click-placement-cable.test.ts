// controls/two-click-placement-cable — under the cable tool the second click places
// a cable between the pending node and the picked one, and clears the pending node.
//
// `specs/controls.md` § The build tools: "Strut, cable, rail: the first click
// picks a node and holds it pending, visibly marked; the second click on another
// node places the member between them and clears the pending node." This item is
// the cable tool's, and it reads the whole of what the second click does: the
// member stands between the two nodes that were clicked, carrying the material
// the tool selects, and the pending node is gone.
//
// BOTH CLICKS ARE REAL CLICKS at the two nodes' projected points, asked of the
// build because `specs/controls.md` fixes how a click picks and not how the yard
// is drawn. The nodes are a vertical pair four units apart, so the two are
// drawn far apart and neither click can be read as the other's.
//
// NOTHING CAN REFUSE THE PLACEMENT. The world is emptied first, so the two nodes
// are distinct with no member already joining them, the yard holds no obstacle
// the segment could reach, and no ring stands, so the arm-to-tower rule has no
// flange to trip on. The length is `4`, inside CABLE_MAX_LEN (`24`), both ends are on
// the lattice pitch and inside site 1's envelope (`x -8..12`, `y 0..16`,
// `z -8..12`), and the cost is far inside the site's budget of `3000`. So what
// stands afterwards is the second click's own work.
//
// THE TWO ENDS ARE READ AS A PAIR rather than as `a` first and `b` second:
// `specs/structure.md` names them "its ends `a` and `b`" and never says which
// click becomes which field, so a build free to store the pair either way round
// is conformant and is passed here.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNull, assertTrue } from "../assert";
import {
  createHarness,
  emptyYard,
  openSite,
  type Harness,
  type MemberView,
  type Vec3,
} from "../harness";

/** The two lattice nodes the clicks are made at. */
const A: Vec3 = { x: 0, y: 0, z: 0 };
const B: Vec3 = { x: 0, y: 4, z: 0 };

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

it("places a cable between the two clicked nodes and clears the pending node", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await h.debug.setTool("cable");

  const first = await h.project(A.x, A.y, A.z);
  const second = await h.project(B.x, B.y, B.z);
  assertTrue(
    first.visible && second.visible,
    "both lattice nodes the clicks are made at are drawn on the stage",
  );

  await h.click(first.x, first.y);
  assertEqual(
    JSON.stringify((await h.snapshot()).pendingNode),
    JSON.stringify(A),
    "the node the first click held pending (specs/controls.md)",
  );

  await h.click(second.x, second.y);

  const s = await h.snapshot();
  await h.advance(1);
  await h.capture("state", "The cable the two clicks placed");

  assertLength(
    s.structure.members,
    1,
    "the members the second click placed (specs/controls.md)",
  );
  const member = s.structure.members[0] as MemberView;
  assertEqual(
    endsOf(member),
    `(${A.x}, ${A.y}, ${A.z}) and (${B.x}, ${B.y}, ${B.z})`,
    "the two nodes the placed member joins: the two the clicks picked " +
      "(specs/controls.md)",
  );
  assertEqual(
    member.material,
    "cable",
    "the material the cable tool places (specs/controls.md)",
  );
  assertNull(
    s.pendingNode,
    "the pending node after the second click, which places the member and " +
      "clears it (specs/controls.md)",
  );
});

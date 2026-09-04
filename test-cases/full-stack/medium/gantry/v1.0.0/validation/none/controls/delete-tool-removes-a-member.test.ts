// controls/delete-tool-removes-a-member — under the delete tool a click within
// MEMBER_PICK_PX of a member's drawn segment removes that member.
//
// `specs/controls.md` § The build tools: "Delete: a click removes what it picks,
// the nearest in screen distance of a member within `MEMBER_PICK_PX`, a
// counterweight within `NODE_PICK_PX` of its node, or the ring within
// `NODE_PICK_PX` of any of its eight flange nodes." § Clicks and drags fixes what
// "within" means: "A member pick considers every member's projected segment; the
// candidate is the nearest at most `MEMBER_PICK_PX` (`12`) logical pixels from
// the click."
//
// THE CLICK LANDS BESIDE THE MEMBER RATHER THAN ON IT, ten logical pixels from
// its drawn segment. On it, a build that only removed a member the pointer sat
// exactly over would pass; ten pixels is inside `MEMBER_PICK_PX` (`12`) with two
// pixels to spare, so what the check reads is the screen-distance pick the
// specification states. The point is measured from the midpoint of the drawn
// segment, along the perpendicular to it, so the distance to the segment is
// exactly the offset.
//
// THE STRUCTURE HOLDS THAT MEMBER AND NOTHING ELSE — no ring and no counterweight
// — so the member is the only thing a delete click could take, and the reading
// afterwards is that click's own effect. The strut runs `(0, 0, 0)` to
// `(0, 4, 0)`: length `4` inside `STRUT_MAX_LEN` (`6`), both ends inside site 1's
// envelope, on an emptied yard where no obstacle can reach it, and `40` against a
// budget of `3000` — so nothing in `specs/structure.md` refuses the placement.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertTrue } from "../assert";
import { MEMBER_PICK_PX } from "../constants";
import {
  createHarness,
  emptyYard,
  openSite,
  type Harness,
  type Vec3,
} from "../harness";

/** The lone member's two ends. */
const A: Vec3 = { x: 0, y: 0, z: 0 };
const B: Vec3 = { x: 0, y: 4, z: 0 };

/** How far from the drawn segment the click lands: inside MEMBER_PICK_PX (12). */
const OFFSET_PX = 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("removes the member the click picks by screen distance", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await h.debug.clearStructure();
  await h.debug.addMember(A.x, A.y, A.z, B.x, B.y, B.z, "strut");
  assertLength(
    (await h.snapshot()).structure.members,
    1,
    "the member the click is about (specs/structure.md)",
  );

  const pa = await h.project(A.x, A.y, A.z);
  const pb = await h.project(B.x, B.y, B.z);
  assertTrue(
    pa.visible && pb.visible,
    "both of the member's ends are drawn on the stage",
  );
  const dx = pb.x - pa.x;
  const dy = pb.y - pa.y;
  const span = Math.hypot(dx, dy);
  assertTrue(span > 0, "the member is drawn as a segment rather than a point");
  const at = {
    x: (pa.x + pb.x) / 2 - (dy / span) * OFFSET_PX,
    y: (pa.y + pb.y) / 2 + (dx / span) * OFFSET_PX,
  };

  await h.debug.setTool("delete");
  await h.click(at.x, at.y);

  assertLength(
    (await h.snapshot()).structure.members,
    0,
    `the members standing after a delete click ${OFFSET_PX} logical pixels ` +
      `from the only member's drawn segment, inside MEMBER_PICK_PX ` +
      `(${MEMBER_PICK_PX}) (specs/controls.md)`,
  );

  await h.advance(1);
  await h.capture("state", "The empty structure the delete click left");
});

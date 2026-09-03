// controls/member-pick-radius — a member pick takes the nearest member within
// `MEMBER_PICK_PX` and nothing beyond it.
//
// `specs/controls.md` § Clicks and drags: "A member pick considers every member's
// projected segment; the candidate is the nearest at most `MEMBER_PICK_PX`
// (`12`) logical pixels from the click." `specs/instrumentation.md` says the
// state reports that candidate: "`pick` is the node candidate and the member
// candidate a click at the pointer's current position would take, decided by the
// pick radii and the tie-breaks `specs/controls.md` fixes. Either is `null` when
// nothing is in range."
//
// SO THE RADIUS IS READ FROM BOTH SIDES, one pixel either way of the figure: at
// `INSIDE_PX` (`11`) the member is the candidate, and at `OUTSIDE_PX` (`13`)
// nothing is. Exactly `12` is its own review point; this one decides that the
// radius is `12` rather than some other figure, which needs a reading in range
// and a reading out of it.
//
// THE WORLD HOLDS ONE MEMBER AND NOTHING ELSE. `clearAll` empties the yard, the
// structure and the tape, and one strut is placed back, so "the nearest" has one
// answer and a null reading means the radius, not another member standing
// closer. With no ring placed, the member joins nothing to anything and no
// editor rule can refuse it (`specs/structure.md`).
//
// THE STAGE POINTS ARE DERIVED FROM THE BUILD'S OWN PROJECTION. Nothing in the
// specs fixes the field of view, so where a node is drawn is the build's design:
// the check asks it, through `project`, where it drew the member's two ends, and
// steps away from the segment between them along its own perpendicular. That is
// the distance the pick is measured in — "the projected segment" — so the offset
// is exact whatever the build's camera looks like.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import { MEMBER_PICK_PX } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  type Harness,
  type Projected,
} from "../harness";

/** The one member the world holds: a strut up from a ground anchor. */
const MEMBER = { a: [0, 0, 0], b: [0, 2, 0] } as const;

/** The id `clearStructure` leaves for the first member placed after it. */
const MEMBER_ID = 0;

/** A pixel inside the radius, and a pixel outside it. */
const INSIDE_PX = MEMBER_PICK_PX - 1;
const OUTSIDE_PX = MEMBER_PICK_PX + 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** A point `away` logical pixels from the middle of a projected segment. */
function offMidpoint(
  a: Projected,
  b: Projected,
  away: number,
): { x: number; y: number } {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  // The perpendicular of the segment's own direction, so the offset is the
  // distance from the segment rather than from either end.
  const nx = -(b.y - a.y) / length;
  const ny = (b.x - a.x) / length;
  return {
    x: (a.x + b.x) / 2 + nx * away,
    y: (a.y + b.y) / 2 + ny * away,
  };
}

it("takes the member at 11 pixels and nothing at 13", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await h.debug.addMember(...MEMBER.a, ...MEMBER.b, "strut");

  const a = await h.project(...MEMBER.a);
  const b = await h.project(...MEMBER.b);

  const inside = offMidpoint(a, b, INSIDE_PX);
  await h.pointerMove(inside.x, inside.y);
  await h.advance(1);
  assertEqual(
    (await h.snapshot()).pick.member,
    MEMBER_ID,
    `the member candidate ${INSIDE_PX} logical pixels from the projected ` +
      `segment, inside MEMBER_PICK_PX (${MEMBER_PICK_PX}) ` +
      "(specs/controls.md)",
  );

  const outside = offMidpoint(a, b, OUTSIDE_PX);
  await h.pointerMove(outside.x, outside.y);
  await h.advance(1);
  assertNull(
    (await h.snapshot()).pick.member,
    `the member candidate ${OUTSIDE_PX} logical pixels from the projected ` +
      `segment, beyond MEMBER_PICK_PX (${MEMBER_PICK_PX}) ` +
      "(specs/controls.md)",
  );

  await h.capture("state", "the build screen with the pointer out of range");
});

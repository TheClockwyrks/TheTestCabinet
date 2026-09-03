// controls/member-pick-takes-the-nearest — with two members in range the pick
// takes the nearer.
//
// `specs/controls.md` § Clicks and drags: "A member pick considers every member's
// projected segment; the candidate is the NEAREST at most `MEMBER_PICK_PX`
// (`12`) logical pixels from the click." Being in range is not enough: a build
// that took the first member it found in range, or the last, hands the player a
// different member from the one drawn under the pointer.
//
// TWO MEMBERS SHARING A NODE. `clearAll` empties the world and exactly two struts
// go back: `(0, 0, 0)`–`(0, 2, 0)` and `(0, 0, 0)`–`(2, 2, 0)`. Their projected
// segments meet at the shared node and open out, so a point taken along the first
// of them stands at no distance from it and at a distance from the second that
// grows with how far along it is taken. That is what lets one stage point sit at
// two clearly different distances with both inside the radius — parallel members
// two lattice pitches apart never manage it, because the pitch draws them further
// apart than the radius is wide.
//
// THE POINT IS PLACED FOR A GAP OF `FAR_PX` (`8`) PIXELS. Both members are then
// in range — `0` and `8`, against a radius of `12` — and the gap is two thirds of
// the radius, so a build that answers the further one is not answering a near
// tie. The distances are computed from the build's OWN projection, because
// nothing in the specs fixes the field of view; where the build drew the three
// nodes is asked through `project`, and the geometry is done in the stage units
// the pick is measured in.
//
// The first strut is placed first, so `clearStructure` having returned
// `nextMemberId` to `0` (`specs/instrumentation.md`) it carries id `0` and the
// second carries `1`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThan, assertLessThanOrEqual } from "../assert";
import { MEMBER_PICK_PX } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  type Harness,
  type Projected,
} from "../harness";

/** The shared node the two struts meet at. */
const SHARED = [0, 0, 0] as const;

/** The far end of the nearer member, id `0`. */
const NEAR_END = [0, 2, 0] as const;

/** The far end of the further member, id `1`. */
const FAR_END = [2, 2, 0] as const;

/** The ids the two placements take, in the order they are placed. */
const NEAR_ID = 0;

/** How far the click stands from the further member, in logical pixels. */
const FAR_PX = 8;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** The distance from a point to a projected segment, in stage units. */
function segmentDistance(
  a: Projected,
  b: Projected,
  p: { x: number; y: number },
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const raw = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  const s = Math.min(1, Math.max(0, raw));
  return Math.hypot(a.x + s * dx - p.x, a.y + s * dy - p.y);
}

it("answers the nearer of two members in range", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await h.debug.addMember(...SHARED, ...NEAR_END, "strut");
  await h.debug.addMember(...SHARED, ...FAR_END, "strut");

  const shared = await h.project(...SHARED);
  const near = await h.project(...NEAR_END);
  const far = await h.project(...FAR_END);

  // The click walks along the nearer member from the shared node until the
  // further member stands FAR_PX away: the two projected directions open out by
  // some angle, and the gap grows as the sine of it.
  const nearLen = Math.hypot(near.x - shared.x, near.y - shared.y);
  const farLen = Math.hypot(far.x - shared.x, far.y - shared.y);
  const ux = (near.x - shared.x) / nearLen;
  const uy = (near.y - shared.y) / nearLen;
  const vx = (far.x - shared.x) / farLen;
  const vy = (far.y - shared.y) / farLen;
  const sine = Math.abs(ux * vy - uy * vx);
  const along = FAR_PX / sine;
  const at = { x: shared.x + ux * along, y: shared.y + uy * along };

  // The geometry the scenario needs, read off the build's own projection: the
  // click stands on the nearer member and inside the radius of both.
  const toNear = segmentDistance(shared, near, at);
  const toFar = segmentDistance(shared, far, at);
  assertLessThan(
    toNear,
    toFar,
    "the click's distance to member 0, which the scenario places nearer than " +
      `its ${toFar.toFixed(2)} to member 1`,
  );
  assertLessThanOrEqual(
    toFar,
    MEMBER_PICK_PX,
    `the click's distance to member 1, which the scenario places inside ` +
      `MEMBER_PICK_PX (${MEMBER_PICK_PX}) so both members are candidates`,
  );

  await h.pointerMove(at.x, at.y);
  await h.advance(1);
  assertEqual(
    (await h.snapshot()).pick.member,
    NEAR_ID,
    `the member candidate with member 0 at ${toNear.toFixed(2)} logical ` +
      `pixels and member 1 at ${toFar.toFixed(2)}, both inside ` +
      `MEMBER_PICK_PX (${MEMBER_PICK_PX}): the pick takes the NEAREST ` +
      "(specs/controls.md)",
  );

  await h.capture("state", "the build screen with two members in range");
});

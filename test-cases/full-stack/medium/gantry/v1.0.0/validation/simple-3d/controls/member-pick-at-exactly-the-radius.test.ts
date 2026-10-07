// controls/member-pick-at-exactly-the-radius — a member exactly
// `MEMBER_PICK_PX` from the click is still a candidate.
//
// `specs/controls.md` § Clicks and drags: "the candidate is the nearest at most
// `MEMBER_PICK_PX` (`12`) logical pixels from the click." AT MOST is the whole of
// this point: `12` is in range, so a build that took the radius as a strict bound
// loses a pick a player is promised. `specs/instrumentation.md` has the state
// report that candidate as `pick.member`, "the member candidate a click at the
// pointer's current position would take, decided by the pick radii and the
// tie-breaks `specs/controls.md` fixes".
//
// THE WORLD HOLDS ONE MEMBER AND NOTHING ELSE. `clearAll` empties the yard, the
// structure and the tape, and one strut is placed back, so the reading is the
// bound and not another member standing nearer. With no ring placed, the member
// joins nothing to anything and no editor rule can refuse it
// (`specs/structure.md`).
//
// THE OFFSET IS DERIVED FROM THE BUILD'S OWN PROJECTION. Nothing in the specs
// fixes the field of view, so the check asks the build, through `project`, where
// it drew the member's two ends and steps exactly `MEMBER_PICK_PX` off the
// midpoint of that segment along its perpendicular. The distance from the
// projected segment is then exactly the figure the specification names, measured
// the way the specification measures it, whatever camera the build drew through.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
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
  const nx = -(b.y - a.y) / length;
  const ny = (b.x - a.x) / length;
  return {
    x: (a.x + b.x) / 2 + nx * away,
    y: (a.y + b.y) / 2 + ny * away,
  };
}

it("takes the member with the click exactly MEMBER_PICK_PX away", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await h.debug.addMember(...MEMBER.a, ...MEMBER.b, "strut");

  const a = await h.project(...MEMBER.a);
  const b = await h.project(...MEMBER.b);
  const at = offMidpoint(a, b, MEMBER_PICK_PX);

  await h.pointerMove(at.x, at.y);
  await h.advance(1);
  const after = await h.snapshot();

  await h.capture("state", "the build screen with the pointer at the radius");

  assertEqual(
    after.pick.member,
    MEMBER_ID,
    `the member candidate exactly MEMBER_PICK_PX (${MEMBER_PICK_PX}) logical ` +
      "pixels from the projected segment, which is AT MOST the radius and so " +
      "in range (specs/controls.md)",
  );
});

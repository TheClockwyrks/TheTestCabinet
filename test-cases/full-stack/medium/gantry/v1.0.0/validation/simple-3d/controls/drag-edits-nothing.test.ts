// controls/drag-edits-nothing — a press that has become an orbit drag edits
// nothing, however it is released.
//
// `specs/controls.md` § Clicks and drags: "A drag edits nothing, and a click
// edits the structure on the build screen alone". A player who reaches for the
// camera over the crane must not lose part of it, so the release position is
// irrelevant once the press is a drag — even a release straight over what the
// tool would take.
//
// THE DELETE TOOL, RELEASED ON THE MEMBER. `clearAll` empties the world and one
// strut goes back. "Delete: a click removes what it picks, the nearest in screen
// distance of a member within `MEMBER_PICK_PX`", so a CLICK released on that
// member's projected segment removes it; this gesture releases in exactly that
// place and must not.
//
// THE GESTURE IS A ONE-MOVE DRAG, and the move is the one that carries the press
// across the boundary — which turns nothing ("the movement that carried it across
// the boundary turns nothing"). So the press goes down `AWAY_PX` (`20`) logical
// pixels off the segment, well past `CLICK_SLOP` (`6`), and the single move lands
// on the segment itself: the press is a drag from that move, the camera has not
// turned, and the pointer is over the member when it is released.
//
// The stage points are stepped off the build's own projection of the member's two
// ends, because nothing in the specs fixes the field of view; and the pick is read
// back at the release position first, so the scenario is one where a click WOULD
// have deleted.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { CLICK_SLOP } from "../constants";
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

/** Where the press goes down: far enough off the segment to pass the slop. */
const AWAY_PX = 20;

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

it("leaves the member standing when a drag is released over it", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await h.debug.addMember(...MEMBER.a, ...MEMBER.b, "strut");
  await h.debug.setTool("delete");

  const a = await h.project(...MEMBER.a);
  const b = await h.project(...MEMBER.b);
  const on = offMidpoint(a, b, 0);
  const off = offMidpoint(a, b, AWAY_PX);

  // Where the drag will be released, read back through the build's own pick: a
  // click there would take the member, which is what makes this a test of the
  // drag rather than of the pick radius.
  await h.pointerMove(on.x, on.y);
  await h.advance(1);
  assertEqual(
    (await h.snapshot()).pick.member,
    MEMBER_ID,
    "the member candidate at the position the drag is released from " +
      "(specs/controls.md)",
  );

  await h.pointerDown(off.x, off.y);
  await h.advance(1);
  // One move of AWAY_PX, past CLICK_SLOP: the press becomes a drag on it, and
  // this being the crossing move it turns the camera by nothing, so the segment
  // is still drawn where it was.
  await h.pointerMove(on.x, on.y);
  await h.advance(1);
  assertEqual(
    (await h.snapshot()).pointer.dragging,
    true,
    `the press after a move of ${AWAY_PX} logical pixels, past CLICK_SLOP ` +
      `(${CLICK_SLOP}): it is an orbit drag (specs/controls.md)`,
  );
  await h.pointerUp();
  await h.advance(1);

  assertLength(
    (await h.snapshot()).structure.members,
    1,
    "the members standing after an orbit drag released over one with the " +
      "delete tool: a drag edits nothing (specs/controls.md)",
  );

  await h.capture("state", "the build screen after the drag was released");
});

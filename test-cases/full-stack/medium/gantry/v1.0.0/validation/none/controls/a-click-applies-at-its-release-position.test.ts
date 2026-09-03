// controls/a-click-applies-at-its-release-position — a click acts where it was
// let go, not where it went down.
//
// `specs/controls.md` § Clicks and drags: "A press whose pointer stays less than
// `CLICK_SLOP` (`6`) logical pixels from the position it went down at is a click,
// APPLIED AT THE POSITION IT WAS RELEASED FROM." A press that drifts a few pixels
// under the player's finger is still a click, and the pixel it counts is the last
// one, so the two positions have to pick different things for the rule to be
// readable.
//
// THE MEMBER PICK IS WHAT SEPARATES THEM, and it is chosen over the node pick
// because it needs nothing but the one member the world holds: a node pick
// "considers every lattice node in the envelope", a set the site fixes and a
// check cannot thin out, while a member pick considers "every member's projected
// segment" and `clearAll` leaves exactly the one placed back. So the press goes
// down `PRESS_PX` (`16`) logical pixels from that segment — outside
// `MEMBER_PICK_PX` (`12`), where a click takes nothing — and the pointer drifts
// `5.5` pixels toward it, to `RELEASE_PX` (`10.5`), which is in range. The drift
// is less than `CLICK_SLOP`, so the press is a click throughout and never becomes
// an orbit drag.
//
// THE DELETE TOOL IS WHAT MAKES THE OUTCOME VISIBLE. "Delete: a click removes
// what it picks, the nearest in screen distance of a member within
// `MEMBER_PICK_PX`" — so a click applied at the release position removes the
// member and a click applied at the press position, where nothing is in range,
// "does nothing". With no counterweight and no ring standing, the member is the
// only thing the tool could take.
//
// Both distances are read back off the build's own `pick` before the gesture, so
// the scenario is the one the specification describes on THIS build's camera:
// nothing in the specs fixes the field of view, and the offsets are stepped off
// the projected segment the pick itself is measured against.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNull } from "../assert";
import { CLICK_SLOP, MEMBER_PICK_PX } from "../constants";
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

/** Where the press goes down: outside the member's pick radius. */
const PRESS_PX = MEMBER_PICK_PX + 4;

/** Where it is released: inside the radius, less than CLICK_SLOP away. */
const RELEASE_PX = PRESS_PX - (CLICK_SLOP - 0.5);

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

it("removes the member the release was over, not the nothing under the press", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await h.debug.addMember(...MEMBER.a, ...MEMBER.b, "strut");
  await h.debug.setTool("delete");

  const a = await h.project(...MEMBER.a);
  const b = await h.project(...MEMBER.b);
  const press = offMidpoint(a, b, PRESS_PX);
  const release = offMidpoint(a, b, RELEASE_PX);

  // The two positions, read back through the build's own pick: nothing in range
  // where the press goes down, the member in range where it is let go.
  await h.pointerMove(press.x, press.y);
  await h.advance(1);
  assertNull(
    (await h.snapshot()).pick.member,
    `the member candidate at the press position, ${PRESS_PX} logical pixels ` +
      `from the projected segment and so beyond MEMBER_PICK_PX ` +
      `(${MEMBER_PICK_PX}) (specs/controls.md)`,
  );
  await h.pointerMove(release.x, release.y);
  await h.advance(1);
  assertEqual(
    (await h.snapshot()).pick.member,
    MEMBER_ID,
    `the member candidate at the release position, ${RELEASE_PX} logical ` +
      "pixels from the projected segment (specs/controls.md)",
  );

  // The click itself: down out of range, a drift of less than CLICK_SLOP into
  // range, up.
  await h.pointerDown(press.x, press.y);
  await h.advance(1);
  await h.pointerMove(release.x, release.y);
  await h.advance(1);
  await h.pointerUp();
  await h.advance(1);

  assertLength(
    (await h.snapshot()).structure.members,
    0,
    "the members standing after a delete click released over the one that " +
      "stood: a click is applied at the position it was released from " +
      "(specs/controls.md)",
  );

  await h.capture("state", "the build screen after the click was released");
});

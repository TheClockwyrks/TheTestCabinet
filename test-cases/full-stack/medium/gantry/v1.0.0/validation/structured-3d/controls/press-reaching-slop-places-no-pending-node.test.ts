// controls/press-reaching-slop-places-no-pending-node — a press that reaches
// `CLICK_SLOP` edits nothing when it is released.
//
// `specs/controls.md` § Clicks and drags: "A press whose pointer reaches
// `CLICK_SLOP` from that position is an orbit drag from that moment until it is
// released, whether or not the pointer comes back inside", and "A drag edits
// nothing". Under the strut tool a click that edited would be visible at once —
// "the first click picks a node and holds it pending" (§ The build tools) — so
// the reading that separates a drag from a click is `pendingNode`.
//
// THE PRESS TRAVELS TEN PIXELS AND IS RELEASED ON A NODE. Ten is past
// `CLICK_SLOP` (`6`), so the press is a drag from the move that carried it there.
// It is released at the point the build says it drew a lattice node at, which is
// where a click WOULD take that node at zero pixels — so a build that treated
// this press as a click leaves the pending node standing and fails here, and one
// that treated it as a drag leaves `pendingNode` null. The press also went down
// within `NODE_PICK_PX` of the same node, so a build that applied the click at
// the position it went down at rather than the one it came up at is caught too.
//
// The yard and the structure are emptied first, so the only thing the pick could
// answer with is the lattice `specs/controls.md` has it consider.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull, assertTrue } from "../assert";
import { CLICK_SLOP } from "../constants";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** The lattice node the press is released on. */
const NODE = { x: 0, y: 4, z: 0 } as const;

/** How far the press travels, in logical pixels: past `CLICK_SLOP`. */
const TRAVEL = CLICK_SLOP + 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds no pending node when the press reaches CLICK_SLOP", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await h.debug.setTool("strut");
  const posed = await h.snapshot();
  assertEqual(posed.tool, "strut", "the tool the press is made under");
  assertNull(posed.pendingNode, "the pending node before the press");

  const at = await h.project(NODE.x, NODE.y, NODE.z);
  assertTrue(at.visible, "the node the press is released on is on the stage");

  await h.pointerDown(at.x + TRAVEL, at.y);
  await h.advance(1);
  await h.pointerMove(at.x, at.y);
  await h.advance(1);
  await h.pointerUp();
  await h.advance(1);

  await h.capture("state", "the build screen after a drag of ten pixels");

  assertNull(
    (await h.snapshot()).pendingNode,
    `the pending node after a press that travelled ${TRAVEL} pixels, reaching ` +
      `CLICK_SLOP (${CLICK_SLOP}): it is an orbit drag, and a drag edits ` +
      "nothing (specs/controls.md)",
  );
});

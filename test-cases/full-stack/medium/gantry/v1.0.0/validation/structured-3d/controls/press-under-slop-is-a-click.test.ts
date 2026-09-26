// controls/press-under-slop-is-a-click — a press whose pointer never travels
// `CLICK_SLOP` edits as a click.
//
// `specs/controls.md` § Clicks and drags: "A press whose pointer stays less than
// `CLICK_SLOP` (`6`) logical pixels from the position it went down at is a
// click, applied at the position it was released from." The strut tool is what
// makes that visible: "the first click picks a node and holds it pending"
// (§ The build tools), so a press that edited as a click leaves the pending node
// standing and one that did not leaves `pendingNode` null.
//
// THE PRESS TRAVELS FOUR PIXELS, and it travels them TOWARD the node rather than
// away from it: it goes down four pixels to the side and is released at the point
// the build says it drew the node at. Four is less than `CLICK_SLOP`, so the
// press is a click; and because the release lands exactly on the node's own
// projected point, the node the click takes is that node at zero pixels and
// cannot be any other — which is what lets this check name the pending node it
// expects without reasoning about the build's lens.
//
// The yard and the structure are emptied first, so nothing but the lattice the
// pick reads stands anywhere: `specs/controls.md` has a node pick consider "every
// lattice node in the envelope", which is there whether or not anything is built.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertTrue } from "../assert";
import { CLICK_SLOP } from "../constants";
import { createHarness, emptyYard, openSite, type Harness } from "../harness";

/** The lattice node the press is released on: an anchor's column, in site 1. */
const NODE = { x: 0, y: 4, z: 0 } as const;

/** How far the press travels, in logical pixels: inside `CLICK_SLOP`. */
const TRAVEL = CLICK_SLOP - 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("places the pending node when the press stays inside CLICK_SLOP", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await h.debug.clearStructure();
  await h.debug.setTool("strut");
  const posed = await h.snapshot();
  assertEqual(posed.tool, "strut", "the tool the press is made under");
  assertTrue(posed.pendingNode === null, "the pending node before the press");

  const at = await h.project(NODE.x, NODE.y, NODE.z);
  assertTrue(at.visible, "the node the press is released on is on the stage");

  await h.pointerDown(at.x + TRAVEL, at.y);
  await h.advance(1);
  await h.pointerMove(at.x, at.y);
  await h.advance(1);
  await h.pointerUp();
  await h.advance(1);

  await h.capture("state", "the build screen after a press of four pixels");

  const s = await h.snapshot();
  assertNotNull(
    s.pendingNode,
    `the pending node after a press that travelled ${TRAVEL} pixels, less ` +
      `than CLICK_SLOP (${CLICK_SLOP}), so it is a click (specs/controls.md)`,
  );
  assertEqual(
    JSON.stringify(s.pendingNode),
    JSON.stringify({ x: NODE.x, y: NODE.y, z: NODE.z }),
    "the node that click held pending: the one it was released on, at zero " +
      "pixels from the release (specs/controls.md)",
  );
});

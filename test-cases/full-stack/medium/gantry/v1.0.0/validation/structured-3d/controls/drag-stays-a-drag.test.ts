// controls/drag-stays-a-drag — a press that has reached `CLICK_SLOP` is a drag
// until it is released, even when the pointer comes back inside.
//
// `specs/controls.md` § Clicks and drags: "A press whose pointer reaches
// `CLICK_SLOP` from that position is an orbit drag FROM THAT MOMENT UNTIL IT IS
// RELEASED, whether or not the pointer comes back inside." A build that decided
// click-or-drag by where the pointer stood at the release would edit under a
// gesture that turned the camera and came home, which is the case this point
// rules out.
//
// SO THE GESTURE GOES OUT AND COMES BACK. The press goes down on a node's drawn
// point, moves `OUT_PX` (`20`) logical pixels away — past `CLICK_SLOP` (`6`), so
// the press is a drag — and comes back to the very position it went down at
// before being released. At the release the pointer stands `0` pixels from the
// press position, which is as far inside the slop as a gesture can be.
//
// THE STRUT TOOL IS WHAT MAKES THE OUTCOME VISIBLE. "Strut, cable, rail: the
// first click picks a node and holds it pending, visibly marked", so a click
// there would leave `pendingNode` holding that node; a drag must leave it `null`.
// `clearAll` empties the world first, so nothing else could have set it and
// `openSite` has already cleared it ("opening a site are the whole of what clears
// it").
//
// THE NODE IS `CAMERA_TARGET` ITSELF, `(0, 6, 0)`: a lattice node on the pitch
// (`LATTICE_PITCH` is `2`), inside site 1's envelope, and the point the orbit
// camera looks at. That last part is what makes the gesture safe to make — the
// return move turns the camera by `ORBIT_PER_PX` per pixel, and the one place in
// the yard whose drawn position an orbit cannot move is the point being orbited,
// so the release lands on the same node it went down on however the camera has
// turned.

import { afterEach, beforeEach, it } from "vitest";
import { assertNotNull, assertNull } from "../assert";
import { CAMERA_TARGET } from "../constants";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** How far the pointer goes before coming back: well past CLICK_SLOP. */
const OUT_PX = 20;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds nothing pending when a drag comes home before its release", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await h.debug.setTool("strut");

  const at = await h.project(CAMERA_TARGET.x, CAMERA_TARGET.y, CAMERA_TARGET.z);

  // The stage point, read back through the build's own pick: a click there would
  // hold a node pending, which is what makes this a reading about the drag.
  await h.pointerMove(at.x, at.y);
  await h.advance(1);
  assertNotNull(
    (await h.snapshot()).pick.node,
    "the node candidate at the point the gesture goes down and comes back to " +
      "(specs/controls.md)",
  );

  await h.pointerDown(at.x, at.y);
  await h.advance(1);
  await h.pointerMove(at.x + OUT_PX, at.y);
  await h.advance(1);
  await h.pointerMove(at.x, at.y);
  await h.advance(1);
  await h.pointerUp();
  await h.advance(1);

  const after = await h.snapshot();

  await h.capture("state", "the build screen after the drag came home");

  assertNull(
    after.pendingNode,
    `the pending node after a press that reached ${OUT_PX} pixels and came ` +
      "back to where it went down: it is an orbit drag from that moment until " +
      "it is released, and a drag edits nothing (specs/controls.md)",
  );
});

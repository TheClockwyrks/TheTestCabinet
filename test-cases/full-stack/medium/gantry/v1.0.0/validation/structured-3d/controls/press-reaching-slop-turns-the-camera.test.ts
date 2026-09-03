// controls/press-reaching-slop-turns-the-camera — the movement a press makes
// after it becomes a drag turns the camera, and the movement that carried it
// across the boundary turns nothing.
//
// `specs/controls.md` § Clicks and drags: "A press whose pointer reaches
// `CLICK_SLOP` from that position is an orbit drag from that moment until it is
// released... A drag turns the camera by the movement it makes after it becomes
// one; the movement that carried it across the boundary turns nothing." § The
// camera fixes what that movement is worth: "rightward movement moves the yaw as
// `right` does... and each turns by `ORBIT_PER_PX` per logical pixel of that
// movement."
//
// SO THE MEASUREMENT IS TWO MOVES. The first is exactly `CLICK_SLOP` (`6`)
// pixels rightward, which is the move that makes the press a drag and turns
// nothing. The second is `DRAG_PX` (`40`) pixels further rightward, every pixel
// of it made as a drag, so it is worth `ORBIT_PER_PX * DRAG_PX` (`10`) degrees of
// yaw and nothing else. A build that also turned by the crossing move would read
// `11.5` degrees, and one that turned by nothing until the release would read
// none of it.
//
// THE TOLERANCE IS HALF A PIXEL OF MOVEMENT, `ORBIT_PER_PX / 2`. A build is free
// to hold the pointer at whole logical pixels (`specs/state.md` fixes the units
// the position is in and not its precision), and this press is delivered at whole
// pixels so that is the whole of the slack; the arithmetic itself is exact,
// because a drag turns by the movement rather than against a frame's delta time.
//
// The press is made on the build screen, one of the three showing the 3D yard,
// on an emptied world so nothing a click could have edited is standing.

import { afterEach, beforeEach, it } from "vitest";
import { assertAngleNear, assertEqual } from "../assert";
import { CAMERA_START_YAW, CLICK_SLOP, ORBIT_PER_PX } from "../constants";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** Where the press goes down, in whole logical stage units. */
const DOWN = { x: 400, y: 300 } as const;

/** The rightward movement made after the press has become a drag. */
const DRAG_PX = 40;

/** What that movement is worth, at the stated rate. */
const TURNED = ORBIT_PER_PX * DRAG_PX;

/** Half a pixel of movement: the slack a build holding whole pixels takes. */
const TOLERANCE = ORBIT_PER_PX / 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("turns the camera by the movement made after the press becomes a drag", async () => {
  await openSite(h, 0);
  await clearAll(h);
  const posed = await h.snapshot();
  assertEqual(posed.screen, "build", "the screen the drag is made on");
  assertEqual(
    posed.camera.yaw,
    CAMERA_START_YAW,
    "the camera yaw a site opening leaves (specs/controls.md)",
  );

  await h.pointerDown(DOWN.x, DOWN.y);
  await h.advance(1);
  // The move that carries the press across the boundary, which turns nothing.
  await h.pointerMove(DOWN.x + CLICK_SLOP, DOWN.y);
  await h.advance(1);
  // And the movement made as a drag, which is the whole of what turns the yaw.
  await h.pointerMove(DOWN.x + CLICK_SLOP + DRAG_PX, DOWN.y);
  await h.advance(1);
  await h.pointerUp();
  await h.advance(1);

  await h.capture("state", "the yard after a drag of forty pixels rightward");

  assertAngleNear(
    (await h.snapshot()).camera.yaw,
    posed.camera.yaw + TURNED,
    TOLERANCE,
    `the camera yaw after a press that reached CLICK_SLOP and then moved ` +
      `${DRAG_PX} pixels rightward, which is ${TURNED} degrees at ` +
      "ORBIT_PER_PX (specs/controls.md)",
  );
});

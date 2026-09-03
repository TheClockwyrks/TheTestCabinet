// controls/zoom-does-nothing-off-the-yard-screens — `zoom-in` held on a menu
// screen changes no camera distance.
//
// `specs/controls.md` § The actions: `zoom-in` and `zoom-out` do "camera distance
// on the 3D screens", and the paragraph under the table fixes the rest — "Every
// action applies where the table says and does nothing elsewhere". § The camera
// names the three screens that show the yard: "The build, program, and run
// screens show the 3D yard through an orbit camera". The select screen is none of
// them, so `zoom-in` reaches no camera there.
//
// THE ACTION IS HELD FOR A WHOLE SECOND. The distance runs against the frame's
// delta time at `ZOOM_RATE` (`20`) units a second, so a build that let the zoom
// reach the camera on a menu screen has pulled the distance from
// `CAMERA_START_DIST` (`40`) halfway to `CAMERA_DIST_MIN` (`10`) by the time the
// key is released — twenty units, far past any rounding a build's own camera
// arithmetic could produce, and nowhere near the clamp that could hide it.
// `TICK_HZ` frames is that second: off the run screen "nothing ticks, and the
// frame is still real: the input delivered since the last frame is read, the
// camera moves against that elapsed time, and the scene is drawn"
// (`specs/instrumentation.md`), so these are exactly the frames a distance would
// move on.
//
// The site is opened first, because the camera "resets to the start pose when a
// site is opened" (`specs/controls.md`), so the distance the hold is measured
// against is the stated start figure rather than whatever a previous screen left.
//
// This decides one direction: that the distance does NOT move here. That
// `zoom-in` DOES move it on the three yard screens is its own review point, so a
// build whose zoom does nothing at all fails there rather than passing here.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS, CAMERA_START_DIST, TICK_HZ } from "../constants";
import { createHarness, openSite, type Harness } from "../harness";

/** The `zoom-in` action's binding, as `specs/controls.md` fixes it. */
const ZOOM_IN = BINDINGS["zoom-in"][0]!;

/** Frames the action is held for: one second, twenty units of zoom. */
const FRAMES = TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the camera distance where it stands under a held zoom-in", async () => {
  await openSite(h, 0);
  await h.debug.setScreen("select");

  const posed = await h.snapshot();
  assertEqual(posed.screen, "select", "the menu screen the action is held on");
  assertEqual(
    posed.camera.dist,
    CAMERA_START_DIST,
    "the camera distance a site opening leaves (specs/controls.md)",
  );

  await h.keyDown(ZOOM_IN);
  await h.advance(FRAMES);
  await h.keyUp(ZOOM_IN);

  assertEqual(
    (await h.snapshot()).camera.dist,
    posed.camera.dist,
    `the camera distance after ${ZOOM_IN} was held for ${FRAMES} frames on ` +
      "the select screen, which is not one of the three screens showing the " +
      "3D yard (specs/controls.md)",
  );

  await h.advance(1);
  await h.capture("state", "the select screen after a held zoom-in");
});

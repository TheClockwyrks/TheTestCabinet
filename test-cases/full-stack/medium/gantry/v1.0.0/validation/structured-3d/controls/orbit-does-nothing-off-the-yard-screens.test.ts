// controls/orbit-does-nothing-off-the-yard-screens — `right` held on a menu
// screen turns no camera.
//
// `specs/controls.md` § The actions: `up`, `down`, `left` and `right` do "menu
// navigation; camera orbit on the 3D screens", and the paragraph under the table
// fixes the rest — "Every action applies where the table says and does nothing
// elsewhere". § The camera names the three: "The build, program, and run screens
// show the 3D yard through an orbit camera", and `specs/ui.md` says the other
// half of the split — "The menus are driven by the key actions alone: the pointer
// operates the 3D scene and the tape editor, never a menu."
//
// THE HELD ACTION IS `right`, AND IT IS HELD LONG ENOUGH TO BE UNMISTAKABLE. The
// orbit runs against the frame's delta time at `ORBIT_KEY_RATE` (`90`) degrees a
// second, so a build that let the direction reach the camera on a menu screen has
// moved the yaw eighteen degrees over the fifth of a second held below — far past
// any rounding a build's own camera arithmetic could produce, and no more frames
// than that reading needs. Off the run screen "nothing ticks, and the frame is
// still real: the input delivered since the last frame is read, the camera moves
// against that elapsed time, and the scene is drawn"
// (`specs/instrumentation.md`), so these are exactly the frames a camera would
// move on.
//
// The site is opened first, which "resets to the start pose when a site is
// opened" (`specs/controls.md`), so the yaw the press is measured against is the
// stated start pose rather than whatever a previous screen left. The screen is
// then `select`, a menu screen, where the same action is the menu's own.
//
// This decides one direction: that the camera does NOT turn here. That `right`
// DOES turn it on the three yard screens is its own review point, so a build that
// never turns the camera at all fails there rather than passing here by accident.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS, CAMERA_START_YAW, TICK_HZ } from "../constants";
import { createHarness, openSite, type Harness } from "../harness";

/** The `right` action's binding, as `specs/controls.md` fixes it. */
const RIGHT = BINDINGS.right[0]!;

/** Frames the action is held for: a fifth of a second, eighteen degrees. */
const FRAMES = TICK_HZ / 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the camera yaw where it stands under a held right", async () => {
  await openSite(h, 0);
  await h.debug.setScreen("select");
  const posed = await h.snapshot();
  assertEqual(posed.screen, "select", "the menu screen the action is held on");
  assertEqual(
    posed.camera.yaw,
    CAMERA_START_YAW,
    "the camera yaw a site opening leaves (specs/controls.md)",
  );

  await h.keyDown(RIGHT);
  await h.advance(FRAMES);
  await h.keyUp(RIGHT);

  assertEqual(
    (await h.snapshot()).camera.yaw,
    posed.camera.yaw,
    `the camera yaw after ${RIGHT} was held for ${FRAMES} frames on the ` +
      "select screen, where the orbit directions drive the menu and nothing " +
      "else (specs/controls.md)",
  );

  await h.advance(1);
  await h.capture("state", "the select screen after a held right");
});

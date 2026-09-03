// instrumentation/reset-returns-the-camera-to-its-start-pose — a reset leaves the
// orbit camera at its start pose.
//
// `specs/instrumentation.md` § The run and the screens lists the camera among the
// fields a reset restores: "the strut tool, no pending node, an empty history,
// the camera at its start pose, no check result showing, …". `specs/controls.md`
// fixes what that pose is: "Start pose | yaw `CAMERA_START_YAW` (`45`), pitch
// `CAMERA_START_PITCH` (`30`), distance `CAMERA_START_DIST` (`40`)".
//
// THE CAMERA IS MOVED OFF THAT POSE FIRST, and moved on all three of its axes at
// once, so a reset that restored only some of them fails here. The posed pose is
// inside every limit `specs/controls.md` sets — yaw `200` is at or above `0` and
// below `360`, pitch `70` is inside `10..80`, distance `20` is inside `10..80` —
// so `setCamera` takes it as given and the reading before the reset is the pose
// that was asked for.
//
// The check stands on the build screen, where the orbit camera is what the player
// is looking through, and on a cleared world: nothing about where the camera
// stands concerns the yard or the crane. No key is held, so nothing turns the
// camera between the pose and the reading.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  CAMERA_START_DIST,
  CAMERA_START_PITCH,
  CAMERA_START_YAW,
} from "../constants";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** A pose off the start pose on all three axes, and inside every limit. */
const POSED = { yaw: 200, pitch: 70, dist: 20 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns the camera to its start pose", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await h.debug.setCamera(POSED.yaw, POSED.pitch, POSED.dist);
  const posed = (await h.snapshot()).camera;
  assertEqual(
    posed.yaw,
    POSED.yaw,
    "the yaw setCamera posed, before the reset",
  );
  assertEqual(
    posed.pitch,
    POSED.pitch,
    "the pitch setCamera posed, before the reset",
  );
  assertEqual(
    posed.dist,
    POSED.dist,
    "the distance setCamera posed, before the reset",
  );

  await h.debug.reset();
  const camera = (await h.snapshot()).camera;
  await h.advance(1);
  await h.capture("camera", "The camera pose a reset leaves");

  assertEqual(
    camera.yaw,
    CAMERA_START_YAW,
    "the camera yaw after a reset (specs/controls.md)",
  );
  assertEqual(
    camera.pitch,
    CAMERA_START_PITCH,
    "the camera pitch after a reset (specs/controls.md)",
  );
  assertEqual(
    camera.dist,
    CAMERA_START_DIST,
    "the camera distance after a reset (specs/controls.md)",
  );
});

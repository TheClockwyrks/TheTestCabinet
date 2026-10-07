// instrumentation/set-camera-inside-the-limits-is-taken-as-given — a camera pose
// already inside the limits is taken exactly as given.
//
// `specs/instrumentation.md` § The run and the screens: "`setCamera(yaw, pitch,
// dist)` sets the orbit camera's pose as the orbit controls set it
// (`specs/controls.md`): the pitch and the distance are held inside their limits,
// and the yaw wraps to at or above `0` and below `360`." Nothing there moves a
// pose that is already legal, so a legal pose comes back unchanged: that is this
// item, and the out-of-range half is its own.
//
// THE POSE IS PICKED TO BE UNAMBIGUOUSLY LEGAL AND UNAMBIGUOUSLY NOT THE DEFAULT.
// Yaw `123` is at or above `0` and below `360`; pitch `45` is inside
// `CAMERA_PITCH_MIN` (`10`) to `CAMERA_PITCH_MAX` (`80`); distance `32` is inside
// `CAMERA_DIST_MIN` (`10`) to `CAMERA_DIST_MAX` (`80`). None of the three is a
// start-pose figure, none is a limit, and no two of them are equal, so a build
// that dropped an argument or crossed two of them fails.
//
// The check stands on the build screen with a cleared world, where the orbit
// camera is what the player looks through, and it reads the pose back without
// advancing a frame: nothing but the camera actions turns the camera, and none is
// held.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** Inside every limit, and equal to no start-pose figure and no bound. */
const POSE = { yaw: 123, pitch: 45, dist: 32 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("takes a camera pose inside the limits exactly as given", async () => {
  await openSite(h, 0);
  await clearAll(h);

  await h.debug.setCamera(POSE.yaw, POSE.pitch, POSE.dist);
  const camera = (await h.snapshot()).camera;
  await h.advance(1);
  await h.capture("camera", "The camera at the pose setCamera was given");

  assertEqual(
    camera.yaw,
    POSE.yaw,
    "the yaw setCamera was given (specs/instrumentation.md)",
  );
  assertEqual(
    camera.pitch,
    POSE.pitch,
    "the pitch setCamera was given (specs/instrumentation.md)",
  );
  assertEqual(
    camera.dist,
    POSE.dist,
    "the distance setCamera was given (specs/instrumentation.md)",
  );
});

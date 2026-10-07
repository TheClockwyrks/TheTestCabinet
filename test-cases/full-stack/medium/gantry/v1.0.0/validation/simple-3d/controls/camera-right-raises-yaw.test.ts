// controls/camera-right-raises-yaw — a held `right` raises the camera yaw at
// `ORBIT_KEY_RATE`.
//
// `specs/controls.md` § The camera: "`right` raises the yaw and `left` lowers it,
// `up` raises the pitch and `down` lowers it, each turning at `ORBIT_KEY_RATE`
// while its action is held", at `ORBIT_KEY_RATE` (`90`) degrees a second, and
// "All four run against the frame's delta time."
//
// SO THE MEASUREMENT IS A COUNTED HOLD. `specs/instrumentation.md` fixes what a
// frame is worth off the run screen — "nothing ticks, and the frame is still
// real: the input delivered since the last frame is read, the camera moves
// against that elapsed time" — and each `advance` frame covers `1 / TICK_HZ`
// seconds, so a hold across `HOLD_FRAMES` frames is exactly
// `ORBIT_KEY_RATE * HOLD_FRAMES / TICK_HZ` degrees of yaw.
//
// A QUARTER SECOND, AND NOT MORE. Twenty-two and a half degrees is far past the
// tolerance and nowhere near the wrap at `360`, so the reading is the rate and
// not the wrapping; and starting from `CAMERA_START_YAW` (`45`) the hold ends at
// `67.5`, so nothing about this reading depends on where `0` is.
//
// THE TOLERANCE IS ONE FRAME OF THE HOLD, `ORBIT_KEY_RATE / TICK_HZ` (`1.5`)
// degrees. A build is free to read its input at the top of a frame or at the
// bottom of it, and the two differ by exactly the one frame the key was held
// across but not read on; nothing else in the arithmetic is approximate.
//
// The site is opened first, because the camera "resets to the start pose when a
// site is opened" (`specs/controls.md`), and that leaves the build screen — one
// of the three the orbit applies on — showing.

import { afterEach, beforeEach, it } from "vitest";
import { assertAngleNear, assertEqual } from "../assert";
import {
  BINDINGS,
  CAMERA_START_YAW,
  ORBIT_KEY_RATE,
  TICK_HZ,
} from "../constants";
import { createHarness, openSite, ticks, type Harness } from "../harness";

/** The `right` action's binding, as `specs/controls.md` fixes it. */
const RIGHT = BINDINGS.right[0]!;

/** A quarter second of hold. */
const HOLD_FRAMES = ticks(0.25);

/** What that hold is worth at the stated rate. */
const TURNED = (ORBIT_KEY_RATE * HOLD_FRAMES) / TICK_HZ;

/** One frame of the hold: the frame a build may read at either end of. */
const TOLERANCE = ORBIT_KEY_RATE / TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises the camera yaw by ORBIT_KEY_RATE for each second right is held", async () => {
  await openSite(h, 0);
  const posed = await h.snapshot();
  assertEqual(
    posed.screen,
    "build",
    "the screen the orbit is driven on, one of the three showing the 3D yard",
  );
  assertEqual(
    posed.camera.yaw,
    CAMERA_START_YAW,
    "the camera yaw a site opening leaves (specs/controls.md)",
  );

  await h.keyDown(RIGHT);
  await h.advance(HOLD_FRAMES);
  await h.keyUp(RIGHT);

  const turned = (await h.snapshot()).camera.yaw;
  await h.advance(1);
  await h.capture("state", "the yard after a quarter second of right");

  assertAngleNear(
    turned,
    posed.camera.yaw + TURNED,
    TOLERANCE,
    `the camera yaw after ${RIGHT} was held for ${HOLD_FRAMES} frames, which ` +
      `is ${TURNED} degrees at ORBIT_KEY_RATE (specs/controls.md)`,
  );
});

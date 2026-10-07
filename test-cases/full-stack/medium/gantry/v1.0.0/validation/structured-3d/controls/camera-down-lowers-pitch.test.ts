// controls/camera-down-lowers-pitch — a held `down` lowers the camera pitch at
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
// `ORBIT_KEY_RATE * HOLD_FRAMES / TICK_HZ` degrees of pitch.
//
// THE HOLD STARTS AT PITCH `60` RATHER THAN AT THE START POSE'S `30`, so that
// what is measured is the rate rather than a limit. `specs/controls.md` holds the
// pitch inside `CAMERA_PITCH_MIN` (`10`) to `CAMERA_PITCH_MAX` (`80`): a quarter
// second of fall from `60` ends at `37.5`, clear of both, and a build that raised
// the pitch instead would read `82.5` clamped to `80` — nothing about this
// reading can be produced by a clamp. Where the pitch stops when the hold runs
// long is its own review point.
//
// THE TOLERANCE IS ONE FRAME OF THE HOLD, `ORBIT_KEY_RATE / TICK_HZ` (`1.5`)
// degrees. A build is free to read its input at the top of a frame or at the
// bottom of it, and the two differ by exactly the one frame the key was held
// across but not read on; nothing else in the arithmetic is approximate.
//
// The site is opened first, which leaves the build screen — one of the three the
// orbit applies on — showing, and the pose is set from there.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import {
  BINDINGS,
  CAMERA_START_DIST,
  CAMERA_START_YAW,
  ORBIT_KEY_RATE,
  TICK_HZ,
} from "../constants";
import { createHarness, openSite, ticks, type Harness } from "../harness";

/** The `down` action's binding, as `specs/controls.md` fixes it. */
const DOWN = BINDINGS.down[0]!;

/** The pitch the hold starts from: clear of both limits by more than the fall. */
const START_PITCH = 60;

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

it("lowers the camera pitch by ORBIT_KEY_RATE for each second down is held", async () => {
  await openSite(h, 0);
  await h.debug.setCamera(CAMERA_START_YAW, START_PITCH, CAMERA_START_DIST);
  await h.advance(1);

  const posed = await h.snapshot();
  assertEqual(
    posed.screen,
    "build",
    "the screen the orbit is driven on, one of the three showing the 3D yard",
  );
  assertEqual(
    posed.camera.pitch,
    START_PITCH,
    "the camera pitch the hold starts from (specs/instrumentation.md)",
  );

  await h.keyDown(DOWN);
  await h.advance(HOLD_FRAMES);
  await h.keyUp(DOWN);

  const turned = (await h.snapshot()).camera.pitch;
  await h.advance(1);
  await h.capture("state", "the yard after a quarter second of down");

  assertNear(
    turned,
    START_PITCH - TURNED,
    TOLERANCE,
    `the camera pitch after ${DOWN} was held for ${HOLD_FRAMES} frames, which ` +
      `is ${TURNED} degrees of fall at ORBIT_KEY_RATE (specs/controls.md)`,
  );
});

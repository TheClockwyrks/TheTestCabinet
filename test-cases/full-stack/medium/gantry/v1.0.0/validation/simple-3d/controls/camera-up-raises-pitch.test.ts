// controls/camera-up-raises-pitch — holding `up` raises the camera pitch at
// `ORBIT_KEY_RATE`.
//
// `specs/controls.md` § The camera: "`right` raises the yaw and `left` lowers it,
// `up` raises the pitch and `down` lowers it, each turning at `ORBIT_KEY_RATE`
// while its action is held", with `ORBIT_KEY_RATE` (`90`) deg/s and "All four run
// against the frame's delta time." So a hold of `HOLD_TICKS` frames, each
// covering `1 / TICK_HZ` seconds (`specs/instrumentation.md`), turns the pitch by
// `ORBIT_KEY_RATE * HOLD_TICKS / TICK_HZ` degrees.
//
// A QUARTER SECOND, AND WHY IT FITS. The pitch starts at `CAMERA_START_PITCH`
// (`30`) and is held inside `CAMERA_PITCH_MIN` (`10`) to `CAMERA_PITCH_MAX`
// (`80`), so the hold has to end short of `80`: a quarter of a second is `22.5`
// degrees, landing at `52.5`, clear of the limit by more than twice what the
// tolerance allows. A hold long enough to reach the limit would be measuring the
// clamp instead of the rate.
//
// THE TOLERANCE IS ONE FRAME OF THE HOLD. `ORBIT_KEY_RATE / TICK_HZ` (`1.5`
// degrees) is what one frame of the hold turns, and a build is free to read the
// key on the frame the press arrives or on the one after it, so the hold a build
// sees may be one frame shorter or longer than the frames driven. Nothing wider
// is allowed: a build turning at the wrong rate misses by far more.
//
// The key is held across driven frames rather than pressed, because the rate is
// about a HELD action: `h.keyDown` presses it, the frames run with it down, and
// `h.keyUp` releases it.

import { afterEach, beforeEach, it } from "vitest";
import { assertClose } from "../assert";
import {
  BINDINGS,
  CAMERA_START_PITCH,
  ORBIT_KEY_RATE,
  TICK_HZ,
} from "../constants";
import { createHarness, openSite, type Harness } from "../harness";

/** `up`'s binding, as `specs/controls.md` fixes it. */
const UP = BINDINGS.up[0]!;

/** The frames the key is held for: a quarter of a second of run clock. */
const HOLD_TICKS = TICK_HZ / 4;

/** What that hold turns the pitch by, at the rate the specification sets. */
const TURNED = (ORBIT_KEY_RATE * HOLD_TICKS) / TICK_HZ;

/** One frame of the hold, either way. */
const TOLERANCE = ORBIT_KEY_RATE / TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises the pitch by ORBIT_KEY_RATE times the time held", async () => {
  await openSite(h, 0);

  await h.keyDown(UP);
  await h.advance(HOLD_TICKS);
  await h.keyUp(UP);

  const { camera } = await h.snapshot();
  assertClose(
    camera.pitch,
    CAMERA_START_PITCH + TURNED,
    TOLERANCE,
    `the camera pitch after ${HOLD_TICKS} frames of \`up\`, which turns at ` +
      `ORBIT_KEY_RATE (${ORBIT_KEY_RATE}) deg/s against the frame's delta ` +
      "time (specs/controls.md)",
  );

  await h.advance(1);
  await h.capture("state", "the yard after a quarter second of `up`");
});

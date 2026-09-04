// controls/camera-yaw-wraps — the camera yaw runs free and wraps, staying at or
// above `0` and below `360`.
//
// `specs/controls.md` § The camera: "Pitch is held inside its limits and distance
// inside its; yaw runs free and wraps, staying at or above `0` and below `360`."
// The yaw is therefore the one camera figure with no bound to stop against: it
// keeps turning while `right` is held and comes back round rather than growing
// without limit or sticking at `360`.
//
// THE WRAP IS POSED UP TO, NOT DRIVEN UP TO. `setCamera` "sets the orbit camera's
// pose as the orbit controls set it" (`specs/instrumentation.md`), so the camera
// is placed twenty degrees short of the wrap and `right` is held from there. The
// crossing itself is still earned: `right` turns at `ORBIT_KEY_RATE` (`90`)
// deg/s, so the hold reaches `360` some thirteen frames in and carries on for
// twice that afterwards. Driving from `CAMERA_START_YAW` instead would spend
// three and a half seconds of held key reaching the same crossing, and every
// frame of that is a reading this point has already taken.
//
// THE YAW IS READ EVERY FRAME, not just at the end. The requirement is that the
// yaw is ALWAYS inside the half-open range, so a build that stepped outside it
// for a frame before folding it back has broken the rule the state reports on,
// and only a reading per frame sees that.
//
// AND THE WRAP IS READ AS A WRAP. A yaw that never comes round is inside the
// range too, so the frames are watched for the fall that only wrapping produces:
// `right` turns one way, so a yaw lower than the frame before it is the range
// folding over rather than the camera turning back.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertGreaterThanOrEqual,
  assertLessThan,
  assertTrue,
} from "../assert";
import {
  BINDINGS,
  CAMERA_START_DIST,
  CAMERA_START_PITCH,
  ORBIT_KEY_RATE,
  TICK_HZ,
} from "../constants";
import { createHarness, openSite, runTicks, type Harness } from "../harness";

/** `right`'s binding, as `specs/controls.md` fixes it. */
const RIGHT = BINDINGS.right[0]!;

/** Where the camera is posed: twenty degrees short of the wrap. */
const START_YAW = 340;

/** How far short of `360` that is. */
const TO_WRAP = 360 - START_YAW;

/**
 * The frames the key is held for: past the wrap, with travel either side of it.
 *
 * `TO_WRAP` degrees at `ORBIT_KEY_RATE` is some thirteen frames, so thirty-six
 * frames is the crossing with a third of them before it and the rest after.
 */
const HOLD_TICKS = 36;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps the yaw at or above 0 and below 360 through the wrap", async () => {
  await openSite(h, 0);
  await h.debug.setCamera(START_YAW, CAMERA_START_PITCH, CAMERA_START_DIST);

  let previous = START_YAW;
  let wrapped = false;

  await h.keyDown(RIGHT);
  try {
    for (let frame = 1; frame <= HOLD_TICKS; frame += 1) {
      // One frame at a time, reading the state those ticks left: `runTicks`
      // answers it, so a reading per frame costs one crossing rather than two.
      const { camera } = await runTicks(h, 1);
      assertGreaterThanOrEqual(
        camera.yaw,
        0,
        `the camera yaw ${frame} frames into a held \`right\`, which wraps ` +
          "rather than running past the range (specs/controls.md)",
      );
      assertLessThan(
        camera.yaw,
        360,
        `the camera yaw ${frame} frames into a held \`right\`, which wraps ` +
          "rather than running past the range (specs/controls.md)",
      );
      if (camera.yaw < previous) wrapped = true;
      previous = camera.yaw;
    }
  } finally {
    await h.keyUp(RIGHT);
  }

  assertTrue(
    wrapped,
    `the yaw to come round inside ${HOLD_TICKS} frames of held \`right\` from ` +
      `${START_YAW}, which is ${TO_WRAP} degrees short of the wrap at ` +
      `${ORBIT_KEY_RATE} deg/s (${(TO_WRAP / ORBIT_KEY_RATE) * TICK_HZ} ` +
      "frames): the yaw runs free and WRAPS (specs/controls.md)",
  );

  await h.advance(1);
  await h.capture("state", "the yard as the camera yaw comes round");
});

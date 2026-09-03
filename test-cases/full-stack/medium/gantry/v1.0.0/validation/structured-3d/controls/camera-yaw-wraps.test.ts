// controls/camera-yaw-wraps — the camera yaw runs free and wraps, staying at or
// above `0` and below `360`.
//
// `specs/controls.md` § The camera: "Pitch is held inside its limits and distance
// inside its; yaw runs free and wraps, staying at or above `0` and below `360`."
// The yaw is therefore the one camera figure with no bound to stop against: it
// keeps turning while `right` is held and comes back round rather than growing
// without limit or sticking at `360`.
//
// FIVE SECONDS IS MORE THAN ONE TURN. `right` turns at `ORBIT_KEY_RATE` (`90`)
// deg/s, so five seconds is `450` degrees: the hold passes through the wrap once,
// with a quarter turn of travel on either side of it. A build that never wraps
// reads over `360` for the last two seconds of the hold and a build that stops at
// the top of the range sticks; either is caught wherever the reading is taken
// after the crossing.
//
// THE YAW IS READ EVERY FRAME, not just at the end. The requirement is that the
// yaw is ALWAYS inside the half-open range, so a build that stepped outside it
// for a frame before folding it back has broken the rule the state reports on,
// and only a reading per frame sees that.
//
// The camera starts at `CAMERA_START_YAW` (`45`), so the wrap falls at `2.1`
// seconds into the hold — well inside the drive rather than at its edge.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, assertLessThan } from "../assert";
import { BINDINGS, TICK_HZ } from "../constants";
import { createHarness, openSite, runTicks, type Harness } from "../harness";

/** `right`'s binding, as `specs/controls.md` fixes it. */
const RIGHT = BINDINGS.right[0]!;

/** The frames the key is held for: five seconds, more than one whole turn. */
const HOLD_TICKS = TICK_HZ * 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps the yaw at or above 0 and below 360 through the wrap", async () => {
  await openSite(h, 0);

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
    }
  } finally {
    await h.keyUp(RIGHT);
  }

  await h.advance(1);
  await h.capture("state", "the yard after five seconds of `right`");
});

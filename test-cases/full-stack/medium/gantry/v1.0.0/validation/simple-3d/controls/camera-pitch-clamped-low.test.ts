// controls/camera-pitch-clamped-low — a held `down` stops the camera pitch at
// `CAMERA_PITCH_MIN`.
//
// `specs/controls.md` § The camera fixes the limits — "Pitch limits |
// `CAMERA_PITCH_MIN` (`10`) to `CAMERA_PITCH_MAX` (`80`) degrees" — and the rule
// that holds them: "Pitch is held inside its limits and distance inside its." The
// orbit turns at `ORBIT_KEY_RATE` (`90`) degrees a second, so the low limit is a
// quarter second of one key from the start pose, and what the check reads is
// where the pitch STOPS.
//
// THE HOLD IS TWO SECONDS, nine times what the limit needs from
// `CAMERA_START_PITCH` (`30`). A build that clamps has been sitting at the limit
// for nearly the whole hold by the time it is read; a build that does not has
// carried the pitch through the ground plane and out the other side, looking at
// the yard from beneath it. Each `advance` frame covers `1 / TICK_HZ` seconds and
// the camera "moves against that elapsed time" off the run screen
// (`specs/instrumentation.md`), so the frames are the seconds.
//
// THE READING IS THE LIMIT ITSELF, not an inequality. A clamp is a stated figure
// rather than a bound approached: the pitch is held AT `CAMERA_PITCH_MIN` once
// the hold has carried it there, so the tolerance is float noise and nothing
// more. Where a held `up` stops is its own review point.
//
// The site is opened first, because the camera "resets to the start pose when a
// site is opened" (`specs/controls.md`), so the hold starts from the stated
// figure, and that leaves the build screen — one of the three the orbit applies
// on — showing.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { BINDINGS, CAMERA_PITCH_MIN, CAMERA_START_PITCH } from "../constants";
import { createHarness, openSite, ticks, type Harness } from "../harness";

/** The `down` action's binding, as `specs/controls.md` fixes it. */
const DOWN = BINDINGS.down[0]!;

/** Two seconds: nine times the hold the limit needs from the start pose. */
const HOLD_FRAMES = ticks(2);

/** Float noise, and nothing more: a clamp lands on the figure itself. */
const TOLERANCE = 1e-6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("stops the camera pitch at CAMERA_PITCH_MIN under a held down", async () => {
  await openSite(h, 0);
  const posed = await h.snapshot();
  assertEqual(
    posed.screen,
    "build",
    "the screen the orbit is driven on, one of the three showing the 3D yard",
  );
  assertEqual(
    posed.camera.pitch,
    CAMERA_START_PITCH,
    "the camera pitch a site opening leaves (specs/controls.md)",
  );

  await h.keyDown(DOWN);
  await h.advance(HOLD_FRAMES);
  await h.keyUp(DOWN);

  const held = (await h.snapshot()).camera.pitch;
  await h.advance(1);
  await h.capture("state", "the yard from the bottom of the camera's pitch");

  assertNear(
    held,
    CAMERA_PITCH_MIN,
    TOLERANCE,
    `the camera pitch after ${DOWN} was held for ${HOLD_FRAMES} frames, nine ` +
      "times as long as reaching CAMERA_PITCH_MIN takes at ORBIT_KEY_RATE " +
      "(specs/controls.md)",
  );
});

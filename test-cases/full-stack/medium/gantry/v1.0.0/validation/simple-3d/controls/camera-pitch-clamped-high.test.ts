// controls/camera-pitch-clamped-high — a held `up` stops the camera pitch at
// `CAMERA_PITCH_MAX`.
//
// `specs/controls.md` § The camera fixes the limits — "Pitch limits |
// `CAMERA_PITCH_MIN` (`10`) to `CAMERA_PITCH_MAX` (`80`) degrees" — and the rule
// that holds them: "Pitch is held inside its limits and distance inside its." The
// orbit turns at `ORBIT_KEY_RATE` (`90`) degrees a second, so the high limit is
// somewhere a player reaches in a little over half a second of one key, and what
// the check reads is where the pitch STOPS.
//
// THE HOLD IS TWO SECONDS, more than three times what the limit needs from
// `CAMERA_START_PITCH` (`30`). A build that clamps has been sitting at the limit
// for most of the hold by the time it is read; a build that does not has carried
// the pitch past the vertical, where the camera's `+y` up is degenerate and the
// picture rolls over. Each `advance` frame covers `1 / TICK_HZ` seconds and the
// camera "moves against that elapsed time" off the run screen
// (`specs/instrumentation.md`), so the frames are the seconds.
//
// THE READING IS THE LIMIT ITSELF, not an inequality. A clamp is a stated figure
// rather than a bound approached: the pitch is held AT `CAMERA_PITCH_MAX` once
// the hold has carried it there, so the tolerance is float noise and nothing
// more. Where a held `down` stops is its own review point.
//
// The site is opened first, because the camera "resets to the start pose when a
// site is opened" (`specs/controls.md`), so the hold starts from the stated
// figure, and that leaves the build screen — one of the three the orbit applies
// on — showing.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { BINDINGS, CAMERA_PITCH_MAX, CAMERA_START_PITCH } from "../constants";
import { createHarness, openSite, ticks, type Harness } from "../harness";

/** The `up` action's binding, as `specs/controls.md` fixes it. */
const UP = BINDINGS.up[0]!;

/**
 * One second: getting from `CAMERA_START_PITCH` (`30`) to `CAMERA_PITCH_MAX`
 * (`80`) at `ORBIT_KEY_RATE` (`90` deg/s) takes five ninths of a second, so the
 * hold runs well past the limit and the reading is of a camera held against it
 * rather than of one still on its way (`specs/controls.md`).
 */
const HOLD_FRAMES = ticks(1);

/** Float noise, and nothing more: a clamp lands on the figure itself. */
const TOLERANCE = 1e-6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("stops the camera pitch at CAMERA_PITCH_MAX under a held up", async () => {
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

  await h.keyDown(UP);
  await h.advance(HOLD_FRAMES);
  await h.keyUp(UP);

  const held = (await h.snapshot()).camera.pitch;
  await h.advance(1);
  await h.capture("state", "the yard from the top of the camera's pitch");

  assertNear(
    held,
    CAMERA_PITCH_MAX,
    TOLERANCE,
    `the camera pitch after ${UP} was held for ${HOLD_FRAMES} frames, close ` +
      "to twice as long as reaching CAMERA_PITCH_MAX takes at " +
      "ORBIT_KEY_RATE (specs/controls.md)",
  );
});

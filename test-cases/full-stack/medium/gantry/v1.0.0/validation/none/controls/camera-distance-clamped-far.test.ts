// controls/camera-distance-clamped-far — a held `zoom-out` stops the camera
// distance at `CAMERA_DIST_MAX`.
//
// `specs/controls.md` § The camera fixes the limits — "Distance limits |
// `CAMERA_DIST_MIN` (`10`) to `CAMERA_DIST_MAX` (`80`)" — and the rule that holds
// them: "Pitch is held inside its limits and distance inside its." The zoom moves
// at `ZOOM_RATE` (`20`) units a second, so the far limit is somewhere a player
// reaches in a couple of seconds of one key, and what the check reads is where
// the distance STOPS.
//
// THE CAMERA IS POSED SHORT OF THE LIMIT AND THEN DRIVEN PAST IT. `setCamera`
// "sets the orbit camera's pose as the orbit controls set it: the pitch and the
// distance are held inside their limits" (`specs/instrumentation.md`), so a
// distance of `POSED_DIST` is a pose the controls themselves could have left, and
// what it establishes is a precondition: a camera `5` units short of the far
// limit. The clamp itself is still earned — the key is held for a whole second,
// four times the quarter-second that carries the camera to the limit at
// `ZOOM_RATE`, so a build that clamps has been sitting at the limit for
// three-quarters of a second by the time it is read and a build that does not has
// run `15` units past it. Each `advance` frame covers `1 / TICK_HZ` seconds and
// the camera "moves against that elapsed time" off the run screen
// (`specs/instrumentation.md`), so the frames are the seconds.
//
// THE READING IS THE LIMIT ITSELF, not an inequality. A clamp is a stated figure
// rather than a bound approached: the distance is held AT `CAMERA_DIST_MAX` once
// the hold has carried it there, so the tolerance is float noise and nothing
// more. Where a held `zoom-in` stops is its own review point.
//
// The site is opened first, because the camera "resets to the start pose when a
// site is opened" (`specs/controls.md`), so the pose is made from the stated
// figure, and that leaves the build screen — one of the three the zoom applies on
// — showing.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import {
  BINDINGS,
  CAMERA_DIST_MAX,
  CAMERA_START_DIST,
  ZOOM_RATE,
} from "../constants";
import { createHarness, openSite, ticks, type Harness } from "../harness";

/** The `zoom-out` action's binding, as `specs/controls.md` fixes it. */
const ZOOM_OUT = BINDINGS["zoom-out"][0]!;

/** Where the camera is posed before the hold: short of the far limit. */
const POSED_DIST = CAMERA_DIST_MAX - 5;

/** Four times the hold that limit needs from there at `ZOOM_RATE`. */
const HOLD_FRAMES = ticks((4 * (CAMERA_DIST_MAX - POSED_DIST)) / ZOOM_RATE);

/** Float noise, and nothing more: a clamp lands on the figure itself. */
const TOLERANCE = 1e-6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("stops the camera distance at CAMERA_DIST_MAX under a held zoom-out", async () => {
  await openSite(h, 0);
  const posed = await h.snapshot();
  assertEqual(
    posed.screen,
    "build",
    "the screen the zoom is driven on, one of the three showing the 3D yard",
  );
  assertEqual(
    posed.camera.dist,
    CAMERA_START_DIST,
    "the camera distance a site opening leaves (specs/controls.md)",
  );

  await h.debug.setCamera(posed.camera.yaw, posed.camera.pitch, POSED_DIST);
  const short = await h.snapshot();
  assertEqual(
    short.camera.dist,
    POSED_DIST,
    "the camera distance posed short of the limit, which the orbit controls " +
      "hold inside theirs (specs/instrumentation.md)",
  );

  await h.keyDown(ZOOM_OUT);
  await h.advance(HOLD_FRAMES);
  await h.keyUp(ZOOM_OUT);

  const held = (await h.snapshot()).camera.dist;
  await h.advance(1);
  await h.capture("state", "the yard at the far end of the camera's distance");

  assertNear(
    held,
    CAMERA_DIST_MAX,
    TOLERANCE,
    `the camera distance after ${ZOOM_OUT} was held for ${HOLD_FRAMES} ` +
      "frames, twice as long as reaching CAMERA_DIST_MAX takes at ZOOM_RATE " +
      "(specs/controls.md)",
  );
});

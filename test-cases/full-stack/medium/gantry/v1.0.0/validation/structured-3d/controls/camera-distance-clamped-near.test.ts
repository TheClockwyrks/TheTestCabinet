// controls/camera-distance-clamped-near — a held `zoom-in` stops the camera
// distance at `CAMERA_DIST_MIN`.
//
// `specs/controls.md` § The camera fixes the limits — "Distance limits |
// `CAMERA_DIST_MIN` (`10`) to `CAMERA_DIST_MAX` (`80`)" — and the rule that holds
// them: "Pitch is held inside its limits and distance inside its." The zoom moves
// at `ZOOM_RATE` (`20`) units a second, and what the check reads is where the
// distance STOPS.
//
// THE CAMERA IS POSED TO THE EDGE OF THE LIMIT AND THE CLAMP IS THEN EARNED.
// `setCamera` "sets the orbit camera's pose as the orbit controls set it"
// (`specs/instrumentation.md`), so a distance already inside the limits is a
// precondition it establishes and nothing more — the clamp itself is not posed,
// it is what the held key drives the camera into. Driving all the way down from
// `CAMERA_START_DIST` would spend three seconds of frames reaching a limit that
// is decided in the last one of them, and every frame before the last decides
// nothing this point is about.
//
// THE HOLD IS TWICE AS LONG AS IT NEEDS TO BE. From `APPROACH` (`5`) units above
// the limit the zoom covers that ground in a quarter of a second at `ZOOM_RATE`;
// the key is held for half a second, so a build that clamps has been sitting at
// the limit for half the hold by the time it is read and a build that does not
// has driven the distance `APPROACH` units BEHIND the limit — a camera looking at
// the yard from the wrong side of it. Each `advance` frame covers `1 / TICK_HZ`
// seconds and the camera "moves against that elapsed time" off the run screen
// (`specs/instrumentation.md`), so the frames are the seconds.
//
// THE READING IS THE LIMIT ITSELF, not an inequality. A clamp is a stated figure
// rather than a bound approached: the distance is held AT `CAMERA_DIST_MIN` once
// the hold has carried it there, so the tolerance is float noise and nothing
// more. Where a held `zoom-out` stops is its own review point.
//
// The site is opened first, because the camera "resets to the start pose when a
// site is opened" (`specs/controls.md`), so the pose the hold starts from is set
// against a known one, and that leaves the build screen — one of the three the
// zoom applies on — showing.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import {
  BINDINGS,
  CAMERA_DIST_MIN,
  CAMERA_START_DIST,
  ZOOM_RATE,
} from "../constants";
import { createHarness, openSite, ticks, type Harness } from "../harness";

/** The `zoom-in` action's binding, as `specs/controls.md` fixes it. */
const ZOOM_IN = BINDINGS["zoom-in"][0]!;

/** How far above the limit the camera is posed before the key goes down. */
const APPROACH = 5;

/** Twice the hold reaching the limit from there takes, at `ZOOM_RATE`. */
const HOLD_FRAMES = ticks((2 * APPROACH) / ZOOM_RATE);

/** Float noise, and nothing more: a clamp lands on the figure itself. */
const TOLERANCE = 1e-6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("stops the camera distance at CAMERA_DIST_MIN under a held zoom-in", async () => {
  await openSite(h, 0);
  const opened = await h.snapshot();
  assertEqual(
    opened.screen,
    "build",
    "the screen the zoom is driven on, one of the three showing the 3D yard",
  );
  assertEqual(
    opened.camera.dist,
    CAMERA_START_DIST,
    "the camera distance a site opening leaves (specs/controls.md)",
  );

  // The precondition: the same orbit the site opening left, moved to `APPROACH`
  // units above the limit — a distance inside the limits, so `setCamera` sets it
  // as it was asked to and holds nothing.
  await h.debug.setCamera(
    opened.camera.yaw,
    opened.camera.pitch,
    CAMERA_DIST_MIN + APPROACH,
  );
  const posed = await h.snapshot();
  assertNear(
    posed.camera.dist,
    CAMERA_DIST_MIN + APPROACH,
    TOLERANCE,
    `the camera distance the hold starts from, ${APPROACH} units above ` +
      "CAMERA_DIST_MIN and so inside the limits setCamera holds a pose to " +
      "(specs/instrumentation.md)",
  );

  await h.keyDown(ZOOM_IN);
  await h.advance(HOLD_FRAMES);
  await h.keyUp(ZOOM_IN);

  const held = (await h.snapshot()).camera.dist;
  await h.advance(1);
  await h.capture("state", "the yard at the near end of the camera's distance");

  assertNear(
    held,
    CAMERA_DIST_MIN,
    TOLERANCE,
    `the camera distance after ${ZOOM_IN} was held for ${HOLD_FRAMES} ` +
      `frames from ${APPROACH} units above CAMERA_DIST_MIN, twice as long as ` +
      "covering that ground takes at ZOOM_RATE (specs/controls.md)",
  );
});

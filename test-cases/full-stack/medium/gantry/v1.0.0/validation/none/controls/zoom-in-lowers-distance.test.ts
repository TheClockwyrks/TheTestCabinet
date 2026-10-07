// controls/zoom-in-lowers-distance — holding `zoom-in` lowers the camera
// distance at `ZOOM_RATE`.
//
// `specs/controls.md` § The camera: "`zoom-in` lowers the distance and `zoom-out`
// raises it at `ZOOM_RATE`", with `ZOOM_RATE` (`20`) units/s, and "All four run
// against the frame's delta time." § The actions binds `zoom-in` to `Equal`. So a
// hold of `HOLD_TICKS` frames, each covering `1 / TICK_HZ` seconds
// (`specs/instrumentation.md`), lowers the distance by
// `ZOOM_RATE * HOLD_TICKS / TICK_HZ`.
//
// ONE SECOND, AND WHY IT FITS. The distance starts at `CAMERA_START_DIST` (`40`)
// and is held inside `CAMERA_DIST_MIN` (`10`) to `CAMERA_DIST_MAX` (`80`), so a
// second of `zoom-in` lands at `20`, ten clear of the near limit. A longer hold
// would be measuring the clamp instead of the rate.
//
// THE TOLERANCE IS ONE FRAME OF THE HOLD. `ZOOM_RATE / TICK_HZ` (`0.333` units)
// is what one frame of the hold covers, and a build is free to read the key on
// the frame the press arrives or on the one after it.

import { afterEach, beforeEach, it } from "vitest";
import { assertClose } from "../assert";
import { BINDINGS, CAMERA_START_DIST, TICK_HZ, ZOOM_RATE } from "../constants";
import { createHarness, openSite, type Harness } from "../harness";

/** `zoom-in`'s binding, as `specs/controls.md` fixes it. */
const ZOOM_IN = BINDINGS["zoom-in"][0]!;

/** The frames the key is held for: one second of run clock. */
const HOLD_TICKS = TICK_HZ;

/** What that hold covers, at the rate the specification sets. */
const COVERED = (ZOOM_RATE * HOLD_TICKS) / TICK_HZ;

/** One frame of the hold, either way. */
const TOLERANCE = ZOOM_RATE / TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lowers the distance by ZOOM_RATE times the time held", async () => {
  await openSite(h, 0);

  await h.keyDown(ZOOM_IN);
  await h.advance(HOLD_TICKS);
  await h.keyUp(ZOOM_IN);

  const { camera } = await h.snapshot();
  await h.advance(1);
  await h.capture("state", "the yard after a second of `zoom-in`");

  assertClose(
    camera.dist,
    CAMERA_START_DIST - COVERED,
    TOLERANCE,
    `the camera distance after ${HOLD_TICKS} frames of \`zoom-in\`, which ` +
      `lowers it at ZOOM_RATE (${ZOOM_RATE}) units/s against the frame's ` +
      "delta time (specs/controls.md)",
  );
});

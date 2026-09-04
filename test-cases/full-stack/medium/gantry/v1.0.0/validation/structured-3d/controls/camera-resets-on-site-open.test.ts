// controls/camera-resets-on-site-open — opening a site puts the camera back at
// the start pose.
//
// `specs/controls.md` § The camera: "The camera pose persists across the three
// screens and resets to the start pose when a site is opened", and the table
// above it fixes the pose itself — "Start pose | yaw `CAMERA_START_YAW` (`45`),
// pitch `CAMERA_START_PITCH` (`30`), distance `CAMERA_START_DIST` (`40`)".
// `specs/instrumentation.md` says `openSite` "carries the effects
// `specs/state.md` states for opening a site", so the surface's way onto a site
// is the player's, and this is what a player sees when they enter one.
//
// THE POSE THE OPENING HAS TO OVERWRITE IS NONE OF THE START FIGURES: yaw `120`,
// pitch `50`, distance `25`, each well clear of its limits, so the reading after
// the opening cannot be the pose that was already there and cannot be a clamp.
// It is read back before the site is opened, because a check that never
// established the pose it expects to see overwritten would pass on a build that
// ignored `setCamera` too.
//
// A DIFFERENT SITE IS OPENED, so what the check reads is a site OPENING rather
// than a screen change: `openSite` reaches "any site whether or not it has been
// unlocked", which is what lets this run without playing site 0 to reach site 1.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  CAMERA_START_DIST,
  CAMERA_START_PITCH,
  CAMERA_START_YAW,
} from "../constants";
import { createHarness, openSite, type Harness } from "../harness";

/** A pose no start figure and no limit can produce. */
const YAW = 120;
const PITCH = 50;
const DIST = 25;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns the camera to the start pose when a site is opened", async () => {
  await openSite(h, 0);
  await h.debug.setCamera(YAW, PITCH, DIST);
  await h.advance(1);

  const posed = await h.snapshot();
  assertEqual(posed.camera.yaw, YAW, "the camera yaw before the site opening");
  assertEqual(
    posed.camera.pitch,
    PITCH,
    "the camera pitch before the site opening",
  );
  assertEqual(
    posed.camera.dist,
    DIST,
    "the camera distance before the site opening",
  );

  await openSite(h, 1);
  await h.advance(1);

  const opened = await h.snapshot();
  await h.capture(
    "state",
    "the yard at the start pose a site opening restores",
  );

  assertEqual(
    opened.camera.yaw,
    CAMERA_START_YAW,
    "the camera yaw a site opening resets to (specs/controls.md)",
  );
  assertEqual(
    opened.camera.pitch,
    CAMERA_START_PITCH,
    "the camera pitch a site opening resets to (specs/controls.md)",
  );
  assertEqual(
    opened.camera.dist,
    CAMERA_START_DIST,
    "the camera distance a site opening resets to (specs/controls.md)",
  );
});

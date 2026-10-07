// controls/camera-start-pose — the orbit camera stands at its start pose.
//
// `specs/controls.md` § The camera gives the figure in as many words: "Start pose
// — yaw `CAMERA_START_YAW` (`45`), pitch `CAMERA_START_PITCH` (`30`), distance
// `CAMERA_START_DIST` (`40`)". The three numbers are the whole of the
// requirement, and they are read from the state the same section describes the
// camera by, so a build is free to hold the pose however it likes as long as it
// reports the pose the specification set.
//
// THE SITE IS OPENED FIRST because the start pose is what the player is given
// when a yard first comes on screen: "The camera pose persists across the three
// screens and resets to the start pose when a site is opened." Nothing else is
// posed — no structure, no yard change, no key and no pointer act — so the three
// readings are the pose a build stands the camera up in and nothing that moved
// it afterwards. That a site opening RESETS a moved camera is its own review
// point; this one decides the figure the pose holds.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  CAMERA_START_DIST,
  CAMERA_START_PITCH,
  CAMERA_START_YAW,
} from "../constants";
import { createHarness, openSite, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("stands at yaw 45, pitch 30 and distance 40", async () => {
  await openSite(h, 0);

  const { camera } = await h.snapshot();
  await h.advance(1);
  await h.capture("state", "the yard through the camera's start pose");

  assertEqual(
    camera.yaw,
    CAMERA_START_YAW,
    "the camera's start yaw (specs/controls.md)",
  );
  assertEqual(
    camera.pitch,
    CAMERA_START_PITCH,
    "the camera's start pitch (specs/controls.md)",
  );
  assertEqual(
    camera.dist,
    CAMERA_START_DIST,
    "the camera's start distance (specs/controls.md)",
  );
});

// controls/camera-holds-plus-y-up — the world vertical carries no roll on the
// stage.
//
// `specs/controls.md` § The camera: the camera "stands at `CAMERA_TARGET` plus
// `dist * (cos(pitch) * cos(yaw), sin(pitch), cos(pitch) * sin(yaw))` and looks
// back at the target with `+y` up". `+y` up is what fixes the roll of the
// picture, and `specs/world.md` fixes which way that is: "`x` and `z` are
// horizontal, `y` is up".
//
// SO THE READING IS A VERTICAL WORLD SEGMENT, PROJECTED. With `+y` up and the
// camera looking at the target, the world vertical through the target lies in the
// plane the camera's own up axis and view axis span, so it is drawn as a segment
// straight up the stage: `(0, 6, 0)` and `(0, 7, 0)` share a stage x. A camera
// rolled by any angle at all separates them, by the height of the segment times
// the tangent of the roll.
//
// WHICH WAY THE STAGE'S y RUNS IS NOT ASSERTED. The specification fixes the
// units a projected point is in — "logical stage units" — and never says whether
// stage y grows upward or downward, so a build is free to choose; what the check
// requires is that the two points differ in y at all, which is the segment being
// drawn as a segment rather than as a point.
//
// TWO POSES, at different yaws and pitches, because a roll a build carries is
// free to depend on either: one at the start pose, one from behind at a high
// pitch, where a camera built from a naive up vector is closest to degenerate.
//
// THE TOLERANCES. One logical pixel across, because a build is free to report a
// projected point at whole logical pixels and two readings each rounded can stand
// a pixel apart; two logical pixels along, as the floor below which the segment
// is not drawn at all — a build's field of view is its own (`specs/controls.md`
// fixes the camera's pose and not its lens), so how MANY pixels a world unit is
// worth is not something this or any check can require.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, assertNear, assertTrue } from "../assert";
import {
  CAMERA_START_DIST,
  CAMERA_START_PITCH,
  CAMERA_START_YAW,
  CAMERA_TARGET,
} from "../constants";
import { createHarness, openSite, type Harness } from "../harness";

/** One camera pose: yaw, pitch, distance, all inside the stated limits. */
interface Pose {
  readonly yaw: number;
  readonly pitch: number;
  readonly dist: number;
}

/** The start pose, and one from behind at a high pitch. */
const POSES: readonly Pose[] = [
  { yaw: CAMERA_START_YAW, pitch: CAMERA_START_PITCH, dist: CAMERA_START_DIST },
  { yaw: 210, pitch: 70, dist: 20 },
];

/** A build may report a projected point at whole logical pixels. */
const ACROSS_TOLERANCE = 1;

/** The floor below which a world unit of height is not drawn at all. */
const ALONG_FLOOR = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the world vertical straight up the stage at every camera pose", async () => {
  await openSite(h, 0);

  for (const pose of POSES) {
    await h.debug.setCamera(pose.yaw, pose.pitch, pose.dist);
    await h.advance(1);

    const at = `yaw ${pose.yaw}, pitch ${pose.pitch}, distance ${pose.dist}`;
    const foot = await h.project(
      CAMERA_TARGET.x,
      CAMERA_TARGET.y,
      CAMERA_TARGET.z,
    );
    const head = await h.project(
      CAMERA_TARGET.x,
      CAMERA_TARGET.y + 1,
      CAMERA_TARGET.z,
    );
    assertTrue(
      foot.visible,
      `the foot of the vertical segment is on the stage at ${at}`,
    );
    assertTrue(
      head.visible,
      `the head of the vertical segment is on the stage at ${at}`,
    );

    assertGreaterThanOrEqual(
      Math.abs(head.y - foot.y),
      ALONG_FLOOR,
      `the stage y between (0, 6, 0) and (0, 7, 0) at ${at}: a world unit of ` +
        "height has to be drawn as a length for the reading to mean anything",
    );
    assertNear(
      head.x,
      foot.x,
      ACROSS_TOLERANCE,
      `the stage x of (0, 7, 0) against (0, 6, 0)'s at ${at}: the camera ` +
        "looks at the target with +y up, so the world vertical carries no " +
        "roll (specs/controls.md)",
    );
  }

  await h.capture("state", "the yard from the second of the two camera poses");
});

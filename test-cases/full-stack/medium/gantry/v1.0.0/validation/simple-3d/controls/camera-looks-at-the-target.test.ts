// controls/camera-looks-at-the-target — `CAMERA_TARGET` holds one point on the
// stage whatever the camera pose.
//
// `specs/controls.md` § The camera: the orbit camera "looks at `CAMERA_TARGET`
// (`(0, 6, 0)`) from a yaw, a pitch, and a distance", and the camera "looks back
// at the target". A camera that looks AT a point draws that point on its own view
// axis, so the target lands on the same place on the stage from every pose — that
// invariance is what "looks at" means, read through the one reading
// `specs/instrumentation.md` gives for it: "`project(x, y, z)` — The point on the
// stage the world position `(x, y, z)` is drawn at, through the camera as it
// stands."
//
// WHAT IS ASSERTED IS THE INVARIANCE, NOT A PARTICULAR POINT. The specification
// fixes the camera's pose and not its lens: the field of view, and therefore
// everything about the scale of the picture, is the build's. So the check reads
// the target's projection at four poses and requires the four to agree; it never
// says where on the stage they have to agree, because no sentence of the
// specification says.
//
// THE FOUR POSES ARE SPREAD OVER THE WHOLE OF WHAT A PLAYER CAN REACH: the start
// pose, a high pitch from behind at close range, `CAMERA_PITCH_MIN` from yaw `0`
// at `CAMERA_DIST_MAX`, and a middling pose from the fourth quadrant. A build
// whose camera looks somewhere other than the target — the origin, say, or a
// point that trails the yaw — moves the target across the stage as the pose
// changes, and the wider the spread the further it moves.
//
// THE TOLERANCE IS ONE LOGICAL PIXEL, because a build is free to report a
// projected point at whole logical pixels: `specs/instrumentation.md` fixes the
// units the reading is in and not its precision, so two readings each rounded can
// stand a pixel apart. Nothing else in the arithmetic is approximate.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear, assertTrue } from "../assert";
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

/** Four poses spread over the whole of what the orbit controls can reach. */
const POSES: readonly Pose[] = [
  { yaw: CAMERA_START_YAW, pitch: CAMERA_START_PITCH, dist: CAMERA_START_DIST },
  { yaw: 210, pitch: 70, dist: 12 },
  { yaw: 0, pitch: 10, dist: 80 },
  { yaw: 315, pitch: 45, dist: 25 },
];

/** A build may report a projected point at whole logical pixels. */
const TOLERANCE = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws CAMERA_TARGET at the same stage point from every camera pose", async () => {
  await openSite(h, 0);

  const seen: { pose: Pose; x: number; y: number }[] = [];
  for (const pose of POSES) {
    await h.debug.setCamera(pose.yaw, pose.pitch, pose.dist);
    await h.advance(1);
    const at = await h.project(
      CAMERA_TARGET.x,
      CAMERA_TARGET.y,
      CAMERA_TARGET.z,
    );
    assertTrue(
      at.visible,
      `the target the camera looks at is on the stage at yaw ${pose.yaw}, ` +
        `pitch ${pose.pitch}, distance ${pose.dist} (specs/controls.md)`,
    );
    seen.push({ pose, x: at.x, y: at.y });
  }

  await h.capture("state", "the yard from the last of the four camera poses");

  const first = seen[0]!;
  for (const at of seen.slice(1)) {
    const where =
      `at yaw ${at.pose.yaw}, pitch ${at.pose.pitch}, distance ` +
      `${at.pose.dist}, against the start pose's`;
    assertNear(
      at.x,
      first.x,
      TOLERANCE,
      `the stage x CAMERA_TARGET is drawn at ${where} (specs/controls.md)`,
    );
    assertNear(
      at.y,
      first.y,
      TOLERANCE,
      `the stage y CAMERA_TARGET is drawn at ${where} (specs/controls.md)`,
    );
  }
});

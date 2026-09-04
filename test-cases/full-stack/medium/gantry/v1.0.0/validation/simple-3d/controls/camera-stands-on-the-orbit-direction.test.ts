// controls/camera-stands-on-the-orbit-direction — the orbit formula's line
// through the target is the camera's view axis.
//
// `specs/controls.md` § The camera: "The camera stands at `CAMERA_TARGET` plus
// `dist * (cos(pitch) * cos(yaw), sin(pitch), cos(pitch) * sin(yaw))` and looks
// back at the target with `+y` up, both angles in degrees. At yaw `0` it stands
// toward `+x` of the target, a positive yaw carries it from `+x` toward `+z` as
// every yaw in the game does (`specs/world.md`), and a positive pitch raises it
// above the target's level."
//
// SO THE LINE FROM THE TARGET ALONG THAT DIRECTION IS THE VIEW AXIS, and every
// point on it is drawn where the target is drawn. That is what the check reads,
// through `project`, at two probes on the line either side of the target — one
// between the camera and the target, one beyond it. A build whose yaw runs the
// other way round, or whose pitch is measured from the vertical, or that swapped
// an axis, stands somewhere else: the probes then sit off ITS view axis and are
// drawn away from the target.
//
// THE SIGN OF THE DIRECTION IS NOT WHAT THIS DECIDES — a camera at
// `target - dist * u` sees the same line — and it does not have to be: which side
// of the target the camera stands on, and how far along, is its own review point.
// What this one decides is the LINE.
//
// AND TWO PROBES OFF THE LINE KEEP THE READING HONEST, one unit to either side of
// it along two perpendicular directions. Without them a build whose projection
// collapsed the yard to a single point would pass. The floor they have to clear
// is stated against the build's OWN scale rather than in pixels: the stage
// distance a one-unit offset at the target is drawn at, which the check measures
// on the spot, because `specs/controls.md` fixes the camera's pose and not its
// lens and so a build's field of view — and every pixel figure that follows from
// it — is the build's own. Half that scale is a floor the true figure clears by
// more than a factor of two at both poses.
//
// THE TOLERANCE IS ONE LOGICAL PIXEL, because a build is free to report a
// projected point at whole logical pixels: `specs/instrumentation.md` fixes the
// units the reading is in and not its precision.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertNear, assertTrue } from "../assert";
import {
  CAMERA_START_DIST,
  CAMERA_START_PITCH,
  CAMERA_START_YAW,
  CAMERA_TARGET,
} from "../constants";
import { createHarness, openSite, type Harness, type Vec3 } from "../harness";

/** One camera pose: yaw, pitch, distance, all inside the stated limits. */
interface Pose {
  readonly yaw: number;
  readonly pitch: number;
  readonly dist: number;
}

/** The start pose, and one from behind at a high pitch and close in. */
const POSES: readonly Pose[] = [
  { yaw: CAMERA_START_YAW, pitch: CAMERA_START_PITCH, dist: CAMERA_START_DIST },
  { yaw: 210, pitch: 70, dist: 20 },
];

/** How far along the line the two on-axis probes stand, in world units. */
const REACH = 4;

/** A build may report a projected point at whole logical pixels. */
const TOLERANCE = 1;

/**
 * The share of a one-unit offset's own stage length an off-axis probe has to
 * clear: the true figure is `dist / (dist - REACH)` times it, over `1.2` at both
 * poses.
 */
const OFF_AXIS_FLOOR = 0.5;

const DEG = Math.PI / 180;

/** The direction `specs/controls.md` puts the camera along, as a unit vector. */
function orbitDirection(pose: Pose): Vec3 {
  const cosPitch = Math.cos(pose.pitch * DEG);
  return {
    x: cosPitch * Math.cos(pose.yaw * DEG),
    y: Math.sin(pose.pitch * DEG),
    z: cosPitch * Math.sin(pose.yaw * DEG),
  };
}

/** A unit vector at right angles to the orbit direction, and horizontal. */
function acrossDirection(pose: Pose): Vec3 {
  return { x: -Math.sin(pose.yaw * DEG), y: 0, z: Math.cos(pose.yaw * DEG) };
}

const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

const step = (from: Vec3, along: Vec3, by: number): Vec3 => ({
  x: from.x + along.x * by,
  y: from.y + along.y * by,
  z: from.z + along.z * by,
});

const add = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.x + b.x,
  y: a.y + b.y,
  z: a.z + b.z,
});

const TARGET: Vec3 = {
  x: CAMERA_TARGET.x,
  y: CAMERA_TARGET.y,
  z: CAMERA_TARGET.z,
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws every point on the orbit direction where it draws the target", async () => {
  await openSite(h, 0);

  try {
    for (const pose of POSES) {
      await h.debug.setCamera(pose.yaw, pose.pitch, pose.dist);
      await h.advance(1);

      const at = `yaw ${pose.yaw}, pitch ${pose.pitch}, distance ${pose.dist}`;
      const along = orbitDirection(pose);
      const across = acrossDirection(pose);
      const other = cross(along, across);

      const centre = await h.project(TARGET.x, TARGET.y, TARGET.z);
      assertTrue(centre.visible, `the target is on the stage at ${at}`);

      // The build's own scale: what one world unit at the target's own depth is
      // worth on its stage, measured rather than assumed.
      const offset = add(TARGET, across);
      const beside = await h.project(offset.x, offset.y, offset.z);
      const unit = Math.hypot(beside.x - centre.x, beside.y - centre.y);
      assertGreaterThan(
        unit,
        0,
        `the stage length a one-unit world offset at the target is drawn at, ` +
          `at ${at}: the reading has to have a scale to be read against`,
      );

      for (const reach of [REACH, -REACH]) {
        const on = step(TARGET, along, reach);
        const drawn = await h.project(on.x, on.y, on.z);
        const which = `${reach > 0 ? "toward the camera" : "beyond the target"}`;
        assertTrue(
          drawn.visible,
          `the on-axis probe ${Math.abs(reach)} units ${which} is on the stage ` +
            `at ${at}`,
        );
        assertNear(
          drawn.x,
          centre.x,
          TOLERANCE,
          `the stage x of the point ${Math.abs(reach)} units ${which} along the ` +
            `orbit direction at ${at}, against the target's: that line is the ` +
            "view axis (specs/controls.md)",
        );
        assertNear(
          drawn.y,
          centre.y,
          TOLERANCE,
          `the stage y of the point ${Math.abs(reach)} units ${which} along the ` +
            `orbit direction at ${at}, against the target's: that line is the ` +
            "view axis (specs/controls.md)",
        );
      }

      for (const [name, aside] of [
        ["across", across],
        ["above", other],
      ] as const) {
        const off = add(step(TARGET, along, REACH), aside);
        const drawn = await h.project(off.x, off.y, off.z);
        assertTrue(
          drawn.visible,
          `the off-axis probe one unit ${name} the line is on the stage at ${at}`,
        );
        assertGreaterThan(
          Math.hypot(drawn.x - centre.x, drawn.y - centre.y) / unit,
          OFF_AXIS_FLOOR,
          `the stage distance from the target of a probe one unit ${name} the ` +
            `orbit direction at ${at}, in units of what a one-unit offset is ` +
            "drawn at: a point off the view axis is drawn off the target",
        );
      }
    }
  } finally {
    // In a `finally`, so a check that fails inside the sweep still leaves
    // the picture that shows why.
    await h.capture("state", "the yard from the second of the two camera poses");
  }
});

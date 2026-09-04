// controls/camera-stands-at-the-orbit-distance-on-the-near-side — the camera
// stands `dist` from the target, on the `+u` side of it.
//
// `specs/controls.md` § The camera: "The camera stands at `CAMERA_TARGET` plus
// `dist * (cos(pitch) * cos(yaw), sin(pitch), cos(pitch) * sin(yaw))` and looks
// back at the target with `+y` up". That the LINE through the target along `u` is
// the view axis is its own review point; this one decides the two things the line
// leaves open — WHICH SIDE of the target the camera stands on, and HOW FAR along.
//
// PERSPECTIVE IS WHAT READS THEM, and it reads them without knowing the lens. A
// world offset at right angles to the view axis is drawn at a stage length
// inversely proportional to its distance from the camera, whatever the field of
// view; so the same offset carried at two probes, one `r` along `+u` from the
// target and one `r` along `-u`, is drawn in the ratio `(dist + r) / (dist - r)`
// — and that ratio names `dist` and the side together. A camera on the far side
// gives the reciprocal, `30 / 50` instead of `50 / 30`. A camera standing at
// twice the distance gives `90 / 70`. Neither is near the figure this check
// requires.
//
// THE RATIO CANNOT BE PRODUCED BY A LENS, and neither probe's own stage length
// means anything on its own: `specs/controls.md` fixes the camera's pose and not
// its lens, so every absolute pixel figure is the build's own and only the ratio
// between two of them is the specification's. That is why the reading is a ratio
// rather than a length.
//
// TWO DISTANCES, `40` and `20`, so the check is against the distance rather than
// against one figure a build could carry by accident: the same probes read
// `50 / 30` at the first and `30 / 10` at the second, and no single wrong
// distance produces both.
//
// THE PROBES ARE `2` UNITS ACROSS THE VIEW AXIS, far enough that the shorter of
// the four stage lengths is tens of pixels: a build free to report a projected
// point at whole logical pixels then carries under a couple of percent of
// rounding into the ratio, which the tolerance of five percent covers with room
// to spare. Nothing else in the arithmetic is approximate.

import { afterEach, beforeEach, it } from "vitest";
import { assertNearFraction, assertTrue } from "../assert";
import {
  CAMERA_START_DIST,
  CAMERA_START_PITCH,
  CAMERA_START_YAW,
  CAMERA_TARGET,
} from "../constants";
import { createHarness, openSite, type Harness, type Vec3 } from "../harness";

/** The start pose's yaw and pitch, read at two distances. */
const DISTANCES = [CAMERA_START_DIST, 20] as const;

/** How far along the orbit direction the two probes stand, in world units. */
const REACH = 10;

/** The offset carried at each probe, across the view axis, in world units. */
const ACROSS = 2;

/** Rounding a build reporting whole logical pixels can carry into the ratio. */
const TOLERANCE = 0.05;

const DEG = Math.PI / 180;

const TARGET: Vec3 = {
  x: CAMERA_TARGET.x,
  y: CAMERA_TARGET.y,
  z: CAMERA_TARGET.z,
};

/** The direction `specs/controls.md` puts the camera along, as a unit vector. */
function orbitDirection(yaw: number, pitch: number): Vec3 {
  const cosPitch = Math.cos(pitch * DEG);
  return {
    x: cosPitch * Math.cos(yaw * DEG),
    y: Math.sin(pitch * DEG),
    z: cosPitch * Math.sin(yaw * DEG),
  };
}

/** A unit vector at right angles to the orbit direction, and horizontal. */
function acrossDirection(yaw: number): Vec3 {
  return { x: -Math.sin(yaw * DEG), y: 0, z: Math.cos(yaw * DEG) };
}

const step = (from: Vec3, along: Vec3, by: number): Vec3 => ({
  x: from.x + along.x * by,
  y: from.y + along.y * by,
  z: from.z + along.z * by,
});

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the near probe larger than the far one by the orbit distance's ratio", async () => {
  await openSite(h, 0);

  const along = orbitDirection(CAMERA_START_YAW, CAMERA_START_PITCH);
  const across = acrossDirection(CAMERA_START_YAW);

  /** The stage length the across-offset is drawn at, at one probe. */
  const spanAt = async (reach: number, what: string): Promise<number> => {
    const foot = step(TARGET, along, reach);
    const head = step(foot, across, ACROSS);
    const a = await h.project(foot.x, foot.y, foot.z);
    const b = await h.project(head.x, head.y, head.z);
    assertTrue(a.visible, `the ${what} probe is on the stage`);
    assertTrue(b.visible, `the ${what} probe's offset end is on the stage`);
    return Math.hypot(b.x - a.x, b.y - a.y);
  };

  for (const dist of DISTANCES) {
    await h.debug.setCamera(CAMERA_START_YAW, CAMERA_START_PITCH, dist);
    await h.advance(1);

    const near = await spanAt(REACH, `near (distance ${dist})`);
    const far = await spanAt(-REACH, `far (distance ${dist})`);

    assertNearFraction(
      near / far,
      (dist + REACH) / (dist - REACH),
      TOLERANCE,
      `the stage length of a ${ACROSS}-unit offset ${REACH} units along the ` +
        `orbit direction over the same offset ${REACH} units the other way, ` +
        `at distance ${dist}: the camera stands ${dist} from the target on ` +
        "the +u side of it (specs/controls.md)",
    );
  }

  await h.capture(
    "state",
    "the yard from the closer of the two camera distances",
  );
});

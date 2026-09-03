// The camera, and the projection the yard is picked and reported through.
//
// `specs/controls.md` fixes where the orbit camera stands; the lens is the
// build's, and `CAMERA_FOV` is it. This module is the one description of both,
// so the camera `render` poses, the picking of `specs/controls.md`, and the
// `pick` the snapshot reports cannot disagree.
//
// The engine's own `view()` answers from the camera as it stood at the most
// recent render, which is a frame behind while the camera moves and is not
// reachable from a reading at all — `snapshot` is handed the state alone. The
// picking therefore reads the state's own camera through the arithmetic below,
// which is the same projection `render` writes onto the engine's camera. It is
// pure: it touches no canvas, no `three` object, and no DOM, so it runs in Node
// exactly as it runs in the browser.

import { CAMERA_TARGET, STAGE_H, STAGE_W } from "./constants";
import type { ReadonlyPoint } from "./convert";
import type { Camera } from "./game";

/** Degrees to radians. */
const DEG = Math.PI / 180;

/**
 * The vertical field of view, in degrees, of the camera the yard is drawn
 * through. `render` writes it onto the engine's perspective camera, and the
 * projection below reads it from here, so the two are the one lens.
 */
export const CAMERA_FOV = 45;

/** The stage's aspect ratio, which the engine holds the camera's aspect at. */
export const STAGE_ASPECT = STAGE_W / STAGE_H;

/** The point the orbit camera looks at (`specs/controls.md`). */
export const TARGET: ReadonlyPoint = CAMERA_TARGET;

/** A point on the stage, in logical stage units. */
export interface StagePoint {
  x: number;
  y: number;
  /** Whether the world position is in front of the camera and on the stage. */
  visible: boolean;
}

/**
 * Where the orbit camera stands: `CAMERA_TARGET` plus
 * `dist * (cos(pitch) cos(yaw), sin(pitch), cos(pitch) sin(yaw))`
 * (`specs/controls.md`).
 */
export function cameraPosition(camera: Camera): ReadonlyPoint {
  const yaw = camera.yaw * DEG;
  const pitch = camera.pitch * DEG;
  const cosPitch = Math.cos(pitch);
  return {
    x: TARGET.x + camera.dist * cosPitch * Math.cos(yaw),
    y: TARGET.y + camera.dist * Math.sin(pitch),
    z: TARGET.z + camera.dist * cosPitch * Math.sin(yaw),
  };
}

/** The camera's own axes: where it looks, and which way is right and up. */
export interface CameraBasis {
  readonly eye: ReadonlyPoint;
  /** Unit, from the eye toward `CAMERA_TARGET`. */
  readonly forward: ReadonlyPoint;
  /** Unit, the stage's `+x`. */
  readonly right: ReadonlyPoint;
  /** Unit, the stage's `+y`. */
  readonly up: ReadonlyPoint;
}

const normalize = (v: ReadonlyPoint): ReadonlyPoint => {
  const l = Math.hypot(v.x, v.y, v.z);
  return l === 0
    ? { x: 0, y: 0, z: -1 }
    : { x: v.x / l, y: v.y / l, z: v.z / l };
};

const cross = (a: ReadonlyPoint, b: ReadonlyPoint): ReadonlyPoint => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

/**
 * The basis `three`'s own `lookAt` builds for a camera at `cameraPosition`
 * looking at `CAMERA_TARGET` with `+y` up: right is `forward x up`, and the
 * camera's true up is `right x forward`. The pitch never reaches `90`
 * (`CAMERA_PITCH_MAX` is `80`), so the two are never parallel.
 */
export function cameraBasis(camera: Camera): CameraBasis {
  const eye = cameraPosition(camera);
  const forward = normalize({
    x: TARGET.x - eye.x,
    y: TARGET.y - eye.y,
    z: TARGET.z - eye.z,
  });
  const right = normalize(cross(forward, { x: 0, y: 1, z: 0 }));
  const up = cross(right, forward);
  return { eye, forward, right, up };
}

/** How far in front of the camera a world position stands. */
export const depthOf = (basis: CameraBasis, p: ReadonlyPoint): number =>
  (p.x - basis.eye.x) * basis.forward.x +
  (p.y - basis.eye.y) * basis.forward.y +
  (p.z - basis.eye.z) * basis.forward.z;

/** The distance between two world positions. */
export const distanceBetween = (a: ReadonlyPoint, b: ReadonlyPoint): number =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/**
 * The point on the stage a world position is drawn at: a perspective projection
 * through the camera as it stands, with a vertical field of view of
 * `CAMERA_FOV` and the stage's aspect ratio. Pure, and moves nothing.
 *
 * A position behind the camera has no point on the stage; the coordinates that
 * come back for one are the mirrored ones the maths gives, and `visible` is
 * `false`, as it is for a position projecting off the stage.
 */
export function project(camera: Camera, world: ReadonlyPoint): StagePoint {
  const { eye, forward, right, up } = cameraBasis(camera);
  const dx = world.x - eye.x;
  const dy = world.y - eye.y;
  const dz = world.z - eye.z;
  const depth = dx * forward.x + dy * forward.y + dz * forward.z;
  const across = dx * right.x + dy * right.y + dz * right.z;
  const above = dx * up.x + dy * up.y + dz * up.z;

  const half = Math.tan((CAMERA_FOV * DEG) / 2);
  const scale = depth === 0 ? 0 : 1 / (Math.abs(depth) * half);
  const ndcX = (across * scale) / STAGE_ASPECT;
  const ndcY = above * scale;
  const x = ((ndcX + 1) / 2) * STAGE_W;
  const y = ((1 - ndcY) / 2) * STAGE_H;
  const visible = depth > 0 && x >= 0 && x <= STAGE_W && y >= 0 && y <= STAGE_H;
  return { x, y, visible };
}

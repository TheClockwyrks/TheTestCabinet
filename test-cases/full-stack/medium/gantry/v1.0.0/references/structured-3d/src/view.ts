// Where the orbit camera stands, and where a world position lands on the stage.
//
// One description of the camera, so the frustum the engine renders the yard
// through, the picking of `specs/controls.md`, and anything else that needs a
// stage point cannot disagree. It is pure arithmetic over the camera pose the
// state holds: it touches no engine object, no canvas, and no DOM, so it runs
// in Node exactly as it runs in the browser, and the game mode poses
// `world.camera` from the very same figures.

import { CAMERA_TARGET, STAGE_H, STAGE_W } from "./constants";
import { DEG, type Vec3 } from "./sim";
import type { Camera } from "./game";

/**
 * The vertical field of view, in degrees, the yard is drawn through.
 * `specs/controls.md` fixes the camera's pose and not its lens, so the lens is
 * the build's; it is named here once and the game mode writes it onto
 * `world.camera.fov`, which is what keeps the picture and the picking in step.
 */
export const CAMERA_FOV = 45;

/** The stage's aspect ratio, which the engine holds the camera's frustum at. */
export const STAGE_ASPECT = STAGE_W / STAGE_H;

/** The point the orbit camera looks at, as the triple the maths works in. */
export const TARGET: Vec3 = [CAMERA_TARGET.x, CAMERA_TARGET.y, CAMERA_TARGET.z];

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
export function cameraPosition(camera: Camera): Vec3 {
  const yaw = camera.yaw * DEG;
  const pitch = camera.pitch * DEG;
  const cosPitch = Math.cos(pitch);
  return [
    TARGET[0] + camera.dist * cosPitch * Math.cos(yaw),
    TARGET[1] + camera.dist * Math.sin(pitch),
    TARGET[2] + camera.dist * cosPitch * Math.sin(yaw),
  ];
}

/** The camera's own axes: where it looks, and which way is right and up. */
export interface CameraBasis {
  readonly eye: Vec3;
  /** Unit, from the eye toward `CAMERA_TARGET`. */
  readonly forward: Vec3;
  /** Unit, the stage's `+x`. */
  readonly right: Vec3;
  /** Unit, the stage's `+y`. */
  readonly up: Vec3;
}

const normalize = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l === 0 ? [0, 0, -1] : [v[0] / l, v[1] / l, v[2] / l];
};

const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/**
 * The basis the engine's camera takes from `lookAt(CAMERA_TARGET)` at
 * `cameraPosition` with `+y` up: right is `forward x up`, and the camera's true
 * up is `right x forward`. The pitch never reaches `90` (`CAMERA_PITCH_MAX` is
 * `80`), so the two are never parallel.
 */
export function cameraBasis(camera: Camera): CameraBasis {
  const eye = cameraPosition(camera);
  const forward = normalize([
    TARGET[0] - eye[0],
    TARGET[1] - eye[1],
    TARGET[2] - eye[2],
  ]);
  const right = normalize(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  return { eye, forward, right, up };
}

/**
 * The point on the stage a world position is drawn at: the same perspective the
 * engine's camera renders through, at `CAMERA_FOV` over the stage's aspect.
 * Pure, and moves nothing.
 *
 * A position behind the camera has no point on the stage; the coordinates that
 * come back for one are the mirrored ones the maths gives, and `visible` is
 * `false`, as it is for a position projecting off the stage.
 */
export function project(camera: Camera, world: Vec3): StagePoint {
  const { eye, forward, right, up } = cameraBasis(camera);
  const dx = world[0] - eye[0];
  const dy = world[1] - eye[1];
  const dz = world[2] - eye[2];
  const depth = dx * forward[0] + dy * forward[1] + dz * forward[2];
  const across = dx * right[0] + dy * right[1] + dz * right[2];
  const above = dx * up[0] + dy * up[1] + dz * up[2];

  const half = Math.tan((CAMERA_FOV * DEG) / 2);
  const scale = depth === 0 ? 0 : 1 / (Math.abs(depth) * half);
  const ndcX = (across * scale) / STAGE_ASPECT;
  const ndcY = above * scale;
  const x = ((ndcX + 1) / 2) * STAGE_W;
  const y = ((1 - ndcY) / 2) * STAGE_H;
  const visible = depth > 0 && x >= 0 && x <= STAGE_W && y >= 0 && y <= STAGE_H;
  return { x, y, visible };
}

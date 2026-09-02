import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  CAMERA_DIST_MAX,
  CAMERA_DIST_MIN,
  CAMERA_START_DIST,
  CAMERA_START_PITCH,
  CAMERA_START_YAW,
  CAMERA_TARGET,
  STAGE_H,
  STAGE_W,
} from "./constants";
import { DEG, type Vec3 } from "./sim";
import {
  CAMERA_FOV,
  cameraBasis,
  cameraPosition,
  project,
  STAGE_ASPECT,
  TARGET,
} from "./render-project";
import type { Camera } from "./state";

/**
 * A pose, taken as written. The projection is pure maths over any pose, so
 * these do not go through `poseCamera`'s clamps; the clamps are `src/state.ts`'s
 * and are tested there.
 */
const camera = (yaw: number, pitch: number, dist: number): Camera => ({
  yaw,
  pitch,
  dist,
});

const START = camera(CAMERA_START_YAW, CAMERA_START_PITCH, CAMERA_START_DIST);

/** The same projection through `three`'s own camera, for a cross-check. */
function throughThree(pose: Camera, world: Vec3): { x: number; y: number } {
  const eye = cameraPosition(pose);
  const perspective = new THREE.PerspectiveCamera(
    CAMERA_FOV,
    STAGE_ASPECT,
    0.5,
    600,
  );
  perspective.position.set(eye[0], eye[1], eye[2]);
  perspective.up.set(0, 1, 0);
  perspective.lookAt(TARGET[0], TARGET[1], TARGET[2]);
  perspective.updateMatrixWorld(true);
  const point = new THREE.Vector3(world[0], world[1], world[2]).project(
    perspective,
  );
  return {
    x: ((point.x + 1) / 2) * STAGE_W,
    y: ((1 - point.y) / 2) * STAGE_H,
  };
}

describe("cameraPosition", () => {
  it("stands where specs/controls.md puts it", () => {
    const pose = camera(0, 0, 20);
    expect(cameraPosition(pose)).toEqual([
      CAMERA_TARGET.x + 20,
      CAMERA_TARGET.y,
      CAMERA_TARGET.z,
    ]);
  });

  it("carries a positive yaw from +x toward +z", () => {
    const [x, y, z] = cameraPosition(camera(90, 0, 20));
    expect(x).toBeCloseTo(CAMERA_TARGET.x, 9);
    expect(y).toBeCloseTo(CAMERA_TARGET.y, 9);
    expect(z).toBeCloseTo(CAMERA_TARGET.z + 20, 9);
  });

  it("raises a positive pitch above the target", () => {
    const [, y] = cameraPosition(camera(0, 30, 40));
    expect(y).toBeCloseTo(CAMERA_TARGET.y + 40 * Math.sin(30 * DEG), 9);
  });

  it("stays at the stated distance from the target at every pose", () => {
    for (const yaw of [0, 45, 137, 300]) {
      for (const pitch of [10, 30, 80]) {
        for (const dist of [CAMERA_DIST_MIN, 40, CAMERA_DIST_MAX]) {
          const eye = cameraPosition(camera(yaw, pitch, dist));
          const away = Math.hypot(
            eye[0] - TARGET[0],
            eye[1] - TARGET[1],
            eye[2] - TARGET[2],
          );
          expect(away).toBeCloseTo(dist, 9);
        }
      }
    }
  });
});

describe("cameraBasis", () => {
  it("is orthonormal and right-handed", () => {
    const { forward, right, up } = cameraBasis(START);
    const dot = (a: Vec3, b: Vec3): number =>
      a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    expect(dot(forward, forward)).toBeCloseTo(1, 9);
    expect(dot(right, right)).toBeCloseTo(1, 9);
    expect(dot(up, up)).toBeCloseTo(1, 9);
    expect(dot(forward, right)).toBeCloseTo(0, 9);
    expect(dot(forward, up)).toBeCloseTo(0, 9);
    expect(dot(right, up)).toBeCloseTo(0, 9);
    // `right` is horizontal for every pose the orbit limits allow.
    expect(right[1]).toBeCloseTo(0, 9);
  });
});

describe("project", () => {
  it("puts the camera's target at the middle of the stage", () => {
    const point = project(START, TARGET);
    expect(point.x).toBeCloseTo(STAGE_W / 2, 6);
    expect(point.y).toBeCloseTo(STAGE_H / 2, 6);
    expect(point.visible).toBe(true);
  });

  it("agrees with three's own camera, which is what draws the yard", () => {
    const poses = [
      START,
      camera(0, 10, 10),
      camera(200, 80, 80),
      camera(311.5, 47.25, 23.5),
    ];
    const points: Vec3[] = [
      [0, 0, 0],
      [8, 2, -6],
      [-7, 12, 4],
      [1, 6, 1],
      [14, 0, 6],
    ];
    for (const pose of poses) {
      for (const world of points) {
        const { eye, forward } = cameraBasis(pose);
        const depth =
          (world[0] - eye[0]) * forward[0] +
          (world[1] - eye[1]) * forward[1] +
          (world[2] - eye[2]) * forward[2];
        // A position behind the camera has no point on the stage, so there is
        // nothing to agree about; `project` reports it as not visible.
        if (depth <= 0) {
          expect(project(pose, world).visible).toBe(false);
          continue;
        }
        const mine = project(pose, world);
        const theirs = throughThree(pose, world);
        expect(mine.x).toBeCloseTo(theirs.x, 6);
        expect(mine.y).toBeCloseTo(theirs.y, 6);
      }
    }
  });

  it("moves a point to the right of the stage as the yaw turns", () => {
    // At yaw 0 the camera stands toward +x and looks back along -x, so its own
    // right hand points toward -z.
    const point = project(camera(0, 0, 20), [0, CAMERA_TARGET.y, -4]);
    expect(point.x).toBeGreaterThan(STAGE_W / 2);
    expect(point.y).toBeCloseTo(STAGE_H / 2, 6);
  });

  it("puts a higher world position higher on the stage", () => {
    const low = project(camera(0, 0, 20), [0, 4, 0]);
    const high = project(camera(0, 0, 20), [0, 8, 0]);
    expect(high.y).toBeLessThan(low.y);
  });

  it("reports a position behind the camera as not visible", () => {
    // Directly behind the eye at yaw 0, which stands toward +x.
    const behind = project(camera(0, 0, 20), [CAMERA_TARGET.x + 60, 6, 0]);
    expect(behind.visible).toBe(false);
  });

  it("reports a position off the stage as not visible", () => {
    const off = project(camera(0, 10, 10), [0, 6, 40]);
    expect(off.visible).toBe(false);
  });

  it("moves nothing it is handed", () => {
    const pose = camera(45, 30, 40);
    const before = { ...pose };
    const world: Vec3 = [3, 4, 5];
    project(pose, world);
    expect(pose).toEqual(before);
    expect(world).toEqual([3, 4, 5]);
  });
});

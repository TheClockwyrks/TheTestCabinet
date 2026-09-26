// The camera and the projection everything is picked and reported through.

import { describe, expect, it } from "vitest";
import { CAMERA_TARGET, STAGE_H, STAGE_W } from "./constants";
import type { Camera } from "./game";
import {
  CAMERA_FOV,
  cameraBasis,
  cameraPosition,
  depthOf,
  distanceBetween,
  project,
  STAGE_ASPECT,
} from "./project";
import { startCamera } from "./state";

const at = (yaw: number, pitch: number, dist: number): Camera => ({
  yaw,
  pitch,
  dist,
});

describe("where the camera stands", () => {
  it("is the target plus the orbit offset, in the game's own sense of yaw", () => {
    const eye = cameraPosition(at(0, 0, 10));
    expect(eye.x).toBeCloseTo(CAMERA_TARGET.x + 10, 9);
    expect(eye.y).toBeCloseTo(CAMERA_TARGET.y, 9);
    expect(eye.z).toBeCloseTo(CAMERA_TARGET.z, 9);
  });

  it("carries a positive yaw from +x toward +z", () => {
    const eye = cameraPosition(at(90, 0, 10));
    expect(eye.x).toBeCloseTo(CAMERA_TARGET.x, 9);
    expect(eye.z).toBeCloseTo(CAMERA_TARGET.z + 10, 9);
  });

  it("raises the eye above the target on a positive pitch", () => {
    expect(cameraPosition(at(0, 30, 10)).y).toBeCloseTo(CAMERA_TARGET.y + 5, 9);
  });

  it("stands its distance from the target", () => {
    expect(
      distanceBetween(cameraPosition(at(37, 21, 17)), CAMERA_TARGET),
    ).toBeCloseTo(17, 9);
  });
});

describe("the camera's basis", () => {
  it("is orthonormal and looks at the target", () => {
    const basis = cameraBasis(startCamera());
    const dot = (a: typeof basis.up, b: typeof basis.up): number =>
      a.x * b.x + a.y * b.y + a.z * b.z;
    expect(dot(basis.forward, basis.forward)).toBeCloseTo(1, 9);
    expect(dot(basis.right, basis.right)).toBeCloseTo(1, 9);
    expect(dot(basis.up, basis.up)).toBeCloseTo(1, 9);
    expect(dot(basis.forward, basis.right)).toBeCloseTo(0, 9);
    expect(dot(basis.forward, basis.up)).toBeCloseTo(0, 9);
    expect(depthOf(basis, CAMERA_TARGET)).toBeCloseTo(startCamera().dist, 9);
  });
});

describe("the projection", () => {
  it("draws the target at the middle of the stage", () => {
    const drawn = project(startCamera(), CAMERA_TARGET);
    expect(drawn.x).toBeCloseTo(STAGE_W / 2, 6);
    expect(drawn.y).toBeCloseTo(STAGE_H / 2, 6);
    expect(drawn.visible).toBe(true);
  });

  it("puts a point at the top of the frustum on the stage's top edge", () => {
    const camera = at(0, 0, 10);
    const half = Math.tan((CAMERA_FOV * Math.PI) / 360) * 10;
    const drawn = project(camera, {
      x: CAMERA_TARGET.x,
      y: CAMERA_TARGET.y + half,
      z: CAMERA_TARGET.z,
    });
    expect(drawn.y).toBeCloseTo(0, 6);
    expect(drawn.x).toBeCloseTo(STAGE_W / 2, 6);
  });

  it("stretches the horizontal field by the stage's aspect", () => {
    const camera = at(0, 0, 10);
    const half = Math.tan((CAMERA_FOV * Math.PI) / 360) * 10;
    const drawn = project(camera, {
      x: CAMERA_TARGET.x,
      y: CAMERA_TARGET.y,
      z: CAMERA_TARGET.z + half * STAGE_ASPECT,
    });
    expect(drawn.x).toBeCloseTo(0, 6);
  });

  it("reports a point behind the camera as not visible", () => {
    const camera = at(0, 0, 10);
    const behind = project(camera, {
      x: CAMERA_TARGET.x + 20,
      y: CAMERA_TARGET.y,
      z: CAMERA_TARGET.z,
    });
    expect(behind.visible).toBe(false);
  });

  it("reports a point off the stage as not visible", () => {
    const drawn = project(at(0, 0, 10), {
      x: CAMERA_TARGET.x,
      y: CAMERA_TARGET.y + 100,
      z: CAMERA_TARGET.z,
    });
    expect(drawn.visible).toBe(false);
  });
});

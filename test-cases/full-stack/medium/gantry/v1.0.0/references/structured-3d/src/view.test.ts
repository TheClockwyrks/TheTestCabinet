import { describe, expect, it } from "vitest";
import {
  CAMERA_START_DIST,
  CAMERA_TARGET,
  STAGE_H,
  STAGE_W,
} from "./constants";
import { cameraBasis, cameraPosition, project, TARGET } from "./view";
import { startCamera } from "./state";

describe("cameraPosition", () => {
  it("stands toward +x of the target at yaw 0, pitch 0", () => {
    const at = cameraPosition({ yaw: 0, pitch: 0, dist: 10 });
    expect(at[0]).toBeCloseTo(CAMERA_TARGET.x + 10, 9);
    expect(at[1]).toBeCloseTo(CAMERA_TARGET.y, 9);
    expect(at[2]).toBeCloseTo(CAMERA_TARGET.z, 9);
  });

  it("carries the eye from +x toward +z as the yaw rises", () => {
    const at = cameraPosition({ yaw: 90, pitch: 0, dist: 10 });
    expect(at[0]).toBeCloseTo(CAMERA_TARGET.x, 9);
    expect(at[2]).toBeCloseTo(CAMERA_TARGET.z + 10, 9);
  });

  it("raises the eye above the target's level on a positive pitch", () => {
    expect(cameraPosition({ yaw: 0, pitch: 30, dist: 40 })[1]).toBeGreaterThan(
      CAMERA_TARGET.y,
    );
  });

  it("stands the start pose its distance from the target", () => {
    const at = cameraPosition(startCamera());
    const d = Math.hypot(
      at[0] - TARGET[0],
      at[1] - TARGET[1],
      at[2] - TARGET[2],
    );
    expect(d).toBeCloseTo(CAMERA_START_DIST, 9);
  });
});

describe("cameraBasis", () => {
  it("looks from the eye toward the target, with an orthonormal frame", () => {
    const { eye, forward, right, up } = cameraBasis(startCamera());
    expect(Math.hypot(forward[0], forward[1], forward[2])).toBeCloseTo(1, 9);
    expect(Math.hypot(right[0], right[1], right[2])).toBeCloseTo(1, 9);
    expect(Math.hypot(up[0], up[1], up[2])).toBeCloseTo(1, 9);
    expect(
      forward[0] * right[0] + forward[1] * right[1] + forward[2] * right[2],
    ).toBeCloseTo(0, 9);
    // Forward points from the eye at the target.
    expect(TARGET[0] - eye[0]).toBeCloseTo(forward[0] * CAMERA_START_DIST, 6);
  });
});

describe("project", () => {
  it("draws the camera target at the middle of the stage", () => {
    const at = project(startCamera(), TARGET);
    expect(at.x).toBeCloseTo(STAGE_W / 2, 6);
    expect(at.y).toBeCloseTo(STAGE_H / 2, 6);
    expect(at.visible).toBe(true);
  });

  it("reports a position behind the camera as not visible", () => {
    const camera = { yaw: 0, pitch: 0, dist: 10 };
    const behind = project(camera, [TARGET[0] + 40, TARGET[1], TARGET[2]]);
    expect(behind.visible).toBe(false);
  });

  it("draws a point to the camera's right further along the stage's x", () => {
    const camera = { yaw: 0, pitch: 0, dist: 20 };
    const { right } = cameraBasis(camera);
    const at = project(camera, [
      TARGET[0] + right[0] * 2,
      TARGET[1] + right[1] * 2,
      TARGET[2] + right[2] * 2,
    ]);
    expect(at.x).toBeGreaterThan(STAGE_W / 2);
    expect(at.y).toBeCloseTo(STAGE_H / 2, 6);
  });
});

import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { SceneCamera, Vec3 } from "./contract";
import {
  CAMERA_DEFAULTS,
  PROJECTIONS,
  createCamera,
  createView,
  toQuat,
  toVec3,
  type ViewReader,
} from "./view";

/**
 * The design size every assertion below is stated against. 640 by 360 is the size
 * the engine's own documentation works in, and its aspect (16:9) is not 1, which is
 * what makes a mistake in the x/y mapping show up as a wrong number rather than as
 * a coincidence.
 */
const W = 640;
const H = 360;

/** The centre of the logical field, which is where the view axis lands. */
const CX = W / 2;
const CY = H / 2;

/** A perspective camera at the defaults, with its reader. */
function perspective(width = W, height = H): ViewReader & { camera: SceneCamera } {
  const camera = createCamera("perspective", width, height);
  return { camera, ...createView(camera, width, height) };
}

/** An orthographic camera at the defaults, with its reader. */
function orthographic(width = W, height = H): ViewReader & { camera: SceneCamera } {
  const camera = createCamera("orthographic", width, height);
  return { camera, ...createView(camera, width, height) };
}

/** The length of a plain vector, for the unit-length claims the contract makes. */
function length(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

/** A point `t` world units along a ray, which is the only way a ray is consumed. */
function along(origin: Vec3, direction: Vec3, t: number): Vec3 {
  return {
    x: origin.x + direction.x * t,
    y: origin.y + direction.y * t,
    z: origin.z + direction.z * t,
  };
}

describe("CAMERA_DEFAULTS", () => {
  it("is the documented pose and projection", () => {
    expect(CAMERA_DEFAULTS.position).toEqual({ x: 0, y: 0, z: 10 });
    expect(CAMERA_DEFAULTS.fov).toBe(60);
    expect(CAMERA_DEFAULTS.near).toBe(0.1);
    expect(CAMERA_DEFAULTS.far).toBe(1000);
    expect(CAMERA_DEFAULTS.zoom).toBe(1);
  });

  it("is frozen, so one engine's defaults cannot be changed by another", () => {
    expect(Object.isFrozen(CAMERA_DEFAULTS)).toBe(true);
    expect(Object.isFrozen(CAMERA_DEFAULTS.position)).toBe(true);
  });
});

describe("PROJECTIONS", () => {
  it("names both projections, in the order the error message lists them", () => {
    expect([...PROJECTIONS]).toEqual(["perspective", "orthographic"]);
  });
});

describe("createCamera", () => {
  it("builds a perspective camera at the documented defaults", () => {
    const camera = createCamera("perspective", W, H);

    expect(camera).toBeInstanceOf(THREE.PerspectiveCamera);
    const perspectiveCamera = camera as THREE.PerspectiveCamera;
    expect(perspectiveCamera.fov).toBe(60);
    expect(perspectiveCamera.near).toBe(0.1);
    expect(perspectiveCamera.far).toBe(1000);
    expect(perspectiveCamera.zoom).toBe(1);
    expect(perspectiveCamera.position.toArray()).toEqual([0, 0, 10]);
    // The identity rotation: looking along -Z with +Y up.
    expect(perspectiveCamera.quaternion.toArray()).toEqual([0, 0, 0, 1]);
  });

  it("holds a perspective camera's aspect at the design aspect, not the canvas's", () => {
    expect((createCamera("perspective", 640, 360) as THREE.PerspectiveCamera).aspect).toBeCloseTo(
      640 / 360,
      12,
    );
    expect((createCamera("perspective", 512, 512) as THREE.PerspectiveCamera).aspect).toBeCloseTo(
      1,
      12,
    );
  });

  it("builds an orthographic camera spanning the design size", () => {
    const camera = createCamera("orthographic", W, H);

    expect(camera).toBeInstanceOf(THREE.OrthographicCamera);
    const ortho = camera as THREE.OrthographicCamera;
    expect(ortho.left).toBe(-320);
    expect(ortho.right).toBe(320);
    expect(ortho.top).toBe(180);
    expect(ortho.bottom).toBe(-180);
    expect(ortho.near).toBe(0.1);
    expect(ortho.far).toBe(1000);
    expect(ortho.zoom).toBe(1);
    expect(ortho.position.toArray()).toEqual([0, 0, 10]);
  });

  it("leaves both cameras with a current world and projection matrix", () => {
    // A caller that reads the camera before any frame has run — a validator posing
    // `engine.camera` at construction — finds matrices that already describe the
    // defaults rather than an identity waiting for the first render.
    for (const projection of PROJECTIONS) {
      const camera = createCamera(projection, W, H);
      expect(camera.matrixWorld.elements[14]).toBe(10);
      expect(camera.projectionMatrix.equals(new THREE.Matrix4())).toBe(false);
    }
  });

  it("refuses a projection outside the pair, naming both values and the mistake", () => {
    let thrown: unknown;
    try {
      createCamera("orthagraphic", W, H);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toContain("perspective");
    expect(message).toContain("orthographic");
    expect(message).toContain("orthagraphic");
  });

  it("refuses a projection that is not a string at all", () => {
    // The option is a closed pair to TypeScript, but a produced build is
    // JavaScript and a case's configuration is data, so the check runs anyway.
    expect(() => createCamera(undefined as unknown as string, W, H)).toThrow(
      /"perspective" or "orthographic"/,
    );
    expect(() => createCamera("" as string, W, H)).toThrow(/"perspective" or "orthographic"/);
  });
});

describe("toVec3 and toQuat", () => {
  it("copy a three value into the plain shape the contract speaks in", () => {
    expect(toVec3(new THREE.Vector3(1, -2, 3.5))).toEqual({ x: 1, y: -2, z: 3.5 });
    expect(toQuat(new THREE.Quaternion(0, 0, 0, 1))).toEqual({ x: 0, y: 0, z: 0, w: 1 });
  });

  it("copies rather than aliases, so a later write to the three value is not seen", () => {
    const source = new THREE.Vector3(1, 2, 3);
    const copy = toVec3(source);
    source.set(9, 9, 9);

    expect(copy).toEqual({ x: 1, y: 2, z: 3 });
  });
});

describe("view().camera()", () => {
  it("reports the perspective defaults before the first render", () => {
    const snapshot = perspective().view.camera();

    expect(snapshot.projection).toBe("perspective");
    expect(snapshot.position).toEqual({ x: 0, y: 0, z: 10 });
    expect(snapshot.rotation).toEqual({ x: 0, y: 0, z: 0, w: 1 });
    expect(snapshot.fov).toBe(60);
    expect(snapshot.near).toBe(0.1);
    expect(snapshot.far).toBe(1000);
    expect(snapshot.zoom).toBe(1);
  });

  it("reads a perspective camera's orthographic extents as zero", () => {
    const snapshot = perspective().view.camera();

    expect(snapshot.left).toBe(0);
    expect(snapshot.right).toBe(0);
    expect(snapshot.top).toBe(0);
    expect(snapshot.bottom).toBe(0);
  });

  it("reports the orthographic defaults before the first render", () => {
    const snapshot = orthographic().view.camera();

    expect(snapshot.projection).toBe("orthographic");
    expect(snapshot.position).toEqual({ x: 0, y: 0, z: 10 });
    expect(snapshot.rotation).toEqual({ x: 0, y: 0, z: 0, w: 1 });
    expect(snapshot.near).toBe(0.1);
    expect(snapshot.far).toBe(1000);
    expect(snapshot.zoom).toBe(1);
    expect(snapshot.left).toBe(-320);
    expect(snapshot.right).toBe(320);
    expect(snapshot.top).toBe(180);
    expect(snapshot.bottom).toBe(-180);
  });

  it("reads an orthographic camera's field of view as zero", () => {
    expect(orthographic().view.camera().fov).toBe(0);
  });

  it("reports the pose a lookAt left, as a quaternion", () => {
    const { camera, view, read } = perspective();
    camera.position.set(0, 10, 10);
    camera.lookAt(0, 0, 0);
    read();

    const snapshot = view.camera();
    expect(snapshot.position.x).toBeCloseTo(0, 12);
    expect(snapshot.position.y).toBeCloseTo(10, 12);
    expect(snapshot.position.z).toBeCloseTo(10, 12);

    // The camera pitched down by 45 degrees about X: a rotation of -pi/4.
    const expected = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(1, 0, 0),
      -Math.PI / 4,
    );
    expect(snapshot.rotation.x).toBeCloseTo(expected.x, 9);
    expect(snapshot.rotation.y).toBeCloseTo(expected.y, 9);
    expect(snapshot.rotation.z).toBeCloseTo(expected.z, 9);
    expect(snapshot.rotation.w).toBeCloseTo(expected.w, 9);
  });

  it("reports the camera's world pose, not its local one", () => {
    // A build that hangs the camera under a rig it moves — a dolly, a vehicle —
    // still has its picture drawn from where the rig put it, so that is what the
    // view reports and what a validator asserts against.
    const camera = createCamera("perspective", W, H);
    const rig = new THREE.Group();
    rig.position.set(5, 0, -3);
    rig.add(camera);
    rig.updateMatrixWorld(true);

    const { view, read } = createView(camera, W, H);
    read();

    expect(view.camera().position.x).toBeCloseTo(5, 12);
    expect(view.camera().position.y).toBeCloseTo(0, 12);
    expect(view.camera().position.z).toBeCloseTo(7, 12);
  });

  it("hands each caller a snapshot it owns", () => {
    const { view } = perspective();
    const first = view.camera();
    const second = view.camera();

    expect(first).not.toBe(second);
    expect(first.position).not.toBe(second.position);

    first.position.x = 999;
    expect(view.camera().position.x).toBe(0);
  });

  it("leaves a held snapshot alone when a later reading is taken", () => {
    const { camera, view, read } = perspective();
    const held = view.camera();

    camera.position.set(1, 2, 3);
    read();

    expect(held.position).toEqual({ x: 0, y: 0, z: 10 });
    expect(view.camera().position).toEqual({ x: 1, y: 2, z: 3 });
  });

  it("follows a field of view the game narrowed", () => {
    const { camera, view, read } = perspective();
    (camera as THREE.PerspectiveCamera).fov = 35;
    read();

    expect(view.camera().fov).toBe(35);
  });

  it("follows the extents and the zoom an orthographic game wrote", () => {
    const { camera, view, read } = orthographic();
    const ortho = camera as THREE.OrthographicCamera;
    ortho.left = -16;
    ortho.right = 16;
    ortho.top = 9;
    ortho.bottom = -9;
    ortho.zoom = 2;
    read();

    const snapshot = view.camera();
    expect(snapshot.left).toBe(-16);
    expect(snapshot.right).toBe(16);
    expect(snapshot.top).toBe(9);
    expect(snapshot.bottom).toBe(-9);
    expect(snapshot.zoom).toBe(2);
  });
});

describe("the reading's timing", () => {
  it("answers from the defaults for a camera posed before the first read", () => {
    // The specification is explicit: before the first render the view answers from
    // the camera defaults. A validator that poses `engine.camera` and then reads
    // the view without advancing a frame sees the defaults, because a pose reaches
    // the view when the frame that drew with it ends.
    const { camera, view } = perspective();
    camera.position.set(0, 40, 0);
    camera.lookAt(0, 0, 0);

    expect(view.camera().position).toEqual({ x: 0, y: 0, z: 10 });
    expect(view.ray(CX, CY).direction).toEqual({ x: 0, y: 0, z: -1 });
  });

  it("holds one reading until the next, however far the camera moves", () => {
    const { camera, view, read } = orthographic();

    camera.position.set(100, 0, 10);
    expect(view.camera().position.x).toBe(0);
    expect(view.project({ x: 0, y: 0, z: 0 }).x).toBeCloseTo(CX, 9);

    camera.position.set(200, 0, 10);
    expect(view.camera().position.x).toBe(0);

    read();
    expect(view.camera().position.x).toBe(200);
    // The world origin is now 200 units to the camera's left, so it draws left of
    // centre by exactly 200 logical units at the orthographic defaults.
    expect(view.project({ x: 0, y: 0, z: 0 }).x).toBeCloseTo(CX - 200, 9);
  });

  it("returns the same View object across every reading", () => {
    const { view, read } = perspective();
    const before = view;
    read();

    expect(view).toBe(before);
  });

  it("takes a fresh reading on every call, so repeated reads are not cumulative", () => {
    const { camera, view, read } = orthographic();
    camera.position.set(0, 5, 10);
    read();
    read();
    read();

    expect(view.camera().position.y).toBe(5);
  });
});

describe("project, orthographic", () => {
  it("puts the world origin at the centre of the design field", () => {
    const projected = orthographic().view.project({ x: 0, y: 0, z: 0 });

    expect(projected.x).toBeCloseTo(CX, 9);
    expect(projected.y).toBeCloseTo(CY, 9);
    expect(projected.visible).toBe(true);
  });

  it("maps one world unit to one logical unit at the defaults, with y flipped", () => {
    // The defining property of the orthographic defaults: the camera spans the
    // design size, so world +Y is up the screen and logical y counts down from the
    // top.
    const projected = orthographic().view.project({ x: 100, y: 50, z: 0 });

    expect(projected.x).toBeCloseTo(420, 9);
    expect(projected.y).toBeCloseTo(130, 9);
    expect(projected.visible).toBe(true);
  });

  it("puts the camera's extents on the corners of the field", () => {
    const { view } = orthographic();

    const topRight = view.project({ x: 320, y: 180, z: 0 });
    expect(topRight.x).toBeCloseTo(W, 9);
    expect(topRight.y).toBeCloseTo(0, 9);

    const bottomLeft = view.project({ x: -320, y: -180, z: 0 });
    expect(bottomLeft.x).toBeCloseTo(0, 9);
    expect(bottomLeft.y).toBeCloseTo(H, 9);
  });

  it("reports normalized depth running -1 at the near plane to 1 at the far plane", () => {
    const { view } = orthographic();

    // The camera stands at z = 10 looking along -Z, so the near plane is at
    // z = 9.9 and the far plane at z = -990.
    expect(view.project({ x: 0, y: 0, z: 10 - 0.1 }).depth).toBeCloseTo(-1, 9);
    expect(view.project({ x: 0, y: 0, z: 10 - 1000 }).depth).toBeCloseTo(1, 9);
    expect(view.project({ x: 0, y: 0, z: 0 }).depth).toBeCloseTo(
      (2 * 10 - (1000 + 0.1)) / (1000 - 0.1),
      9,
    );
  });

  it("scales with the camera's zoom", () => {
    const { camera, view, read } = orthographic();
    camera.zoom = 2;
    read();

    // Zooming in halves the world span the field covers, so a point 100 units to
    // the right draws 200 logical units right of centre.
    expect(view.project({ x: 100, y: 0, z: 0 }).x).toBeCloseTo(CX + 200, 9);
  });

  it("still reports coordinates for a point off the side of the field", () => {
    const projected = orthographic().view.project({ x: 400, y: 0, z: 0 });

    expect(projected.visible).toBe(false);
    // The direction is what a game clamps an off-screen marker along, so the
    // coordinates are reported rather than suppressed.
    expect(projected.x).toBeCloseTo(720, 9);
    expect(projected.y).toBeCloseTo(CY, 9);
  });

  it("reports a point behind the camera as out of view", () => {
    const projected = orthographic().view.project({ x: 0, y: 0, z: 40 });

    expect(projected.visible).toBe(false);
    expect(projected.depth).toBeLessThan(-1);
  });

  it("reports a point beyond the far plane as out of view", () => {
    const projected = orthographic().view.project({ x: 0, y: 0, z: -2000 });

    expect(projected.visible).toBe(false);
    expect(projected.depth).toBeGreaterThan(1);
  });
});

describe("project, perspective", () => {
  it("puts a point on the view axis at the centre of the design field", () => {
    const projected = perspective().view.project({ x: 0, y: 0, z: 0 });

    expect(projected.x).toBeCloseTo(CX, 9);
    expect(projected.y).toBeCloseTo(CY, 9);
    expect(projected.visible).toBe(true);
    expect(projected.depth).toBeGreaterThan(-1);
    expect(projected.depth).toBeLessThan(1);
  });

  it("projects through the documented field of view and design aspect", () => {
    // Stated from first principles rather than from a recorded number: the
    // half-height of the frustum at distance d is d * tan(fov / 2), and the
    // half-width is that times the aspect.
    const f = 1 / Math.tan(((60 * Math.PI) / 180) / 2);
    const ndcX = ((f / (W / H)) * 2) / 10;
    const ndcY = (f * 1) / 10;

    const projected = perspective().view.project({ x: 2, y: 1, z: 0 });
    expect(projected.x).toBeCloseTo(((ndcX + 1) / 2) * W, 6);
    expect(projected.y).toBeCloseTo(((1 - ndcY) / 2) * H, 6);
  });

  it("draws a nearer point deeper towards -1 than a farther one", () => {
    const { view } = perspective();

    const near = view.project({ x: 0, y: 0, z: 5 });
    const far = view.project({ x: 0, y: 0, z: -50 });
    expect(near.depth).toBeLessThan(far.depth);
    expect(near.visible).toBe(true);
    expect(far.visible).toBe(true);
  });

  it("reports a point behind the camera as out of view", () => {
    expect(perspective().view.project({ x: 0, y: 0, z: 40 }).visible).toBe(false);
  });

  it("keeps a point inside the frustum inside the design field", () => {
    // The letterbox rule stated the other way round: the camera's aspect is the
    // design aspect, so anything the camera can see lands on the field rather than
    // in a bar.
    const { view } = perspective();

    for (const point of [
      { x: 0, y: 0, z: 0 },
      { x: 3, y: 2, z: -4 },
      { x: -3, y: -2, z: 5 },
    ]) {
      const projected = view.project(point);
      expect(projected.visible).toBe(true);
      expect(projected.x).toBeGreaterThanOrEqual(0);
      expect(projected.x).toBeLessThanOrEqual(W);
      expect(projected.y).toBeGreaterThanOrEqual(0);
      expect(projected.y).toBeLessThanOrEqual(H);
    }
  });

  it("follows the camera the most recent reading found", () => {
    const { camera, view, read } = perspective();
    camera.position.set(4, 0, 10);
    read();

    // The camera stepped right, so the origin draws left of centre.
    expect(view.project({ x: 0, y: 0, z: 0 }).x).toBeLessThan(CX);
  });

  it("hands each caller a fresh result", () => {
    const { view } = perspective();
    const first = view.project({ x: 0, y: 0, z: 0 });
    const second = view.project({ x: 0, y: 0, z: 0 });

    expect(first).not.toBe(second);
    first.x = 999;
    expect(view.project({ x: 0, y: 0, z: 0 }).x).toBeCloseTo(CX, 9);
  });
});

describe("ray, perspective", () => {
  it("starts at the camera's eye and points along its view direction at the centre", () => {
    const ray = perspective().view.ray(CX, CY);

    expect(ray.origin).toEqual({ x: 0, y: 0, z: 10 });
    expect(ray.direction.x).toBeCloseTo(0, 12);
    expect(ray.direction.y).toBeCloseTo(0, 12);
    expect(ray.direction.z).toBeCloseTo(-1, 12);
  });

  it("returns a unit-length direction, so a distance along it is in world units", () => {
    const { view } = perspective();

    for (const [x, y] of [
      [CX, CY],
      [0, 0],
      [W, H],
      [123, 45],
    ] as const) {
      expect(length(view.ray(x, y).direction)).toBeCloseTo(1, 12);
    }
  });

  it("aims right and up for a point right of and above the centre", () => {
    // Logical y runs down, so a smaller y is higher on the stage and the ray tilts
    // towards world +Y.
    const ray = perspective().view.ray(CX + 100, CY - 50);

    expect(ray.direction.x).toBeGreaterThan(0);
    expect(ray.direction.y).toBeGreaterThan(0);
    expect(ray.direction.z).toBeLessThan(0);
  });

  it("is the inverse of project, for any point in front of the camera", () => {
    const { view } = perspective();

    for (const [x, y] of [
      [CX, CY],
      [100, 60],
      [600, 300],
    ] as const) {
      const ray = view.ray(x, y);
      const round = view.project(along(ray.origin, ray.direction, 7));
      expect(round.x).toBeCloseTo(x, 6);
      expect(round.y).toBeCloseTo(y, 6);
    }
  });

  it("picks the ground plane the camera is aimed at", () => {
    // The idiom the usage page shows: a camera looking down at the origin, a click
    // in the middle of the stage, and the intersection with y = 0.
    const { camera, view, read } = perspective();
    camera.position.set(0, 10, 10);
    camera.lookAt(0, 0, 0);
    read();

    const ray = view.ray(CX, CY);
    expect(ray.origin).toEqual({ x: 0, y: 10, z: 10 });
    expect(ray.direction.y).toBeLessThan(0);

    const t = -ray.origin.y / ray.direction.y;
    const ground = along(ray.origin, ray.direction, t);
    expect(ground.x).toBeCloseTo(0, 9);
    expect(ground.y).toBeCloseTo(0, 9);
    expect(ground.z).toBeCloseTo(0, 9);
  });

  it("follows a camera the previous reading posed, not the live one", () => {
    const { camera, view, read } = perspective();
    camera.position.set(0, 0, 25);
    read();
    expect(view.ray(CX, CY).origin.z).toBe(25);

    camera.position.set(0, 0, 99);
    expect(view.ray(CX, CY).origin.z).toBe(25);
  });

  it("casts a ray outside the picture for a point inside a letterbox bar", () => {
    // The pointer maps onto the same logical field the picture fills, so a point
    // in a bar maps outside 0..width. The ray is well defined; whether to clamp it
    // or treat it as a miss is the game's decision, not the engine's.
    const { view } = perspective();
    const ray = view.ray(-100, CY);

    expect(ray.direction.x).toBeLessThan(0);
    expect(length(ray.direction)).toBeCloseTo(1, 12);

    // Anything along it projects back off the left of the field.
    const back = view.project(along(ray.origin, ray.direction, 5));
    expect(back.x).toBeCloseTo(-100, 6);
    expect(back.visible).toBe(false);
  });

  it("hands each caller a fresh result", () => {
    const { view } = perspective();
    const first = view.ray(CX, CY);
    const second = view.ray(CX, CY);

    expect(first).not.toBe(second);
    expect(first.origin).not.toBe(second.origin);
    first.direction.z = 999;
    expect(view.ray(CX, CY).direction.z).toBeCloseTo(-1, 12);
  });
});

describe("ray, orthographic", () => {
  it("starts at the stage point on the near plane and points along the view direction", () => {
    const ray = orthographic().view.ray(CX, CY);

    // The camera stands at z = 10 with near = 0.1, so its near plane is z = 9.9.
    expect(ray.origin.x).toBeCloseTo(0, 9);
    expect(ray.origin.y).toBeCloseTo(0, 9);
    expect(ray.origin.z).toBeCloseTo(9.9, 9);
    expect(ray.direction.x).toBeCloseTo(0, 12);
    expect(ray.direction.y).toBeCloseTo(0, 12);
    expect(ray.direction.z).toBeCloseTo(-1, 12);
  });

  it("moves the origin with the stage point rather than the direction", () => {
    // Orthographic rays are parallel: a click elsewhere on the stage is the same
    // line direction from a different starting point.
    const { view } = orthographic();
    const centre = view.ray(CX, CY);
    const offset = view.ray(420, 130);

    expect(offset.origin.x).toBeCloseTo(100, 9);
    expect(offset.origin.y).toBeCloseTo(50, 9);
    expect(offset.origin.z).toBeCloseTo(9.9, 9);
    expect(offset.direction.x).toBeCloseTo(centre.direction.x, 12);
    expect(offset.direction.y).toBeCloseTo(centre.direction.y, 12);
    expect(offset.direction.z).toBeCloseTo(centre.direction.z, 12);
  });

  it("returns a unit-length direction under a rotated camera", () => {
    const { camera, view, read } = orthographic();
    camera.position.set(20, 20, 20);
    camera.lookAt(0, 0, 0);
    read();

    const ray = view.ray(CX, CY);
    expect(length(ray.direction)).toBeCloseTo(1, 12);
    // The centre ray of an orthographic camera aimed at the origin passes through
    // it, at the distance from the eye less the near plane.
    const t = Math.hypot(20, 20, 20) - 0.1;
    const hit = along(ray.origin, ray.direction, t);
    expect(hit.x).toBeCloseTo(0, 6);
    expect(hit.y).toBeCloseTo(0, 6);
    expect(hit.z).toBeCloseTo(0, 6);
  });

  it("maps a point inside a letterbox bar outside the camera's extents", () => {
    const ray = orthographic().view.ray(-100, CY);

    expect(ray.origin.x).toBeCloseTo(-420, 9);
    expect(ray.origin.y).toBeCloseTo(0, 9);
  });

  it("is the inverse of project", () => {
    const { view } = orthographic();

    for (const [x, y] of [
      [CX, CY],
      [0, 0],
      [W, H],
      [211, 57],
    ] as const) {
      const ray = view.ray(x, y);
      const round = view.project(along(ray.origin, ray.direction, 3));
      expect(round.x).toBeCloseTo(x, 6);
      expect(round.y).toBeCloseTo(y, 6);
    }
  });
});

describe("a non-16:9 design size", () => {
  it("maps the field the same way at any aspect", () => {
    const { view } = orthographic(400, 400);

    expect(view.project({ x: 0, y: 0, z: 0 }).x).toBeCloseTo(200, 9);
    expect(view.project({ x: 0, y: 0, z: 0 }).y).toBeCloseTo(200, 9);
    // Extents of -200..200 by 200..-200 at a 400 by 400 design size.
    expect(view.project({ x: 100, y: 100, z: 0 }).x).toBeCloseTo(300, 9);
    expect(view.project({ x: 100, y: 100, z: 0 }).y).toBeCloseTo(100, 9);
    expect(view.ray(300, 100).origin.x).toBeCloseTo(100, 9);
    expect(view.ray(300, 100).origin.y).toBeCloseTo(100, 9);
  });

  it("keeps a perspective camera's picture at the design aspect", () => {
    const square = perspective(400, 400);
    const wide = perspective(800, 400);

    // The same world point sits further from the centre, as a fraction of the
    // field, through the narrower camera.
    const inSquare = square.view.project({ x: 2, y: 0, z: 0 }).x / 400;
    const inWide = wide.view.project({ x: 2, y: 0, z: 0 }).x / 800;
    expect(inSquare).toBeGreaterThan(inWide);
  });
});

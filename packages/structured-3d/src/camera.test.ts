import { describe, expect, it } from "vitest";
import {
  WorldCamera,
  box3Corners,
  box3FromPoints,
  box3Union,
  fitViewport,
  pointerRay,
  projectPoint,
  syncCanvas,
  transformBox3,
} from "./camera";
import type { SurfaceMetrics } from "./camera";
import type { Box3, CameraState, Vec3, Viewport } from "./math";
import {
  defaultCameraState,
  quatFromAxisAngle,
  rotateVec3,
  vec3Cross,
  vec3Length,
  vec3Sub,
} from "./math";

/**
 * This suite asserts the projection and viewport math with hand-derived
 * numbers and drives `syncCanvas` over hand-built canvas objects, so it runs
 * with no document at all — exactly the arrangement a validator gets behind a
 * supplied surface. The behaviors that genuinely need a DOM (the default
 * `domSurface`, inline-style pinning on a real element) live in
 * `camera.dom.test.ts` under jsdom. The engine-driven half — the per-frame
 * resync and the camera-component adoption — belongs to the engine suite;
 * here `adopt` is called directly with the plain figures the frame would
 * extract.
 */

/** The tangent of half the default field of view, `tan(π/6)`. */
const TAN_HALF = Math.tan(Math.PI / 6);

/** The bar-less fit of the 800×600 design field at dpr 1. */
function designViewport(): Viewport {
  return { width: 800, height: 600, scale: 1, offsetX: 0, offsetY: 0 };
}

/** The default camera as a plain state, position `(0, 0, 10)` looking down −Z. */
function defaultCamera(): CameraState {
  return defaultCameraState();
}

/** A surface reporting fixed figures, which makes every assertion exact. */
function fixedSurface(
  cssWidth: number,
  cssHeight: number,
  dpr = 1,
): SurfaceMetrics {
  const target = new EventTarget();
  return {
    cssWidth: (): number => cssWidth,
    cssHeight: (): number => cssHeight,
    dpr: (): number => dpr,
    events: (): EventTarget => target,
  };
}

/**
 * A canvas as `syncCanvas` sees one: backing-store attributes, an optional
 * style bag, and counters for the attribute writes, since "written only when
 * it differs" is itself a documented behavior.
 */
function fakeCanvas(
  width: number,
  height: number,
  options: { style?: boolean } = {},
): {
  canvas: HTMLCanvasElement;
  writes: () => number;
  style: { width?: string; height?: string };
} {
  let w = width;
  let h = height;
  let writes = 0;
  const style: { width?: string; height?: string } = {};
  const canvas = {
    get width(): number {
      return w;
    },
    set width(value: number) {
      w = value;
      writes += 1;
    },
    get height(): number {
      return h;
    },
    set height(value: number) {
      h = value;
      writes += 1;
    },
    style: options.style === false ? undefined : style,
  } as unknown as HTMLCanvasElement;
  return { canvas, writes: () => writes, style };
}

/* -------------------------------------------------------------------------- */
/* fitViewport                                                                */
/* -------------------------------------------------------------------------- */

describe("fitViewport", () => {
  it("has no bars at all when the container matches the design aspect", () => {
    const vp = fitViewport(800, 600, 800, 600, 1);
    expect(vp).toEqual({
      width: 800,
      height: 600,
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    });
  });

  it("letterboxes horizontally when the container is wider than the field", () => {
    const vp = fitViewport(800, 600, 1000, 600, 1);
    // Height is the binding axis, so the scale is 1 and the 200 spare CSS
    // pixels become two equal bars.
    expect(vp.scale).toBeCloseTo(1, 6);
    expect(vp.offsetX).toBeCloseTo(100, 6);
    expect(vp.offsetY).toBeCloseTo(0, 6);
  });

  it("letterboxes vertically when the container is taller than the field", () => {
    const vp = fitViewport(800, 600, 800, 900, 1);
    expect(vp.scale).toBeCloseTo(1, 6);
    expect(vp.offsetX).toBeCloseTo(0, 6);
    expect(vp.offsetY).toBeCloseTo(150, 6);
  });

  it("folds the device pixel ratio into the scale rather than beside it", () => {
    const vp = fitViewport(800, 600, 800, 600, 2);
    expect(vp.scale).toBeCloseTo(2, 6);
    expect(vp.offsetX).toBeCloseTo(0, 6);
    expect(vp.offsetY).toBeCloseTo(0, 6);
  });

  it("centers against the rounded device size, so the bars sum to the drawable area exactly", () => {
    // 333 CSS px at dpr 1.5 is 499.5 device px, rounded to a 500-px backing
    // store; the half-pixel remainder splits into two 0.25-px bars with no
    // seam left over.
    const vp = fitViewport(800, 600, 333, 250, 1.5);
    expect(vp.scale).toBeCloseTo(0.624375, 9);
    expect(vp.offsetX).toBeCloseTo(0.25, 9);
    expect(vp.offsetY).toBeCloseTo(0.1875, 9);
    expect(vp.offsetX * 2 + vp.width * vp.scale).toBe(500);
  });

  it("yields a zero scale for a container with no size, and stays finite", () => {
    const vp = fitViewport(800, 600, 0, 600, 1);
    expect(vp.scale).toBe(0);
    expect(Number.isFinite(vp.offsetX)).toBe(true);
    expect(Number.isFinite(vp.offsetY)).toBe(true);
  });

  it("yields a zero scale for a logical size that is not finite and positive", () => {
    expect(fitViewport(Number.NaN, 600, 800, 600, 1).scale).toBe(0);
    expect(fitViewport(800, -600, 800, 600, 1).scale).toBe(0);
    expect(fitViewport(800, Number.POSITIVE_INFINITY, 800, 600, 1).scale).toBe(
      0,
    );
  });

  it("reads a device pixel ratio that is not finite and positive as 1", () => {
    expect(fitViewport(800, 600, 800, 600, 0).scale).toBe(1);
    expect(fitViewport(800, 600, 800, 600, Number.NaN).scale).toBe(1);
    expect(fitViewport(800, 600, 800, 600, -2).scale).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* projectPoint                                                               */
/* -------------------------------------------------------------------------- */

describe("projectPoint", () => {
  it("maps the point on the camera's axis to the center of the logical field", () => {
    const projected = projectPoint(defaultCamera(), designViewport(), {
      x: 0,
      y: 0,
      z: 0,
    });
    expect(projected?.x).toBeCloseTo(400, 6);
    expect(projected?.y).toBeCloseTo(300, 6);
  });

  it("puts the top of the frustum at logical y 0 — the single y flip", () => {
    // At depth 10, the frustum's half-height is 10·tan(fovY/2); a world point
    // that far *up* lands at the *top* of the y-down logical field.
    const projected = projectPoint(defaultCamera(), designViewport(), {
      x: 0,
      y: 10 * TAN_HALF,
      z: 0,
    });
    expect(projected?.x).toBeCloseTo(400, 6);
    expect(projected?.y).toBeCloseTo(0, 6);
  });

  it("scales the horizontal field of view by the design aspect", () => {
    // The half-width is the half-height times width/height, 4/3 here.
    const projected = projectPoint(defaultCamera(), designViewport(), {
      x: 10 * TAN_HALF * (4 / 3),
      y: 0,
      z: 0,
    });
    expect(projected?.x).toBeCloseTo(800, 6);
    expect(projected?.y).toBeCloseTo(300, 6);
  });

  it("projects a world point above the aim to a smaller logical y", () => {
    const projected = projectPoint(defaultCamera(), designViewport(), {
      x: 0,
      y: 2,
      z: 0,
    });
    // ndcY = (2 / 10) / tan(π/6) ≈ 0.34641; logical y = (1 − ndcY)/2 · 600.
    expect(projected?.y).toBeCloseTo(196.0769515, 5);
  });

  it("returns null for a point at or behind the camera plane", () => {
    const camera = defaultCamera();
    const viewport = designViewport();
    // At the plane (z = 10 is the camera's own depth), behind it, and at the
    // camera's exact position.
    expect(projectPoint(camera, viewport, { x: 3, y: -2, z: 10 })).toBeNull();
    expect(projectPoint(camera, viewport, { x: 0, y: 0, z: 15 })).toBeNull();
    expect(projectPoint(camera, viewport, { x: 0, y: 0, z: 10 })).toBeNull();
  });

  it("returns an out-of-frustum point outside 0..width rather than clamping it", () => {
    const projected = projectPoint(defaultCamera(), designViewport(), {
      x: 20 * TAN_HALF * (4 / 3),
      y: 0,
      z: 0,
    });
    // ndcX = 2: one whole field-width past the right edge.
    expect(projected?.x).toBeCloseTo(1200, 5);
  });

  it("reads only the viewport's logical size — the letterbox belongs to the second map", () => {
    const barred: Viewport = {
      width: 800,
      height: 600,
      scale: 2,
      offsetX: 100,
      offsetY: 50,
    };
    const projected = projectPoint(defaultCamera(), barred, {
      x: 0,
      y: 0,
      z: 0,
    });
    expect(projected?.x).toBeCloseTo(400, 6);
    expect(projected?.y).toBeCloseTo(300, 6);
  });

  it("projects through a moved, rotated camera", () => {
    // A camera 5 units up +X, turned π/2 about +Y so its −Z aims at the
    // origin: the origin sits 5 units straight ahead and centers.
    const camera: CameraState = {
      ...defaultCamera(),
      position: { x: 5, y: 0, z: 0 },
      rotation: quatFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 2),
    };
    const projected = projectPoint(camera, designViewport(), {
      x: 0,
      y: 0,
      z: 0,
    });
    expect(projected?.x).toBeCloseTo(400, 6);
    expect(projected?.y).toBeCloseTo(300, 6);
  });
});

/* -------------------------------------------------------------------------- */
/* pointerRay                                                                 */
/* -------------------------------------------------------------------------- */

describe("pointerRay", () => {
  it("sends the ray through the center of the field straight down −Z", () => {
    const ray = pointerRay(defaultCamera(), designViewport(), {
      x: 400,
      y: 300,
    });
    expect(ray.origin).toEqual({ x: 0, y: 0, z: 10 });
    expect(ray.direction.x).toBeCloseTo(0, 9);
    expect(ray.direction.y).toBeCloseTo(0, 9);
    expect(ray.direction.z).toBeCloseTo(-1, 9);
  });

  it("hands back a fresh origin rather than aliasing the camera's position", () => {
    const camera = defaultCamera();
    const ray = pointerRay(camera, designViewport(), { x: 400, y: 300 });
    ray.origin.x = 99;
    expect(camera.position.x).toBe(0);
  });

  it("returns a unit direction for an off-center point", () => {
    const ray = pointerRay(defaultCamera(), designViewport(), { x: 0, y: 0 });
    expect(vec3Length(ray.direction)).toBeCloseTo(1, 9);
    // The top-left corner: left of the axis and, in the y-up world, above it.
    expect(ray.direction.x).toBeLessThan(0);
    expect(ray.direction.y).toBeGreaterThan(0);
  });

  it("still yields a ray for a point inside a letterbox bar", () => {
    // Outside 0..width — the math extends past the field's edge, and calling
    // it a miss is the game's choice.
    const ray = pointerRay(defaultCamera(), designViewport(), {
      x: -50,
      y: 300,
    });
    expect(vec3Length(ray.direction)).toBeCloseTo(1, 9);
    expect(ray.direction.x).toBeLessThan(0);
  });

  it("passes back through the point projectPoint projected", () => {
    const camera = defaultCamera();
    const viewport = designViewport();
    const point: Vec3 = { x: 1.5, y: -2.25, z: -4 };

    const logical = projectPoint(camera, viewport, point);
    expect(logical).not.toBeNull();
    const ray = pointerRay(
      camera,
      viewport,
      logical as { x: number; y: number },
    );

    // Collinear with the ray, and in front of it: the cross of the offset and
    // the direction vanishes and their dot is positive.
    const offset = vec3Sub(point, ray.origin);
    expect(vec3Length(vec3Cross(offset, ray.direction))).toBeCloseTo(0, 6);
    expect(
      offset.x * ray.direction.x +
        offset.y * ray.direction.y +
        offset.z * ray.direction.z,
    ).toBeGreaterThan(0);
  });

  it("round-trips under a moved, rotated camera too", () => {
    const camera: CameraState = {
      ...defaultCamera(),
      position: { x: 2, y: -1, z: 8 },
      rotation: quatFromAxisAngle({ x: 0, y: 1, z: 0 }, 0.3),
    };
    const viewport = designViewport();
    const point: Vec3 = { x: 1, y: 0, z: 0 };

    const logical = projectPoint(camera, viewport, point);
    expect(logical).not.toBeNull();
    const ray = pointerRay(
      camera,
      viewport,
      logical as { x: number; y: number },
    );

    const offset = vec3Sub(point, ray.origin);
    expect(vec3Length(vec3Cross(offset, ray.direction))).toBeCloseTo(0, 6);
  });
});

/* -------------------------------------------------------------------------- */
/* syncCanvas                                                                 */
/* -------------------------------------------------------------------------- */

describe("syncCanvas", () => {
  it("writes the backing store at the rounded device size", () => {
    const { canvas } = fakeCanvas(1, 1);
    syncCanvas(canvas, 800, 600, fixedSurface(300, 200, 1.5));
    expect(canvas.width).toBe(450);
    expect(canvas.height).toBe(300);
  });

  it("returns the same fit fitViewport computes from the surface's figures", () => {
    const { canvas } = fakeCanvas(1, 1);
    const vp = syncCanvas(canvas, 800, 600, fixedSurface(1000, 600, 2));
    expect(vp).toEqual(fitViewport(800, 600, 1000, 600, 2));
  });

  it("writes the backing store only when it actually changed", () => {
    const { canvas, writes } = fakeCanvas(1, 1);
    const surface = fixedSurface(400, 300);
    syncCanvas(canvas, 800, 600, surface);
    const after = writes();
    syncCanvas(canvas, 800, 600, surface);
    // Assigning `canvas.width` reallocates and clears even when unchanged, so
    // a second identical frame must not touch it.
    expect(writes()).toBe(after);
  });

  it("keeps the last backing store when the surface reports no size, and returns a zero scale", () => {
    const { canvas, writes } = fakeCanvas(640, 480);
    const vp = syncCanvas(canvas, 800, 600, fixedSurface(0, 0));
    expect(vp.scale).toBe(0);
    expect(canvas.width).toBe(640);
    expect(canvas.height).toBe(480);
    expect(writes()).toBe(0);
  });

  it("pins a pixel CSS size while the reported size matches the attribute-implied size", () => {
    // Attributes 800×600, reported CSS 800×600: the page expressed no size,
    // and without the pin the dpr-2 backing store would feed back into the
    // next measurement and the canvas would double every frame.
    const { canvas, style } = fakeCanvas(800, 600);
    syncCanvas(canvas, 800, 600, fixedSurface(800, 600, 2));
    expect(canvas.width).toBe(1600);
    expect(style.width).toBe("800px");
    expect(style.height).toBe("600px");
  });

  it("writes the backing store alone when the page sized the element", () => {
    // Reported 400×300 against attributes 800×600: a stylesheet is in charge,
    // and pinning would freeze the canvas at its first measured size.
    const { canvas, style } = fakeCanvas(800, 600);
    syncCanvas(canvas, 800, 600, fixedSurface(400, 300, 1));
    expect(canvas.width).toBe(400);
    expect(style.width).toBeUndefined();
    expect(style.height).toBeUndefined();
  });

  it("drives a canvas that exposes no style at all without touching one", () => {
    const { canvas } = fakeCanvas(800, 600, { style: false });
    const vp = syncCanvas(canvas, 800, 600, fixedSurface(800, 600, 2));
    expect(canvas.width).toBe(1600);
    expect(vp.scale).toBe(2);
  });
});

/* -------------------------------------------------------------------------- */
/* WorldCamera                                                                */
/* -------------------------------------------------------------------------- */

describe("WorldCamera", () => {
  /** A camera over the fixed design fit, the arrangement a validator gets. */
  function makeCamera(): WorldCamera<{ name: string }> {
    return new WorldCamera(() => designViewport());
  }

  it("starts at the documented defaults, so a fresh world needs no camera code", () => {
    const camera = makeCamera();
    expect(camera.snapshot()).toEqual(defaultCameraState());
    expect(camera.target).toBeNull();
  });

  it("sets and clears the follow target", () => {
    const camera = makeCamera();
    const actor = { name: "rover" };
    camera.follow(actor);
    expect(camera.target).toBe(actor);
    camera.follow(null);
    expect(camera.target).toBeNull();
  });

  it("adopt takes the plain figures the frame extracted, leaving near and far as set", () => {
    const camera = makeCamera();
    camera.near = 0.5;
    camera.far = 200;
    const position: Vec3 = { x: 1, y: 2, z: 3 };
    const rotation = quatFromAxisAngle({ x: 0, y: 1, z: 0 }, 0.4);
    camera.adopt(position, rotation, 1.2);

    expect(camera.position).toEqual({ x: 1, y: 2, z: 3 });
    expect(camera.fovY).toBe(1.2);
    expect(camera.near).toBe(0.5);
    expect(camera.far).toBe(200);

    // Fresh copies: a component mutating its own transform later must not
    // reach through into the camera.
    position.x = 99;
    expect(camera.position.x).toBe(1);
  });

  it("snapshot keeps the values of the moment it was read", () => {
    const camera = makeCamera();
    const before = camera.snapshot();
    camera.position.x = 42;
    camera.fovY = 1;
    expect(before.position.x).toBe(0);
    expect(before.fovY).toBe(Math.PI / 3);

    // And the other direction: writing into a snapshot moves nothing.
    before.position.y = -7;
    expect(camera.position.y).toBe(0);
  });

  it("lookAt at a point straight down the current −Z leaves an identity rotation", () => {
    const camera = makeCamera();
    camera.lookAt({ x: 0, y: 0, z: 0 });
    expect(camera.rotation.x).toBeCloseTo(0, 9);
    expect(camera.rotation.y).toBeCloseTo(0, 9);
    expect(camera.rotation.z).toBeCloseTo(0, 9);
    expect(camera.rotation.w).toBeCloseTo(1, 9);
  });

  it("lookAt aims −Z at the point: a target on +X turns the camera −π/2 about +Y", () => {
    const camera = makeCamera();
    camera.position = { x: 0, y: 0, z: 0 };
    camera.lookAt({ x: 5, y: 0, z: 0 });
    const expected = quatFromAxisAngle({ x: 0, y: 1, z: 0 }, -Math.PI / 2);
    expect(camera.rotation.x).toBeCloseTo(expected.x, 9);
    expect(camera.rotation.y).toBeCloseTo(expected.y, 9);
    expect(camera.rotation.z).toBeCloseTo(expected.z, 9);
    expect(camera.rotation.w).toBeCloseTo(expected.w, 9);
  });

  it("lookAt holds +Y as close to the world's +Y as the aim allows", () => {
    const camera = makeCamera();
    camera.position = { x: 0, y: 0, z: 0 };
    camera.lookAt({ x: 0, y: -1, z: -1 });
    // Aiming 45° downward tilts the camera's up 45° forward: the closest a
    // perpendicular can get to world +Y.
    const up = rotateVec3(camera.rotation, { x: 0, y: 1, z: 0 });
    expect(up.x).toBeCloseTo(0, 9);
    expect(up.y).toBeCloseTo(Math.SQRT1_2, 9);
    expect(up.z).toBeCloseTo(-Math.SQRT1_2, 9);
  });

  it("lookAt straight up or down holds +Z as up instead", () => {
    const camera = makeCamera();
    camera.position = { x: 0, y: 0, z: 0 };

    camera.lookAt({ x: 0, y: 5, z: 0 });
    const aimUp = rotateVec3(camera.rotation, { x: 0, y: 0, z: -1 });
    const upWhenUp = rotateVec3(camera.rotation, { x: 0, y: 1, z: 0 });
    expect(aimUp.y).toBeCloseTo(1, 9);
    expect(upWhenUp.z).toBeCloseTo(1, 9);

    camera.lookAt({ x: 0, y: -5, z: 0 });
    const aimDown = rotateVec3(camera.rotation, { x: 0, y: 0, z: -1 });
    const upWhenDown = rotateVec3(camera.rotation, { x: 0, y: 1, z: 0 });
    expect(aimDown.y).toBeCloseTo(-1, 9);
    expect(upWhenDown.z).toBeCloseTo(1, 9);
  });

  it("lookAt with the point equal to the position leaves the rotation unchanged", () => {
    const camera = makeCamera();
    const spun = quatFromAxisAngle({ x: 1, y: 0, z: 0 }, 0.7);
    camera.rotation = spun;
    camera.lookAt({ x: 0, y: 0, z: 10 });
    expect(camera.rotation).toBe(spun);
  });

  it("project composes projectPoint with the current fit, and answers null behind", () => {
    const camera = makeCamera();
    const projected = camera.project({ x: 0, y: 0, z: 0 });
    expect(projected?.x).toBeCloseTo(400, 6);
    expect(projected?.y).toBeCloseTo(300, 6);
    expect(camera.project({ x: 0, y: 0, z: 20 })).toBeNull();
  });

  it("ray composes pointerRay with the current fit", () => {
    const camera = makeCamera();
    const ray = camera.ray({ x: 400, y: 300 });
    expect(ray.origin).toEqual({ x: 0, y: 0, z: 10 });
    expect(ray.direction.z).toBeCloseTo(-1, 9);
  });

  it("reads the fit fresh on every projection rather than holding one", () => {
    let viewport = designViewport();
    const camera = new WorldCamera(() => viewport);
    expect(camera.project({ x: 0, y: 0, z: 0 })?.x).toBeCloseTo(400, 6);

    // The surface resized between frames; the same call now centers on the
    // new field with no resync step in between.
    viewport = { width: 400, height: 300, scale: 1, offsetX: 0, offsetY: 0 };
    expect(camera.project({ x: 0, y: 0, z: 0 })?.x).toBeCloseTo(200, 6);
  });
});

/* -------------------------------------------------------------------------- */
/* Box3 helpers                                                               */
/* -------------------------------------------------------------------------- */

describe("the Box3 helpers", () => {
  const unit: Box3 = {
    min: { x: -1, y: -1, z: -1 },
    max: { x: 1, y: 1, z: 1 },
  };

  it("box3Corners lists all eight corners, min first and max last", () => {
    const corners = box3Corners({
      min: { x: 0, y: 0, z: 0 },
      max: { x: 1, y: 2, z: 3 },
    });
    expect(corners).toHaveLength(8);
    expect(corners[0]).toEqual({ x: 0, y: 0, z: 0 });
    expect(corners[7]).toEqual({ x: 1, y: 2, z: 3 });
  });

  it("box3FromPoints is the tightest box around the points", () => {
    const box = box3FromPoints([
      { x: 1, y: 2, z: 3 },
      { x: -1, y: 5, z: 0 },
      { x: 0, y: -2, z: 7 },
    ]);
    expect(box).toEqual({
      min: { x: -1, y: -2, z: 0 },
      max: { x: 1, y: 5, z: 7 },
    });
  });

  it("box3FromPoints refuses an empty list rather than inventing a box", () => {
    expect(() => box3FromPoints([])).toThrow(RangeError);
    expect(() => box3FromPoints([])).toThrow(/at least one point/);
  });

  it("box3Union is the tightest box containing both", () => {
    const a: Box3 = { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } };
    const b: Box3 = { min: { x: -2, y: 0.5, z: 0 }, max: { x: 0, y: 3, z: 1 } };
    expect(box3Union(a, b)).toEqual({
      min: { x: -2, y: 0, z: 0 },
      max: { x: 1, y: 3, z: 1 },
    });
  });

  it("transformBox3 carries the box through translation and scale", () => {
    const moved = transformBox3(
      {
        position: { x: 5, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 2, y: 1, z: 1 },
      },
      unit,
    );
    expect(moved.min.x).toBeCloseTo(3, 9);
    expect(moved.max.x).toBeCloseTo(7, 9);
    expect(moved.min.y).toBeCloseTo(-1, 9);
    expect(moved.max.y).toBeCloseTo(1, 9);
  });

  it("transformBox3 under a rotation is the corners' axis-aligned bound, wider than the shape", () => {
    const spun = transformBox3(
      {
        position: { x: 0, y: 0, z: 0 },
        rotation: quatFromAxisAngle({ x: 0, y: 0, z: 1 }, Math.PI / 4),
        scale: { x: 1, y: 1, z: 1 },
      },
      unit,
    );
    // The unit box's xy corners swing out to √2 under a 45° turn about z.
    expect(spun.min.x).toBeCloseTo(-Math.SQRT2, 9);
    expect(spun.max.x).toBeCloseTo(Math.SQRT2, 9);
    expect(spun.min.z).toBeCloseTo(-1, 9);
    expect(spun.max.z).toBeCloseTo(1, 9);
  });

  it("transformBox3 applies scale before rotation — the TRS order", () => {
    const box = transformBox3(
      {
        position: { x: 0, y: 0, z: 0 },
        rotation: quatFromAxisAngle({ x: 0, y: 0, z: 1 }, Math.PI / 2),
        scale: { x: 2, y: 1, z: 1 },
      },
      unit,
    );
    // The doubled x extent turns onto the y axis; rotation-then-scale would
    // leave it on x instead.
    expect(box.min.y).toBeCloseTo(-2, 9);
    expect(box.max.y).toBeCloseTo(2, 9);
    expect(box.min.x).toBeCloseTo(-1, 9);
    expect(box.max.x).toBeCloseTo(1, 9);
  });
});

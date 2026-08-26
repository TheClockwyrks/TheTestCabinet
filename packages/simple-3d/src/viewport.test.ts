import { describe, expect, it } from "vitest";
import type {
  CameraState,
  FitViewport,
  PointerRay,
  ProjectPoint,
  Ray,
  SyncCanvas,
  Vec3,
  Viewport,
} from "./math";
import {
  defaultCameraState,
  quatFromAxisAngle,
  rotateVec3,
  vec3Add,
  vec3Length,
  vec3Normalize,
  vec3Sub,
} from "./math";
import type { SurfaceMetrics } from "./viewport";
import { fitViewport, pointerRay, projectPoint, syncCanvas } from "./viewport";

/**
 * The fit arithmetic and the projection pair, asserted against hand-derived
 * figures under the node environment the validator docs prescribe — no DOM
 * anywhere here. The behaviors that genuinely need a document (the default
 * surface's measurements and the CSS-size pinning matrix) live in
 * `viewport.dom.test.ts` under jsdom, and everything the engine wires around
 * these functions (per-frame resync, the pointer's inverse map) belongs to the
 * engine and input suites.
 *
 * Every expected number below is derived in a comment from the documented
 * equations rather than read back from the implementation, so a regression in
 * the math shows up as a wrong number, not as a test agreeing with itself.
 */

/**
 * A surface reporting fixed figures, which is what the engine is handed by a
 * validator and what makes every assertion below exact rather than dependent
 * on the machine the suite runs on.
 */
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
 * A canvas that is nothing but a backing store — the shape a headless canvas
 * driven behind a supplied surface presents. Deliberately not an element: it
 * has no `style`, no layout, and no document, which is exactly the arrangement
 * `syncCanvas` must survive.
 */
function bareCanvas(width = 0, height = 0): HTMLCanvasElement {
  return { width, height } as unknown as HTMLCanvasElement;
}

/** The design viewport most projection tests share: 800×600 at scale 1. */
function designViewport(): Viewport {
  return fitViewport(800, 600, 800, 600, 1);
}

/** A camera built from the default, with the named fields replaced. */
function cameraWith(overrides: Partial<CameraState>): CameraState {
  return { ...defaultCameraState(), ...overrides };
}

// tan(fovY / 2) for the default fovY of π/3 — the vertical half-extent of the
// frustum at unit distance. tan(π/6) = 1/√3.
const TAN_HALF = Math.tan(Math.PI / 6);

describe("fitViewport", () => {
  it("letterboxes horizontally when the container is wider than the logical field", () => {
    const vp = fitViewport(800, 600, 1000, 600, 1);

    // Height is the binding axis, so the scale is 1 and the 200 spare CSS
    // pixels become two equal bars.
    expect(vp.scale).toBeCloseTo(1, 6);
    expect(vp.offsetX).toBeCloseTo(100, 6);
    expect(vp.offsetY).toBeCloseTo(0, 6);
    expect(vp.width).toBe(800);
    expect(vp.height).toBe(600);
  });

  it("letterboxes vertically when the container is taller than the logical field", () => {
    const vp = fitViewport(800, 600, 800, 900, 1);

    expect(vp.scale).toBeCloseTo(1, 6);
    expect(vp.offsetX).toBeCloseTo(0, 6);
    expect(vp.offsetY).toBeCloseTo(150, 6);
  });

  it("has no bars at all when the container matches the logical aspect ratio", () => {
    const vp = fitViewport(800, 600, 1600, 1200, 1);

    expect(vp.scale).toBeCloseTo(2, 6);
    expect(vp.offsetX).toBe(0);
    expect(vp.offsetY).toBe(0);
  });

  it("fits at a non-integer scale rather than rounding to a whole one", () => {
    const vp = fitViewport(800, 600, 500, 500, 1);

    // Width binds: 500/800 = 0.625, which leaves 500 - 375 = 125 vertical
    // pixels split into two bars of 62.5. Rounding the scale to 1 would clip
    // the field; rounding it to 0 would draw nothing.
    expect(vp.scale).toBeCloseTo(0.625, 12);
    expect(vp.offsetX).toBeCloseTo(0, 12);
    expect(vp.offsetY).toBeCloseTo(62.5, 12);
  });

  it("folds a device pixel ratio above 1 into the scale and the bars", () => {
    const vp = fitViewport(800, 600, 1000, 600, 2);

    // The fit ratio is still 1, but a logical unit is now two device pixels,
    // and the bars are measured in the same device pixels.
    expect(vp.scale).toBeCloseTo(2, 6);
    expect(vp.offsetX).toBeCloseTo(200, 6);
    expect(vp.offsetY).toBeCloseTo(0, 6);
  });

  it("folds a fractional device pixel ratio in without leaving a seam", () => {
    const vp = fitViewport(800, 600, 500, 500, 1.5);

    expect(vp.scale).toBeCloseTo(0.9375, 12);
    // The bars are centred against the rounded device size the backing store
    // is written at, so they sum to it exactly rather than to the unrounded
    // product.
    const deviceH = Math.round(500 * 1.5);
    expect(vp.offsetY * 2 + vp.height * vp.scale).toBeCloseTo(deviceH, 9);
  });

  it("keeps the whole logical field inside the container on both axes", () => {
    for (const [cssW, cssH] of [
      [1000, 600],
      [800, 900],
      [321, 977],
      [1920, 1080],
    ] as const) {
      const vp = fitViewport(800, 600, cssW, cssH, 1);
      expect(vp.width * vp.scale).toBeLessThanOrEqual(cssW + 1e-9);
      expect(vp.height * vp.scale).toBeLessThanOrEqual(cssH + 1e-9);
      expect(vp.offsetX).toBeGreaterThanOrEqual(-1e-9);
      expect(vp.offsetY).toBeGreaterThanOrEqual(-1e-9);
    }
  });

  it("yields a finite, zero-scale viewport for a container with no size", () => {
    const vp = fitViewport(800, 600, 0, 0, 1);

    expect(vp.scale).toBe(0);
    expect(vp.offsetX).toBe(0);
    expect(vp.offsetY).toBe(0);
  });

  it("stays finite for a degenerate logical size or device pixel ratio", () => {
    for (const vp of [
      fitViewport(0, 0, 800, 600, 1),
      fitViewport(800, 600, 800, 600, 0),
      fitViewport(800, 600, 800, 600, Number.NaN),
      fitViewport(800, 600, 800, 600, Number.POSITIVE_INFINITY),
      fitViewport(Number.NaN, 600, 800, 600, 1),
      fitViewport(-800, 600, 800, 600, 1),
      fitViewport(800, 600, Number.POSITIVE_INFINITY, 600, 1),
    ]) {
      for (const n of [vp.scale, vp.offsetX, vp.offsetY, vp.width, vp.height]) {
        expect(Number.isFinite(n)).toBe(true);
      }
    }

    // A bad ratio falls back to 1 rather than collapsing an otherwise valid
    // fit — the documented "read as 1" rule.
    expect(fitViewport(800, 600, 800, 600, 0).scale).toBeCloseTo(1, 6);
  });
});

describe("the logical-to-device mapping", () => {
  // The arithmetic a validator repeats to name the device pixel a logical
  // point drew into: `offsetX + x * scale`. There is no applyViewport and no
  // transform to interrogate — the two equations ARE the observable contract,
  // so they are asserted here directly.
  const map = (vp: Viewport) => ({
    x: (logical: number): number => vp.offsetX + logical * vp.scale,
    y: (logical: number): number => vp.offsetY + logical * vp.scale,
  });

  it("puts the logical origin at the top-left corner of the letterboxed field", () => {
    const vp = fitViewport(800, 600, 1000, 600, 2);
    const at = map(vp);

    expect(at.x(0)).toBeCloseTo(200, 9);
    expect(at.y(0)).toBeCloseTo(0, 9);
  });

  it("puts the far corner exactly on the far edge of the field", () => {
    const vp = fitViewport(800, 600, 1000, 600, 2);
    const at = map(vp);

    // 1000 CSS px at a ratio of 2 is 2000 device px; the field ends 200 short.
    expect(at.x(800)).toBeCloseTo(1800, 9);
    expect(at.y(600)).toBeCloseTo(1200, 9);
  });

  it("round-trips a device point back through the inverse map", () => {
    const vp = fitViewport(800, 600, 1000, 600, 2);
    const at = map(vp);

    for (const logical of [0, 1, 123.5, 799]) {
      expect((at.x(logical) - vp.offsetX) / vp.scale).toBeCloseTo(logical, 9);
    }
  });

  it("names the device pixel a world point drew into, composed with projectPoint", () => {
    // The validator's own two-stage route: projectPoint into logical
    // coordinates, then the first pair of viewport equations. The world origin
    // seen by the default camera projects to the logical centre (400, 300);
    // at dpr 2 in a 1000×600 container the fit is scale 2 with a 200-pixel
    // left bar, so the centre lands on device pixel (200 + 800, 600).
    const vp = fitViewport(800, 600, 1000, 600, 2);
    const logical = projectPoint(defaultCameraState(), vp, {
      x: 0,
      y: 0,
      z: 0,
    });

    expect(logical).not.toBeNull();
    const at = map(vp);
    expect(at.x(logical!.x)).toBeCloseTo(1000, 9);
    expect(at.y(logical!.y)).toBeCloseTo(600, 9);
  });
});

describe("syncCanvas", () => {
  it("takes its size and ratio from the surface, never from the element", () => {
    const canvas = bareCanvas(1, 1);

    const vp = syncCanvas(canvas, 800, 600, fixedSurface(400, 300, 3));

    // The element claimed 1×1; the surface's 400×300 at ratio 3 wins.
    expect(canvas.width).toBe(1200);
    expect(canvas.height).toBe(900);
    // 400 CSS px across 800 logical units, tripled into device pixels.
    expect(vp.scale).toBeCloseTo(1.5, 9);
    expect(vp.offsetX).toBeCloseTo(0, 9);
  });

  it("writes the backing store only when it actually changed", () => {
    const surface = fixedSurface(400, 300, 2);
    let stored = 0;
    let writes = 0;
    const canvas = {
      height: 0,
      get width(): number {
        return stored;
      },
      set width(value: number) {
        writes += 1;
        stored = value;
      },
    } as unknown as HTMLCanvasElement;

    syncCanvas(canvas, 800, 600, surface);
    syncCanvas(canvas, 800, 600, surface);
    syncCanvas(canvas, 800, 600, surface);

    // Assigning canvas.width reallocates and clears even when unchanged, so
    // three frames must cost exactly one write.
    expect(stored).toBe(800);
    expect(writes).toBe(1);
  });

  it("keeps the last backing store when the surface reports no size", () => {
    const canvas = bareCanvas();
    syncCanvas(canvas, 800, 600, fixedSurface(400, 300, 1));

    const vp = syncCanvas(canvas, 800, 600, fixedSurface(0, 0, 1));

    // The hidden frame draws nothing, but the previously rendered surface
    // survives on screen.
    expect(canvas.width).toBe(400);
    expect(canvas.height).toBe(300);
    expect(vp.scale).toBe(0);
  });

  it("keeps the last backing store when only one axis collapses", () => {
    const canvas = bareCanvas();
    syncCanvas(canvas, 800, 600, fixedSurface(400, 300, 1));

    const vp = syncCanvas(canvas, 800, 600, fixedSurface(400, 0, 1));

    expect(canvas.width).toBe(400);
    expect(canvas.height).toBe(300);
    expect(vp.scale).toBe(0);
  });

  it("recovers the fit as soon as the surface has a size again", () => {
    const canvas = bareCanvas();
    syncCanvas(canvas, 800, 600, fixedSurface(0, 0, 1));

    const vp = syncCanvas(canvas, 800, 600, fixedSurface(400, 300, 1));

    expect(canvas.width).toBe(400);
    expect(vp.scale).toBeCloseTo(0.5, 9);
  });

  it("sizes a canvas that exposes no style at all, without touching one", () => {
    // A headless canvas behind a supplied surface has no layout to feed back
    // into, so there is nothing to pin and nothing to throw on.
    const canvas = bareCanvas(400, 300);

    const vp = syncCanvas(canvas, 800, 600, fixedSurface(400, 300, 2));

    expect(canvas.width).toBe(800);
    expect(canvas.height).toBe(600);
    expect(vp.scale).toBeCloseTo(1, 9);
  });
});

describe("projectPoint", () => {
  it("projects a point on the view axis to the centre of the logical field", () => {
    // The default camera sits at (0, 0, 10) looking down −Z; the world origin
    // is dead ahead, so both NDC coordinates are 0 and the logical point is
    // the half design size.
    const at = projectPoint(defaultCameraState(), designViewport(), {
      x: 0,
      y: 0,
      z: 0,
    });

    expect(at).not.toBeNull();
    expect(at!.x).toBeCloseTo(400, 9);
    expect(at!.y).toBeCloseTo(300, 9);
  });

  it("puts the frustum's right edge exactly on logical x = width", () => {
    // At depth 10 the horizontal half-extent is 10 · tan(π/6) · (800/600):
    // 10 · (1/√3) · (4/3) = 40√3/9 ≈ 7.698003589. A point there has ndcX = 1,
    // which the mapping (ndcX + 1)/2 · width sends to 800.
    const edge = 10 * TAN_HALF * (800 / 600);
    const at = projectPoint(defaultCameraState(), designViewport(), {
      x: edge,
      y: 0,
      z: 0,
    });

    expect(at!.x).toBeCloseTo(800, 9);
    expect(at!.y).toBeCloseTo(300, 9);
  });

  it("maps world +Y up to logical y down: above the axis lands nearer the top", () => {
    // At depth 10 the vertical half-extent is 10 · tan(π/6) = 10/√3
    // ≈ 5.773502692. World +Y is up, the logical field's y grows down, so the
    // top of the frustum is logical y = 0 and the bottom is y = height.
    const top = projectPoint(defaultCameraState(), designViewport(), {
      x: 0,
      y: 10 * TAN_HALF,
      z: 0,
    });
    const bottom = projectPoint(defaultCameraState(), designViewport(), {
      x: 0,
      y: -10 * TAN_HALF,
      z: 0,
    });

    expect(top!.y).toBeCloseTo(0, 9);
    expect(bottom!.y).toBeCloseTo(600, 9);
    expect(top!.x).toBeCloseTo(400, 9);
  });

  it("returns null for a point at or behind the camera plane", () => {
    const camera = defaultCameraState();
    const vp = designViewport();

    // On the plane: same z as the camera, wherever it sits laterally.
    expect(projectPoint(camera, vp, { x: 5, y: -3, z: 10 })).toBeNull();
    // Behind it.
    expect(projectPoint(camera, vp, { x: 0, y: 0, z: 11 })).toBeNull();
    expect(projectPoint(camera, vp, { x: 0, y: 0, z: 1000 })).toBeNull();
  });

  it("returns an out-of-frustum point as-is, outside the logical range", () => {
    // Twice the right edge means ndcX = 2, and (2 + 1)/2 · 800 = 1200 — the
    // caller can tell "off screen to the right" from "behind me".
    const edge = 10 * TAN_HALF * (800 / 600);
    const at = projectPoint(defaultCameraState(), designViewport(), {
      x: 2 * edge,
      y: 0,
      z: 0,
    });

    expect(at!.x).toBeCloseTo(1200, 9);
    expect(at!.y).toBeCloseTo(300, 9);
  });

  it("projects through the camera's rotation, not just its position", () => {
    // A camera at the origin rotated +90° about +Y looks down world −X, so a
    // point five units down −X is dead ahead and projects to the centre.
    const camera = cameraWith({
      position: { x: 0, y: 0, z: 0 },
      rotation: quatFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 2),
    });

    const at = projectPoint(camera, designViewport(), { x: -5, y: 0, z: 0 });

    expect(at).not.toBeNull();
    expect(at!.x).toBeCloseTo(400, 9);
    expect(at!.y).toBeCloseTo(300, 9);

    // And what sat dead ahead of an unrotated camera is now behind the plane.
    expect(
      projectPoint(camera, designViewport(), { x: 5, y: 0, z: 0 }),
    ).toBeNull();
  });

  it("uses the design aspect, so the same camera projects identically on every canvas", () => {
    // The frustum's aspect is width/height of the design size, never the
    // canvas's: two fits of the same 800×600 field into wildly different
    // containers must hand back the same logical coordinates.
    const camera = defaultCameraState();
    const point: Vec3 = { x: 2.5, y: -1.25, z: 3 };

    const wide = projectPoint(
      camera,
      fitViewport(800, 600, 1920, 600, 1),
      point,
    );
    const dense = projectPoint(
      camera,
      fitViewport(800, 600, 400, 300, 2.5),
      point,
    );

    expect(wide).toEqual(dense);
  });

  it("reads its arguments without mutating them and returns a fresh value", () => {
    const camera = defaultCameraState();
    const point: Vec3 = { x: 1, y: 2, z: 3 };
    const vp = designViewport();
    const before = JSON.stringify({ camera, point, vp });

    const first = projectPoint(camera, vp, point);
    const second = projectPoint(camera, vp, point);

    expect(JSON.stringify({ camera, point, vp })).toBe(before);
    // Fresh values: equal figures, distinct objects the caller owns.
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
  });
});

describe("pointerRay", () => {
  it("sends the centre of the field straight down the camera's view axis", () => {
    const ray = pointerRay(defaultCameraState(), designViewport(), {
      x: 400,
      y: 300,
    });

    expect(ray.origin).toEqual({ x: 0, y: 0, z: 10 });
    expect(ray.direction.x).toBeCloseTo(0, 9);
    expect(ray.direction.y).toBeCloseTo(0, 9);
    expect(ray.direction.z).toBeCloseTo(-1, 9);
  });

  it("aims the top-left corner up and to the left, at unit length", () => {
    // The corner (0, 0) is NDC (−1, 1), so the unnormalized view-space
    // direction is (−tan(π/6)·4/3, tan(π/6), −1). Its squared components are
    // 16/27, 9/27, and 27/27, summing to 52/27 — so the unit direction is
    // (−2/√13, 3/(2√13), −3√3/(2√13)) ≈ (−0.554700196, 0.416025147,
    // −0.720576692). The corner is up-left because world +Y is up while
    // logical y grows down.
    const ray = pointerRay(defaultCameraState(), designViewport(), {
      x: 0,
      y: 0,
    });

    expect(ray.direction.x).toBeCloseTo(-2 / Math.sqrt(13), 9);
    expect(ray.direction.y).toBeCloseTo(3 / (2 * Math.sqrt(13)), 9);
    expect(ray.direction.z).toBeCloseTo(
      (-3 * Math.sqrt(3)) / (2 * Math.sqrt(13)),
      9,
    );
    expect(vec3Length(ray.direction)).toBeCloseTo(1, 12);
  });

  it("rotates the ray with the camera", () => {
    // The +90°-about-+Y camera looks down world −X; the field's centre must
    // follow it there.
    const camera = cameraWith({
      position: { x: 0, y: 0, z: 0 },
      rotation: quatFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 2),
    });

    const ray = pointerRay(camera, designViewport(), { x: 400, y: 300 });

    expect(ray.direction.x).toBeCloseTo(-1, 9);
    expect(ray.direction.y).toBeCloseTo(0, 9);
    expect(ray.direction.z).toBeCloseTo(0, 9);
  });

  it("still yields a unit ray for a point inside a letterbox bar", () => {
    // A bar point sits outside 0..width / 0..height; the math extends past the
    // field's edge, and treating it as a miss is the game's choice.
    const camera = defaultCameraState();
    const vp = designViewport();

    for (const point of [
      { x: -100, y: 300 },
      { x: 900, y: 700 },
      { x: -5, y: -5 },
    ]) {
      const ray = pointerRay(camera, vp, point);
      expect(vec3Length(ray.direction)).toBeCloseTo(1, 9);
      for (const n of [ray.direction.x, ray.direction.y, ray.direction.z]) {
        expect(Number.isFinite(n)).toBe(true);
      }
    }
  });

  it("depends on the logical design size alone, not on the device fit", () => {
    // Scale, offsets, and dpr belong to the device map; the ray is world math
    // over logical coordinates, so two fits of the same design size agree.
    const camera = defaultCameraState();
    const point = { x: 137, y: 42 };

    const a = pointerRay(camera, fitViewport(800, 600, 1000, 600, 1), point);
    const b = pointerRay(camera, fitViewport(800, 600, 400, 300, 2), point);

    expect(a).toEqual(b);
  });

  it("does not change with the camera's near plane, which cancels out of the direction", () => {
    const vp = designViewport();
    const point = { x: 123, y: 456 };

    const near = pointerRay(cameraWith({ near: 0.001 }), vp, point);
    const far = pointerRay(cameraWith({ near: 5 }), vp, point);

    expect(near).toEqual(far);
  });

  it("hands back a fresh origin the caller owns, not the camera's own position", () => {
    const camera = defaultCameraState();
    const ray = pointerRay(camera, designViewport(), { x: 400, y: 300 });

    ray.origin.x = 999;

    expect(camera.position.x).toBe(0);
  });

  it("passes back through a projected point, wherever the camera sits and looks", () => {
    // The documented round trip: for p in front of the camera,
    // pointerRay(c, v, projectPoint(c, v, p)) passes through p. Points are
    // built in view space with a negative z so each is in front by
    // construction, then carried into the world by the camera's own frame.
    const camera = cameraWith({
      position: { x: 3, y: -2, z: 5 },
      rotation: quatFromAxisAngle({ x: 1, y: 2, z: -1 }, 0.7),
    });
    const vp = designViewport();

    for (const viewPoint of [
      { x: 0, y: 0, z: -1 },
      { x: 0.5, y: -0.3, z: -4 },
      { x: -1, y: 2, z: -10 },
    ]) {
      const p = vec3Add(
        camera.position,
        rotateVec3(camera.rotation, viewPoint),
      );
      const logical = projectPoint(camera, vp, p);
      expect(logical).not.toBeNull();

      const ray: Ray = pointerRay(camera, vp, logical!);
      const toPoint = vec3Normalize(vec3Sub(p, ray.origin));

      // Same direction, not merely the same line: the point is ahead of the
      // origin, so the unit vectors agree componentwise.
      expect(toPoint.x).toBeCloseTo(ray.direction.x, 9);
      expect(toPoint.y).toBeCloseTo(ray.direction.y, 9);
      expect(toPoint.z).toBeCloseTo(ray.direction.z, 9);
    }
  });
});

describe("the shared vocabulary's function types", () => {
  it("is satisfied by these implementations, so both engines' copies stay assignable", () => {
    // math.ts declares the signatures once; a drift here is a compile error
    // before it is a test failure. The assertions exist so the bindings are
    // used rather than elided.
    const fit: FitViewport = fitViewport;
    const sync: SyncCanvas<SurfaceMetrics> = syncCanvas;
    const project: ProjectPoint = projectPoint;
    const ray: PointerRay = pointerRay;

    expect(fit).toBe(fitViewport);
    expect(sync).toBe(syncCanvas);
    expect(project).toBe(projectPoint);
    expect(ray).toBe(pointerRay);
  });
});

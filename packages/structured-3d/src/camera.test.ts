import * as THREE from "three";
import { afterEach, describe, expect, it } from "vitest";
import { Actor } from "./actors";
import {
  applyRendererViewport,
  applyViewport,
  CAMERA_DEFAULTS,
  cameraObject,
  domSurface,
  fitViewport,
  syncCanvas,
  syncScreenCanvas,
  updateCamera,
  viewportRect,
  WorldCamera,
  type Camera,
} from "./camera";
import { CameraComponent } from "./components";
import type { SurfaceMetrics, Vec3 } from "./contract";
import { quatFromAxisAngle, quatRotate, UP } from "./math";
import { createStubCanvas } from "./testing/canvas";

/* -------------------------------------------------------------------------- */
/* Rigging                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A surface reporting fixed figures.
 *
 * This is what a validator hands the engine, and it is what makes every
 * assertion below exact rather than dependent on the machine the suite runs on:
 * jsdom lays nothing out and reports a device pixel ratio of `1`, so a suite
 * that measured would be asserting against the harness rather than the fit.
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

/** A canvas with a pretended laid-out size — jsdom performs no layout. */
function laidOutCanvas(cssW: number, cssH: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  Object.defineProperty(canvas, "clientWidth", {
    value: cssW,
    configurable: true,
  });
  Object.defineProperty(canvas, "clientHeight", {
    value: cssH,
    configurable: true,
  });
  return canvas;
}

/** Records `setTransform` — jsdom has no real 2D context to interrogate. */
function recordingContext(): {
  ctx: CanvasRenderingContext2D;
  calls: number[][];
} {
  const calls: number[][] = [];
  const ctx = {
    setTransform(
      a: number,
      b: number,
      c: number,
      d: number,
      e: number,
      f: number,
    ) {
      calls.push([a, b, c, d, e, f]);
    },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

/**
 * A real `THREE.WebGLRenderer` over the stubbed WebGL2 context.
 *
 * The renderer's rectangle is asserted through the real renderer rather than a
 * hand-written double because the thing worth checking is what reaches GL, and
 * three does non-trivial work between `setViewport` and `gl.viewport` — it
 * multiplies by its own pixel ratio, rounds, and suppresses a call that would
 * not change the state. A double would agree with whatever this module happened
 * to do.
 */
const renderers: THREE.WebGLRenderer[] = [];

afterEach(() => {
  for (const renderer of renderers.splice(0)) renderer.dispose();
});

function buildRenderer(): {
  renderer: THREE.WebGLRenderer;
  stub: ReturnType<typeof createStubCanvas>;
} {
  const stub = createStubCanvas({ width: 1000, height: 750 });
  const renderer = new THREE.WebGLRenderer({ canvas: stub.canvas });
  renderers.push(renderer);
  return { renderer, stub };
}

/** The design size every camera assertion below is stated against: 4:3. */
const W = 800;
const H = 600;

/** A camera at the documented defaults, over the design size above. */
function camera(width = W, height = H): WorldCamera {
  return new WorldCamera(width, height);
}

/** An actor carrying one `CameraComponent`, which is what a view target is. */
function viewTarget(fov?: number): {
  actor: Actor;
  lens: CameraComponent;
} {
  const actor = new Actor();
  const lens = actor.attach(
    new CameraComponent(fov === undefined ? {} : { fov }),
  );
  return { actor, lens };
}

/** Half the vertical extent of a perspective frustum at `distance`. */
function halfHeightAt(distance: number, fovDegrees: number): number {
  return distance * Math.tan(((fovDegrees / 2) * Math.PI) / 180);
}

/** Whether `point` lies on `ray`, to within a tolerance in world units. */
function liesOn(
  ray: { origin: Vec3; direction: Vec3 },
  point: Vec3,
  tolerance = 1e-6,
): boolean {
  const to = {
    x: point.x - ray.origin.x,
    y: point.y - ray.origin.y,
    z: point.z - ray.origin.z,
  };
  const t =
    to.x * ray.direction.x + to.y * ray.direction.y + to.z * ray.direction.z;
  const dx = to.x - ray.direction.x * t;
  const dy = to.y - ray.direction.y * t;
  const dz = to.z - ray.direction.z * t;
  return Math.hypot(dx, dy, dz) <= tolerance;
}

/* -------------------------------------------------------------------------- */
/* The viewport                                                               */
/* -------------------------------------------------------------------------- */

describe("fitViewport", () => {
  it("letterboxes horizontally when the container is wider than the logical field", () => {
    const vp = fitViewport(800, 600, 1000, 600, 1);

    // The height binds: 600/600 = 1 is smaller than 1000/800 = 1.25, so the
    // field is 800 wide inside 1000 and the 200 left over is split in two.
    expect(vp).toEqual({
      width: 800,
      height: 600,
      scale: 1,
      offsetX: 100,
      offsetY: 0,
    });
  });

  it("letterboxes vertically when the container is taller than the logical field", () => {
    const vp = fitViewport(800, 600, 800, 900, 1);

    expect(vp.scale).toBe(1);
    expect(vp.offsetX).toBe(0);
    expect(vp.offsetY).toBe(150);
  });

  it("has no bars at all when the container matches the logical aspect ratio", () => {
    const vp = fitViewport(800, 600, 400, 300, 1);

    expect(vp.scale).toBe(0.5);
    expect(vp.offsetX).toBe(0);
    expect(vp.offsetY).toBe(0);
  });

  it("fits at a non-integer scale rather than rounding to a whole one", () => {
    const vp = fitViewport(800, 600, 900, 900, 1);

    // A rounded scale would either crop the field or leave a gap; the fit is the
    // exact ratio and the bars absorb the remainder.
    expect(vp.scale).toBeCloseTo(1.125, 12);
    expect(vp.offsetY).toBeCloseTo((900 - 600 * 1.125) / 2, 12);
  });

  it("folds a device pixel ratio above 1 into the scale and the bars", () => {
    const vp = fitViewport(800, 600, 1000, 600, 2);

    // Everything the viewport reports is in device pixels: a CSS-pixel figure is
    // this divided by the ratio.
    expect(vp.scale).toBe(2);
    expect(vp.offsetX).toBe(200);
    expect(vp.scale / 2).toBe(fitViewport(800, 600, 1000, 600, 1).scale);
  });

  it("folds a fractional device pixel ratio in without leaving a seam", () => {
    const dpr = 1.5;
    const vp = fitViewport(800, 600, 500, 500, dpr);
    const deviceW = Math.round(500 * dpr);
    const deviceH = Math.round(500 * dpr);

    // The two bars are computed against the *rounded* device size the backing
    // store is written at, so they sum to the drawable area exactly rather than
    // leaving a sub-pixel column the scissor excludes and the HUD draws into.
    expect(2 * vp.offsetX + vp.width * vp.scale).toBeCloseTo(deviceW, 9);
    expect(2 * vp.offsetY + vp.height * vp.scale).toBeCloseTo(deviceH, 9);
  });

  it("keeps the whole logical field inside the container on both axes", () => {
    const shapes: Array<[number, number]> = [
      [1000, 600],
      [300, 900],
      [17, 41],
      [1920, 1080],
    ];
    for (const [cssW, cssH] of shapes) {
      const vp = fitViewport(800, 600, cssW, cssH, 1);
      expect(vp.width * vp.scale).toBeLessThanOrEqual(cssW + 1e-9);
      expect(vp.height * vp.scale).toBeLessThanOrEqual(cssH + 1e-9);
      expect(vp.offsetX).toBeGreaterThanOrEqual(-1e-9);
      expect(vp.offsetY).toBeGreaterThanOrEqual(-1e-9);
    }
  });

  it("centres the field: the two bars on the binding axis are equal", () => {
    const vp = fitViewport(800, 600, 1000, 600, 2);
    const deviceW = 2000;

    expect(deviceW - vp.offsetX - vp.width * vp.scale).toBeCloseTo(
      vp.offsetX,
      9,
    );
  });

  it("yields a finite, zero-scale viewport for a container with no size", () => {
    // A hidden element, or one the browser has not laid out yet. The frame draws
    // nothing rather than dividing by zero into the transform.
    for (const [cssW, cssH] of [
      [0, 0],
      [0, 600],
      [800, 0],
    ] as Array<[number, number]>) {
      const vp = fitViewport(800, 600, cssW, cssH, 2);
      expect(vp.scale).toBe(0);
      expect(Number.isFinite(vp.offsetX)).toBe(true);
      expect(Number.isFinite(vp.offsetY)).toBe(true);
    }
  });

  it("stays finite for a logical size that is not finite and positive", () => {
    for (const [w, h] of [
      [0, 600],
      [800, 0],
      [Number.NaN, 600],
      [800, Number.POSITIVE_INFINITY],
      [-800, 600],
    ] as Array<[number, number]>) {
      const vp = fitViewport(w, h, 400, 300, 1);
      expect(vp.scale).toBe(0);
      expect(Number.isFinite(vp.offsetX)).toBe(true);
      expect(Number.isFinite(vp.offsetY)).toBe(true);
    }
  });

  it("reads a ratio that is not finite and positive as 1", () => {
    const plain = fitViewport(800, 600, 400, 300, 1);
    for (const dpr of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(fitViewport(800, 600, 400, 300, dpr)).toEqual(plain);
    }
  });

  it("returns a fresh viewport each call, so a held one keeps its frame's values", () => {
    const first = fitViewport(800, 600, 1000, 600, 1);
    const second = fitViewport(800, 600, 400, 300, 1);

    expect(second).not.toBe(first);
    expect(first.scale).toBe(1);
  });
});

describe("the logical-to-device mapping", () => {
  const vp = fitViewport(800, 600, 1000, 600, 2);

  /** `deviceX = offsetX + logicalX * scale`, as the concept page states it. */
  function toDevice(x: number, y: number): [number, number] {
    return [vp.offsetX + x * vp.scale, vp.offsetY + y * vp.scale];
  }

  it("puts the logical origin at the top-left corner of the letterboxed field", () => {
    expect(toDevice(0, 0)).toEqual([200, 0]);
  });

  it("puts the far corner exactly on the far edge of the field", () => {
    expect(toDevice(800, 600)).toEqual([1800, 1200]);
  });

  it("puts the logical centre at the centre of the backing store", () => {
    expect(toDevice(400, 300)).toEqual([1000, 600]);
  });

  it("round-trips a device point back through the inverse map", () => {
    const [dx, dy] = toDevice(137, 421);

    expect((dx - vp.offsetX) / vp.scale).toBeCloseTo(137, 9);
    expect((dy - vp.offsetY) / vp.scale).toBeCloseTo(421, 9);
  });

  it("takes a CSS-pixel pointer position to logical through the same scale", () => {
    const dpr = 2;
    // A pointer event reports CSS pixels; the fit is in device pixels, so the
    // conversion multiplies by the ratio first.
    const cssX = 600;
    expect((cssX * dpr - vp.offsetX) / vp.scale).toBeCloseTo(500, 9);
  });

  it("is the transform applyViewport installs", () => {
    const { ctx, calls } = recordingContext();

    applyViewport(ctx, vp);

    expect(calls).toEqual([[vp.scale, 0, 0, vp.scale, vp.offsetX, vp.offsetY]]);
  });
});

describe("applyViewport", () => {
  it("maps logical coordinates onto the letterboxed device pixels", () => {
    const { ctx, calls } = recordingContext();

    applyViewport(ctx, fitViewport(800, 600, 1000, 600, 2));

    expect(calls).toEqual([[2, 0, 0, 2, 200, 0]]);
  });

  it("replaces the transform instead of compounding it across frames", () => {
    const { ctx, calls } = recordingContext();
    const vp = fitViewport(800, 600, 400, 300, 1);

    applyViewport(ctx, vp);
    applyViewport(ctx, vp);
    applyViewport(ctx, vp);

    // A `translate`/`scale` pair would have the HUD a thousandth of its size by
    // the end of the first second; `setTransform` starts from a blank page every
    // frame, whatever a `DrawComponent` left behind.
    expect(calls).toEqual([
      [0.5, 0, 0, 0.5, 0, 0],
      [0.5, 0, 0, 0.5, 0, 0],
      [0.5, 0, 0, 0.5, 0, 0],
    ]);
  });

  it("installs a degenerate transform rather than an infinite one", () => {
    const { ctx, calls } = recordingContext();

    applyViewport(ctx, fitViewport(800, 600, 0, 0, 2));

    expect(calls).toEqual([[0, 0, 0, 0, 0, 0]]);
  });
});

/* -------------------------------------------------------------------------- */
/* The renderer's rectangle                                                   */
/* -------------------------------------------------------------------------- */

describe("viewportRect", () => {
  it("is the letterboxed rectangle in device pixels", () => {
    expect(viewportRect(fitViewport(800, 600, 1000, 600, 2))).toEqual({
      x: 200,
      y: 0,
      width: 1600,
      height: 1200,
    });
  });

  it("names the same region the screen layer's transform maps onto", () => {
    const vp = fitViewport(800, 600, 500, 500, 1.5);
    const rect = viewportRect(vp);

    // The agreement the whole design rests on: the HUD lands on the picture.
    expect(vp.offsetX).toBeCloseTo(rect.x, 9);
    expect(vp.offsetY).toBeCloseTo(rect.y, 9);
    expect(vp.offsetX + vp.width * vp.scale).toBeCloseTo(
      rect.x + rect.width,
      9,
    );
    expect(vp.offsetY + vp.height * vp.scale).toBeCloseTo(
      rect.y + rect.height,
      9,
    );
  });

  it("needs no vertical flip, because the bars above and below are equal", () => {
    const dpr = 1.5;
    const vp = fitViewport(800, 600, 500, 500, dpr);
    const rect = viewportRect(vp);
    const deviceH = Math.round(500 * dpr);

    // Read from the bottom, as GL reads it, the rectangle is the same one.
    expect(deviceH - rect.y - rect.height).toBeCloseTo(rect.y, 9);
  });

  it("has zero area when the surface has no size", () => {
    expect(viewportRect(fitViewport(800, 600, 0, 0, 2))).toEqual({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    });
  });

  it("covers the whole backing store when the aspect ratios agree", () => {
    expect(viewportRect(fitViewport(800, 600, 400, 300, 2))).toEqual({
      x: 0,
      y: 0,
      width: 800,
      height: 600,
    });
  });
});

describe("applyRendererViewport", () => {
  it("sets the renderer's viewport and scissor to the letterboxed rectangle", () => {
    const { renderer } = buildRenderer();

    applyRendererViewport(renderer, fitViewport(800, 600, 1000, 600, 2));

    const viewport = renderer.getViewport(new THREE.Vector4());
    const scissor = renderer.getScissor(new THREE.Vector4());
    expect([viewport.x, viewport.y, viewport.z, viewport.w]).toEqual([
      200, 0, 1600, 1200,
    ]);
    expect([scissor.x, scissor.y, scissor.z, scissor.w]).toEqual([
      200, 0, 1600, 1200,
    ]);
  });

  it("turns the scissor test on, so the bars keep the background color", () => {
    const { renderer, stub } = buildRenderer();
    stub.gl.forget();

    applyRendererViewport(renderer, fitViewport(800, 600, 1000, 600, 2));

    expect(renderer.getScissorTest()).toBe(true);
    // Without the enable, the scene's own clear would paint over the bars the
    // whole canvas was just cleared to `background` for.
    const enables = stub.gl
      .callsTo("enable")
      .map((call) => stub.gl.constantName(call.args[0] as number));
    expect(enables).toContain("SCISSOR_TEST");
  });

  it("reaches GL as the device-pixel rectangle, rounded", () => {
    const { renderer, stub } = buildRenderer();
    stub.gl.forget();

    applyRendererViewport(renderer, fitViewport(800, 600, 500, 500, 1.5));

    // 750×750 device pixels, a 750×562.5 picture centred vertically. three
    // rounds on the way to GL; what matters is that nothing else scaled it.
    expect(stub.gl.lastCall("viewport")?.args).toEqual([0, 94, 750, 563]);
    expect(stub.gl.lastCall("scissor")?.args).toEqual([0, 94, 750, 563]);
  });

  it("assumes the renderer's own pixel ratio is 1, since the fit folded it in", () => {
    const { renderer, stub } = buildRenderer();
    stub.gl.forget();

    expect(renderer.getPixelRatio()).toBe(1);

    applyRendererViewport(renderer, fitViewport(800, 600, 400, 300, 2));

    // Were the renderer's ratio set to the device's as well, the picture would
    // be placed at `dpr` squared and three quarters of it would fall off.
    expect(stub.gl.lastCall("viewport")?.args).toEqual([0, 0, 800, 600]);
  });

  it("follows a resize on the frame the fit changes", () => {
    const { renderer } = buildRenderer();

    applyRendererViewport(renderer, fitViewport(800, 600, 1000, 600, 2));
    applyRendererViewport(renderer, fitViewport(800, 600, 800, 900, 1));

    const viewport = renderer.getViewport(new THREE.Vector4());
    expect([viewport.x, viewport.y, viewport.z, viewport.w]).toEqual([
      0, 150, 800, 600,
    ]);
  });

  it("gives the renderer an empty rectangle when the surface has no size", () => {
    const { renderer } = buildRenderer();

    applyRendererViewport(renderer, fitViewport(800, 600, 0, 0, 2));

    const viewport = renderer.getViewport(new THREE.Vector4());
    expect([viewport.x, viewport.y, viewport.z, viewport.w]).toEqual([
      0, 0, 0, 0,
    ]);
    expect(renderer.getScissorTest()).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Measuring, and sizing the canvases                                         */
/* -------------------------------------------------------------------------- */

describe("domSurface", () => {
  it("reports the element's laid-out size, its window's ratio, and its document", () => {
    const canvas = laidOutCanvas(400, 300);
    Object.defineProperty(window, "devicePixelRatio", {
      value: 3,
      configurable: true,
    });

    const surface = domSurface(canvas);

    expect(surface.cssWidth()).toBe(400);
    expect(surface.cssHeight()).toBe(300);
    expect(surface.dpr()).toBe(3);
    expect(surface.events()).toBe(canvas.ownerDocument);
  });

  it("measures on every call, so a resize needs no handler", () => {
    const canvas = laidOutCanvas(400, 300);
    const surface = domSurface(canvas);
    expect(surface.cssWidth()).toBe(400);

    Object.defineProperty(canvas, "clientWidth", {
      value: 900,
      configurable: true,
    });

    expect(surface.cssWidth()).toBe(900);
  });

  it("reads the origin from the element's current bounding rectangle", () => {
    const canvas = laidOutCanvas(400, 300);
    canvas.getBoundingClientRect = (): DOMRect =>
      ({ left: 32, top: 64 }) as DOMRect;

    expect(domSurface(canvas).origin?.()).toEqual({ x: 32, y: 64 });
  });

  it("claims the browser's gestures on the element, and gives them back", () => {
    const canvas = laidOutCanvas(400, 300);
    canvas.style.touchAction = "pan-y";

    const give = domSurface(canvas).claimGestures?.();

    expect(canvas.style.touchAction).toBe("none");
    expect(canvas.style.userSelect).toBe("none");

    give?.();

    // Restored to what the page had, not cleared: an engine torn down and
    // rebuilt over the same canvas leaves the page as it found it.
    expect(canvas.style.touchAction).toBe("pan-y");
  });

  it("swallows the context menu and the wheel's page scroll while claimed", () => {
    const canvas = laidOutCanvas(400, 300);
    const give = domSurface(canvas).claimGestures?.();

    const menu = new Event("contextmenu", { cancelable: true });
    canvas.dispatchEvent(menu);
    const wheel = new Event("wheel", { cancelable: true });
    canvas.dispatchEvent(wheel);
    expect(menu.defaultPrevented).toBe(true);
    expect(wheel.defaultPrevented).toBe(true);

    give?.();

    const after = new Event("contextmenu", { cancelable: true });
    canvas.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });

  it("captures and releases a pointer on the element, and survives one that is gone", () => {
    const canvas = laidOutCanvas(400, 300);
    const captured: number[] = [];
    canvas.setPointerCapture = (id: number): void => {
      if (id === 99) throw new Error("no such pointer");
      captured.push(id);
    };
    canvas.releasePointerCapture = (id: number): void => {
      if (id === 99) throw new Error("no such pointer");
      captured.splice(captured.indexOf(id), 1);
    };
    const surface = domSurface(canvas);

    surface.capturePointer?.(4);
    expect(captured).toEqual([4]);

    // A pointer that ended between the event and the call is exactly the case
    // the browser throws on, and losing the frame to it would be absurd.
    expect(() => surface.capturePointer?.(99)).not.toThrow();
    expect(() => surface.releasePointerCapture?.(99)).not.toThrow();

    surface.releasePointerCapture?.(4);
    expect(captured).toEqual([]);
  });
});

describe("syncCanvas", () => {
  it("takes its size and ratio from the surface, not from the element", () => {
    // The element says one thing and the surface another; the surface wins,
    // which is what puts the engine over a canvas with no document behind it.
    const canvas = laidOutCanvas(123, 456);

    const vp = syncCanvas(canvas, 800, 600, fixedSurface(400, 300, 2));

    expect([canvas.width, canvas.height]).toEqual([800, 600]);
    expect(vp.scale).toBe(1);
  });

  it("writes the backing store only when it actually changed", () => {
    const canvas = document.createElement("canvas");
    const surface = fixedSurface(400, 300, 2);
    syncCanvas(canvas, 800, 600, surface);

    let writes = 0;
    const own = Object.getOwnPropertyDescriptor(
      HTMLCanvasElement.prototype,
      "width",
    );
    Object.defineProperty(canvas, "width", {
      configurable: true,
      get: (): number => own?.get?.call(canvas) as number,
      set: (value: number): void => {
        writes += 1;
        own?.set?.call(canvas, value);
      },
    });

    syncCanvas(canvas, 800, 600, surface);
    syncCanvas(canvas, 800, 600, surface);

    // Assigning `canvas.width` reallocates and clears even when the value is
    // unchanged, and on the stage canvas that is a GL drawing-buffer resize.
    expect(writes).toBe(0);
  });

  it("rounds the backing store, and centres the bars against the rounded size", () => {
    const canvas = document.createElement("canvas");

    const vp = syncCanvas(canvas, 800, 600, fixedSurface(333, 333, 1.5));

    expect([canvas.width, canvas.height]).toEqual([500, 500]);
    expect(2 * vp.offsetY + vp.height * vp.scale).toBeCloseTo(500, 9);
  });

  it("keeps the last backing store when the surface reports no size", () => {
    const canvas = document.createElement("canvas");
    syncCanvas(canvas, 800, 600, fixedSurface(400, 300, 2));

    const vp = syncCanvas(canvas, 800, 600, fixedSurface(0, 0, 2));

    // Resizing to nothing would throw away the last good frame for no benefit.
    expect([canvas.width, canvas.height]).toEqual([800, 600]);
    expect(vp.scale).toBe(0);
  });

  it("keeps the last backing store when only one axis collapses", () => {
    const canvas = document.createElement("canvas");
    syncCanvas(canvas, 800, 600, fixedSurface(400, 300, 2));

    syncCanvas(canvas, 800, 600, fixedSurface(400, 0, 2));

    expect([canvas.width, canvas.height]).toEqual([800, 600]);
  });

  it("recovers the fit as soon as the surface has a size again", () => {
    const canvas = document.createElement("canvas");
    syncCanvas(canvas, 800, 600, fixedSurface(0, 0, 2));

    const vp = syncCanvas(canvas, 800, 600, fixedSurface(400, 300, 2));

    expect(vp.scale).toBe(1);
    expect([canvas.width, canvas.height]).toEqual([800, 600]);
  });

  it("survives a surface reporting nonsense, without resizing the canvas away", () => {
    const canvas = document.createElement("canvas");
    syncCanvas(canvas, 800, 600, fixedSurface(400, 300, 2));

    const vp = syncCanvas(
      canvas,
      800,
      600,
      fixedSurface(Number.NaN, Number.POSITIVE_INFINITY, Number.NaN),
    );

    expect([canvas.width, canvas.height]).toEqual([800, 600]);
    expect(vp.scale).toBe(0);
  });
});

describe("syncCanvas and the CSS size", () => {
  it("pins a pixel size onto a canvas the page has not sized at all", () => {
    // An unsized canvas takes its CSS size from its attributes, which are 300×150
    // by default in every browser and in jsdom.
    const canvas = document.createElement("canvas");

    syncCanvas(canvas, 800, 600, fixedSurface(300, 150, 2));

    expect([canvas.width, canvas.height]).toEqual([600, 300]);
    expect(canvas.style.width).toBe("300px");
    expect(canvas.style.height).toBe("150px");
  });

  it("does not let an unpinned canvas grow across repeated frames", () => {
    const canvas = document.createElement("canvas");
    // The feedback loop, staged: the measurement is read *from* the attributes,
    // exactly as a browser reads it for an element the page has not sized.
    const measuring: SurfaceMetrics = {
      cssWidth: (): number =>
        canvas.style.width === ""
          ? canvas.width
          : Number.parseFloat(canvas.style.width),
      cssHeight: (): number =>
        canvas.style.height === ""
          ? canvas.height
          : Number.parseFloat(canvas.style.height),
      dpr: (): number => 2,
      events: (): EventTarget => new EventTarget(),
    };

    for (let frame = 0; frame < 10; frame += 1) {
      syncCanvas(canvas, 800, 600, measuring);
    }

    // Without the pin this would be 300 × 2^10.
    expect(canvas.width).toBe(600);
    expect(canvas.style.width).toBe("300px");
  });

  it("leaves a canvas sized by a stylesheet alone, though its inline style is empty", () => {
    const canvas = document.createElement("canvas");

    // A stylesheet rule the engine cannot see, reported through the surface.
    syncCanvas(canvas, 800, 600, fixedSurface(500, 400, 1));

    expect([canvas.width, canvas.height]).toEqual([500, 400]);
    // Writing a pixel size here would override the page's rule and freeze the
    // canvas at whatever size it was first measured at.
    expect(canvas.style.width).toBe("");
    expect(canvas.style.height).toBe("");
  });

  it("keeps following a stylesheet-sized container as it resizes", () => {
    const canvas = document.createElement("canvas");
    syncCanvas(canvas, 800, 600, fixedSurface(500, 400, 1));

    syncCanvas(canvas, 800, 600, fixedSurface(900, 700, 1));

    expect([canvas.width, canvas.height]).toEqual([900, 700]);
    expect(canvas.style.width).toBe("");
  });

  it("leaves an inline CSS size alone as well", () => {
    const canvas = document.createElement("canvas");
    canvas.style.width = "640px";
    canvas.style.height = "480px";

    syncCanvas(canvas, 800, 600, fixedSurface(640, 480, 2));

    expect([canvas.width, canvas.height]).toEqual([1280, 960]);
    expect(canvas.style.width).toBe("640px");
  });

  it("writes no CSS size at all when the surface reports no size", () => {
    const canvas = document.createElement("canvas");

    syncCanvas(canvas, 800, 600, fixedSurface(0, 0, 2));

    expect(canvas.style.width).toBe("");
  });

  it("sizes a canvas that exposes no style at all, without touching one", () => {
    // A canvas driven headlessly behind a supplied surface: no layout to feed
    // back into, so nothing to pin.
    const canvas = document.createElement("canvas");
    Object.defineProperty(canvas, "style", {
      value: undefined,
      configurable: true,
    });

    expect(() =>
      syncCanvas(canvas, 800, 600, fixedSurface(300, 150, 2)),
    ).not.toThrow();
    expect([canvas.width, canvas.height]).toEqual([600, 300]);
  });
});

describe("syncScreenCanvas", () => {
  it("gives the screen canvas the stage canvas's backing store", () => {
    const stage = document.createElement("canvas");
    const screen = document.createElement("canvas");
    syncCanvas(stage, 800, 600, fixedSurface(400, 300, 2));

    syncScreenCanvas(screen, stage);

    // One device pixel of HUD over one device pixel of scene.
    expect([screen.width, screen.height]).toEqual([800, 600]);
  });

  it("copies the stage's size rather than measuring the surface again", () => {
    const stage = document.createElement("canvas");
    const screen = document.createElement("canvas");
    stage.width = 977;
    stage.height = 501;

    syncScreenCanvas(screen, stage);

    // A second derivation would agree almost always and disagree on the frame a
    // measurement changed between the two reads.
    expect([screen.width, screen.height]).toEqual([977, 501]);
  });

  it("writes nothing when the sizes already agree, so the HUD is not erased", () => {
    const stage = document.createElement("canvas");
    const screen = document.createElement("canvas");
    stage.width = 800;
    stage.height = 600;
    syncScreenCanvas(screen, stage);

    let writes = 0;
    const own = Object.getOwnPropertyDescriptor(
      HTMLCanvasElement.prototype,
      "width",
    );
    Object.defineProperty(screen, "width", {
      configurable: true,
      get: (): number => own?.get?.call(screen) as number,
      set: (value: number): void => {
        writes += 1;
        own?.set?.call(screen, value);
      },
    });

    syncScreenCanvas(screen, stage);

    expect(writes).toBe(0);
  });

  it("leaves both canvases alone when the surface reports no size", () => {
    const stage = document.createElement("canvas");
    const screen = document.createElement("canvas");
    syncCanvas(stage, 800, 600, fixedSurface(400, 300, 2));
    syncScreenCanvas(screen, stage);

    syncCanvas(stage, 800, 600, fixedSurface(0, 0, 2));
    syncScreenCanvas(screen, stage);

    expect([screen.width, screen.height]).toEqual([800, 600]);
  });

  it("writes no CSS size onto the screen canvas, which is never in the layout", () => {
    const stage = document.createElement("canvas");
    const screen = document.createElement("canvas");
    stage.width = 640;
    stage.height = 480;

    syncScreenCanvas(screen, stage);

    expect(screen.style.width).toBe("");
  });
});

/* -------------------------------------------------------------------------- */
/* The camera's defaults                                                      */
/* -------------------------------------------------------------------------- */

describe("CAMERA_DEFAULTS", () => {
  it("is the documented pose and projection", () => {
    expect(CAMERA_DEFAULTS.position).toEqual({ x: 0, y: 0, z: 10 });
    expect(CAMERA_DEFAULTS.rotation).toEqual({ x: 0, y: 0, z: 0, w: 1 });
    expect(CAMERA_DEFAULTS.projection).toBe("perspective");
    expect(CAMERA_DEFAULTS.fov).toBe(60);
    expect(CAMERA_DEFAULTS.near).toBe(0.1);
    expect(CAMERA_DEFAULTS.far).toBe(1000);
  });

  it("is frozen, so one world's defaults cannot be changed by another", () => {
    expect(Object.isFrozen(CAMERA_DEFAULTS)).toBe(true);
    expect(Object.isFrozen(CAMERA_DEFAULTS.position)).toBe(true);
  });
});

describe("a world's camera at its defaults", () => {
  it("starts at the documented pose, projection, and planes", () => {
    const cam = camera();

    expect(cam.position).toEqual({ x: 0, y: 0, z: 10 });
    expect(cam.rotation).toEqual({ x: 0, y: 0, z: 0, w: 1 });
    expect(cam.projection).toBe("perspective");
    expect(cam.fov).toBe(60);
    expect(cam.near).toBe(0.1);
    expect(cam.far).toBe(1000);
    expect(cam.bounds).toBeNull();
    expect(cam.target).toBeNull();
  });

  it("takes its orthoHeight from the logical design height", () => {
    expect(camera(800, 600).orthoHeight).toBe(600);
    expect(camera(1280, 720).orthoHeight).toBe(720);
  });

  it("has a mesh at the origin already in view, before the game moves anything", () => {
    const at = camera().worldToLogical({ x: 0, y: 0, z: 0 });

    expect(at.visible).toBe(true);
    expect(at.x).toBeCloseTo(400, 9);
    expect(at.y).toBeCloseTo(300, 9);
  });

  it("hands each camera its own mutable pose rather than the frozen defaults", () => {
    const a = camera();
    const b = camera();

    a.position.y += 5;

    // `camera.position.y += dt` is a legitimate move; handing out the frozen
    // constant would make it throw in strict mode and do nothing outside it.
    expect(a.position.y).toBe(5);
    expect(b.position.y).toBe(0);
    expect(CAMERA_DEFAULTS.position.y).toBe(0);
  });

  it("refuses a logical design size the projection cannot be centred on", () => {
    expect(() => camera(0, 600)).toThrow(RangeError);
    expect(() => camera(800, Number.NaN)).toThrow(RangeError);
    expect(() => camera(-800, 600)).toThrow(RangeError);
  });
});

/* -------------------------------------------------------------------------- */
/* snapshot                                                                   */
/* -------------------------------------------------------------------------- */

describe("snapshot", () => {
  it("reports the perspective pose, planes, and field of view", () => {
    const cam = camera();

    expect(cam.snapshot()).toEqual({
      projection: "perspective",
      position: { x: 0, y: 0, z: 10 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      fov: 60,
      near: 0.1,
      far: 1000,
      zoom: 1,
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
    });
  });

  it("reads a perspective camera's orthographic extents as zero", () => {
    const cam = camera();
    cam.orthoHeight = 40;

    const shot = cam.snapshot();

    // A reader switches on `projection` rather than on which fields are present.
    expect([shot.left, shot.right, shot.top, shot.bottom]).toEqual([
      0, 0, 0, 0,
    ]);
  });

  it("reports the orthographic extents from orthoHeight and the design aspect", () => {
    const cam = camera();
    cam.projection = "orthographic";

    const shot = cam.snapshot();

    // top = orthoHeight / 2, right = top * width / height, and both mirror.
    expect(shot.top).toBe(300);
    expect(shot.bottom).toBe(-300);
    expect(shot.right).toBeCloseTo(400, 9);
    expect(shot.left).toBeCloseTo(-400, 9);
    expect(shot.fov).toBe(0);
  });

  it("follows a narrower vertical span", () => {
    const cam = camera();
    cam.projection = "orthographic";
    cam.orthoHeight = 20;

    const shot = cam.snapshot();

    expect(shot.top).toBe(10);
    expect(shot.right).toBeCloseTo((20 / 2) * (800 / 600), 9);
  });

  it("reports three's zoom factor as 1, the world camera's framing being fov and orthoHeight", () => {
    expect(camera().snapshot().zoom).toBe(1);
  });

  it("hands each caller a value it owns", () => {
    const cam = camera();

    const shot = cam.snapshot();
    shot.position.x = 999;

    expect(cam.position.x).toBe(0);
    expect(cam.snapshot().position).not.toBe(shot.position);
  });

  it("keeps the values of the frame it was read in", () => {
    const cam = camera();
    const held = cam.snapshot();

    cam.position = { x: 5, y: 6, z: 7 };
    cam.fov = 30;

    expect(held.position).toEqual({ x: 0, y: 0, z: 10 });
    expect(held.fov).toBe(60);
    expect(cam.snapshot().fov).toBe(30);
  });
});

/* -------------------------------------------------------------------------- */
/* worldToLogical                                                             */
/* -------------------------------------------------------------------------- */

describe("worldToLogical, orthographic", () => {
  function ortho(): WorldCamera {
    const cam = camera();
    cam.projection = "orthographic";
    return cam;
  }

  it("puts the world origin at the centre of the logical field", () => {
    const at = ortho().worldToLogical({ x: 0, y: 0, z: 0 });

    expect(at.x).toBeCloseTo(400, 9);
    expect(at.y).toBeCloseTo(300, 9);
    expect(at.visible).toBe(true);
  });

  it("maps one world unit to one logical unit at the default vertical span", () => {
    const cam = ortho();

    const right = cam.worldToLogical({ x: 1, y: 0, z: 0 });
    const up = cam.worldToLogical({ x: 0, y: 1, z: 0 });

    // The documented default: at `orthoHeight` equal to the design height, one
    // world unit on the `z = 0` plane is one logical unit.
    expect(right.x).toBeCloseTo(401, 9);
    // And logical `y` runs *down*, so world `+Y` is a smaller logical `y`.
    expect(up.y).toBeCloseTo(299, 9);
  });

  it("puts the camera's extents on the corners of the field", () => {
    const cam = ortho();

    expect(cam.worldToLogical({ x: -400, y: 300, z: 0 }).x).toBeCloseTo(0, 6);
    expect(cam.worldToLogical({ x: -400, y: 300, z: 0 }).y).toBeCloseTo(0, 6);
    expect(cam.worldToLogical({ x: 400, y: -300, z: 0 }).x).toBeCloseTo(800, 6);
    expect(cam.worldToLogical({ x: 400, y: -300, z: 0 }).y).toBeCloseTo(600, 6);
  });

  it("reports normalized depth running -1 at the near plane to 1 at the far plane", () => {
    const cam = ortho();

    const near = cam.worldToLogical({ x: 0, y: 0, z: 10 - cam.near });
    const far = cam.worldToLogical({ x: 0, y: 0, z: 10 - cam.far });
    const middle = cam.worldToLogical({ x: 0, y: 0, z: 0 });

    expect(near.depth).toBeCloseTo(-1, 6);
    expect(far.depth).toBeCloseTo(1, 6);
    expect(middle.depth).toBeGreaterThan(near.depth);
    expect(middle.depth).toBeLessThan(far.depth);
  });

  it("follows a narrower vertical span, which magnifies the picture", () => {
    const cam = ortho();
    cam.orthoHeight = 300;

    // Half the span is twice the magnification: one world unit is two logical.
    expect(cam.worldToLogical({ x: 0, y: 1, z: 0 }).y).toBeCloseTo(298, 9);
  });

  it("still reports coordinates for a point off the side of the field", () => {
    const at = ortho().worldToLogical({ x: 600, y: 0, z: 0 });

    // Unclamped, so a game can pin an off-screen marker to the field's edge in
    // the direction of the thing it marks.
    expect(at.x).toBeCloseTo(1000, 9);
    expect(at.visible).toBe(false);
  });

  it("reports a point behind the camera as out of view", () => {
    const at = ortho().worldToLogical({ x: 0, y: 0, z: 20 });

    expect(at.visible).toBe(false);
  });

  it("reports a point beyond the far plane as out of view", () => {
    const at = ortho().worldToLogical({ x: 0, y: 0, z: -5000 });

    expect(at.visible).toBe(false);
  });
});

describe("worldToLogical, perspective", () => {
  it("puts a point on the view axis at the centre of the field", () => {
    const at = camera().worldToLogical({ x: 0, y: 0, z: -40 });

    expect(at.x).toBeCloseTo(400, 9);
    expect(at.y).toBeCloseTo(300, 9);
    expect(at.visible).toBe(true);
  });

  it("projects through the documented field of view and design aspect", () => {
    const cam = camera();
    // The frustum's half-height ten units in front of the eye, which is the
    // `z = 0` plane the default camera looks at.
    const half = halfHeightAt(10, 60);

    expect(cam.worldToLogical({ x: 0, y: half, z: 0 }).y).toBeCloseTo(0, 6);
    expect(cam.worldToLogical({ x: 0, y: -half, z: 0 }).y).toBeCloseTo(600, 6);
    // The horizontal half-extent is the vertical one times the design aspect,
    // which is what holds the picture at the design shape.
    expect(cam.worldToLogical({ x: half * (W / H), y: 0, z: 0 }).x).toBeCloseTo(
      800,
      6,
    );
  });

  it("shrinks a farther object, which is what a frustum is for", () => {
    const cam = camera();

    const near = cam.worldToLogical({ x: 1, y: 0, z: 0 });
    const far = cam.worldToLogical({ x: 1, y: 0, z: -90 });

    // Same world offset from the axis, less of the field taken up.
    expect(near.x - 400).toBeGreaterThan(far.x - 400);
    expect(far.x).toBeGreaterThan(400);
  });

  it("reports depth increasing from the near plane to the far one", () => {
    const cam = camera();

    const near = cam.worldToLogical({ x: 0, y: 0, z: 10 - cam.near });
    const mid = cam.worldToLogical({ x: 0, y: 0, z: 0 });
    const far = cam.worldToLogical({ x: 0, y: 0, z: 10 - cam.far });

    expect(near.depth).toBeCloseTo(-1, 5);
    expect(far.depth).toBeCloseTo(1, 5);
    expect(mid.depth).toBeGreaterThan(near.depth);
    expect(mid.depth).toBeLessThan(far.depth);
  });

  it("reports a point behind the camera as out of view", () => {
    const cam = camera();

    const behind = cam.worldToLogical({ x: 0, y: 0, z: 30 });

    // The trap this exists to avoid: dividing by a negative `w` folds a point
    // behind the camera back into the `-1..1` box, so a caller reading the pair
    // alone would draw a marker for something the player cannot see. `visible`
    // is read from the frustum instead.
    expect(behind.visible).toBe(false);
  });

  it("follows a field of view the game narrowed, from the write onward", () => {
    const cam = camera();
    const wide = cam.worldToLogical({ x: 2, y: 0, z: 0 }).x;

    cam.fov = 30;
    const narrow = cam.worldToLogical({ x: 2, y: 0, z: 0 }).x;

    // A narrower lens magnifies: the same world point moves further from centre.
    expect(narrow - 400).toBeGreaterThan(wide - 400);
  });

  it("answers through the camera as it stands at the call", () => {
    const cam = camera();
    expect(cam.worldToLogical({ x: 0, y: 0, z: 0 }).x).toBeCloseTo(400, 9);

    cam.position = { x: 5, y: 0, z: 10 };

    expect(cam.worldToLogical({ x: 5, y: 0, z: 0 }).x).toBeCloseTo(400, 9);
    expect(cam.worldToLogical({ x: 0, y: 0, z: 0 }).x).toBeLessThan(400);
  });

  it("projects through a rotated camera's own axes", () => {
    const cam = camera();
    cam.position = { x: 10, y: 0, z: 0 };
    // Turned a quarter turn about `+Y`, so its `-Z` now looks along `-X`,
    // straight at the origin.
    cam.rotation = quatFromAxisAngle(UP, Math.PI / 2);

    const at = cam.worldToLogical({ x: 0, y: 0, z: 0 });

    expect(at.x).toBeCloseTo(400, 6);
    expect(at.y).toBeCloseTo(300, 6);
    expect(at.visible).toBe(true);
    // And the mirror point, now behind the turned camera, is out of view — the
    // divide would fold it onto the same centre pixel.
    const behind = cam.worldToLogical({ x: 20, y: 0, z: 0 });
    expect(behind.x).toBeCloseTo(400, 6);
    expect(behind.visible).toBe(false);
  });

  it("hands each caller a fresh result", () => {
    const cam = camera();

    const first = cam.worldToLogical({ x: 1, y: 2, z: 3 });
    const second = cam.worldToLogical({ x: 1, y: 2, z: 3 });

    expect(second).not.toBe(first);
    expect(second).toEqual(first);
  });
});

/* -------------------------------------------------------------------------- */
/* logicalToRay                                                               */
/* -------------------------------------------------------------------------- */

describe("logicalToRay, perspective", () => {
  it("starts at the eye and points along the view direction at the centre", () => {
    const ray = camera().logicalToRay({ x: 400, y: 300 });

    expect(ray.origin).toEqual({ x: 0, y: 0, z: 10 });
    expect(ray.direction.x).toBeCloseTo(0, 9);
    expect(ray.direction.y).toBeCloseTo(0, 9);
    expect(ray.direction.z).toBeCloseTo(-1, 9);
  });

  it("returns a unit direction, so a distance along it is in world units", () => {
    const cam = camera();

    for (const point of [
      { x: 0, y: 0 },
      { x: 800, y: 600 },
      { x: 137, y: 421 },
      { x: -200, y: 900 },
    ]) {
      const { direction } = cam.logicalToRay(point);
      expect(Math.hypot(direction.x, direction.y, direction.z)).toBeCloseTo(
        1,
        12,
      );
    }
  });

  it("aims right and up for a point right of and above the centre", () => {
    const ray = camera().logicalToRay({ x: 700, y: 100 });

    expect(ray.direction.x).toBeGreaterThan(0);
    // Logical `y` runs down, so a smaller `y` is higher in the world.
    expect(ray.direction.y).toBeGreaterThan(0);
    expect(ray.direction.z).toBeLessThan(0);
  });

  it("is the inverse of worldToLogical for any point in front of the camera", () => {
    const cam = camera();
    cam.position = { x: 3, y: 4, z: 12 };
    cam.lookAt({ x: 0, y: 0, z: 0 });

    for (const point of [
      { x: 0, y: 0, z: 0 },
      { x: 2, y: -1, z: -5 },
      { x: -7, y: 3, z: 4 },
    ]) {
      const at = cam.worldToLogical(point);
      const ray = cam.logicalToRay({ x: at.x, y: at.y });
      expect(liesOn(ray, point, 1e-5)).toBe(true);
    }
  });

  it("picks the ground plane the camera is aimed at", () => {
    const cam = camera();
    cam.position = { x: 0, y: 10, z: 10 };
    cam.lookAt({ x: 0, y: 0, z: 0 });

    const ray = cam.logicalToRay({ x: 400, y: 300 });
    // Where the centre of the picture meets `y = 0`, which is the pick a
    // click on the ground resolves to.
    const t = -ray.origin.y / ray.direction.y;
    const hit = {
      x: ray.origin.x + ray.direction.x * t,
      y: ray.origin.y + ray.direction.y * t,
      z: ray.origin.z + ray.direction.z * t,
    };

    expect(hit.x).toBeCloseTo(0, 6);
    expect(hit.y).toBeCloseTo(0, 6);
    expect(hit.z).toBeCloseTo(0, 6);
  });

  it("casts a well-defined ray for a point inside a letterbox bar", () => {
    // A logical point outside `0..width` is not an error: the line through it is
    // perfectly well defined, and whether to treat it as a miss is the game's
    // decision rather than the engine's.
    const ray = camera().logicalToRay({ x: -120, y: 300 });

    expect(ray.direction.x).toBeLessThan(0);
    expect(
      Math.hypot(ray.direction.x, ray.direction.y, ray.direction.z),
    ).toBeCloseTo(1, 12);
  });

  it("hands each caller a fresh result, and does not alias the camera's pose", () => {
    const cam = camera();

    const ray = cam.logicalToRay({ x: 400, y: 300 });
    ray.origin.z = 99;

    expect(cam.position.z).toBe(10);
    expect(cam.logicalToRay({ x: 400, y: 300 }).origin.z).toBe(10);
  });
});

describe("logicalToRay, orthographic", () => {
  function ortho(): WorldCamera {
    const cam = camera();
    cam.projection = "orthographic";
    return cam;
  }

  it("starts on the near plane at that logical point and looks along the view axis", () => {
    const cam = ortho();

    const ray = cam.logicalToRay({ x: 400, y: 300 });

    // The specification places the origin on the near plane, `near` world units
    // in front of the camera, not in the camera's own plane.
    expect(ray.origin.x).toBeCloseTo(0, 9);
    expect(ray.origin.y).toBeCloseTo(0, 9);
    expect(ray.origin.z).toBeCloseTo(10 - cam.near, 6);
    expect(ray.direction.z).toBeCloseTo(-1, 9);
  });

  it("moves the origin with the logical point rather than the direction", () => {
    const cam = ortho();

    const left = cam.logicalToRay({ x: 200, y: 300 });
    const right = cam.logicalToRay({ x: 600, y: 300 });

    // Parallel lines: the picture is the same size at every depth, so a logical
    // point picks *where* the line is rather than which way it goes.
    expect(left.origin.x).toBeCloseTo(-200, 6);
    expect(right.origin.x).toBeCloseTo(200, 6);
    expect(left.direction).toEqual(right.direction);
  });

  it("flips logical y into world up, as the projection does", () => {
    const cam = ortho();

    expect(cam.logicalToRay({ x: 400, y: 100 }).origin.y).toBeCloseTo(200, 6);
    expect(cam.logicalToRay({ x: 400, y: 500 }).origin.y).toBeCloseTo(-200, 6);
  });

  it("returns a unit direction under a rotated camera", () => {
    const cam = ortho();
    cam.rotation = quatFromAxisAngle({ x: 1, y: 0, z: 0 }, -Math.PI / 3);

    const { direction } = cam.logicalToRay({ x: 250, y: 480 });

    expect(Math.hypot(direction.x, direction.y, direction.z)).toBeCloseTo(
      1,
      12,
    );
    // The camera's own forward axis, whatever the logical point.
    const forward = quatRotate(cam.rotation, { x: 0, y: 0, z: -1 });
    expect(direction.x).toBeCloseTo(forward.x, 9);
    expect(direction.y).toBeCloseTo(forward.y, 9);
    expect(direction.z).toBeCloseTo(forward.z, 9);
  });

  it("is the inverse of worldToLogical", () => {
    const cam = ortho();
    cam.position = { x: 2, y: 6, z: 14 };
    cam.lookAt({ x: 0, y: 0, z: 0 });

    for (const point of [
      { x: 0, y: 0, z: 0 },
      { x: 5, y: -2, z: 1 },
      { x: -3, y: 4, z: -6 },
    ]) {
      const at = cam.worldToLogical(point);
      const ray = cam.logicalToRay({ x: at.x, y: at.y });
      expect(liesOn(ray, point, 1e-5)).toBe(true);
    }
  });

  it("maps a point inside a letterbox bar outside the camera's extents", () => {
    const cam = ortho();

    const ray = cam.logicalToRay({ x: 900, y: 300 });

    expect(ray.origin.x).toBeGreaterThan(cam.snapshot().right);
  });
});

/* -------------------------------------------------------------------------- */
/* lookAt                                                                     */
/* -------------------------------------------------------------------------- */

describe("lookAt", () => {
  it("writes a rotation that puts the point at the centre of the field", () => {
    const cam = camera();
    cam.position = { x: 12, y: 8, z: -3 };

    cam.lookAt({ x: 1, y: 2, z: 3 });

    const at = cam.worldToLogical({ x: 1, y: 2, z: 3 });
    expect(at.x).toBeCloseTo(400, 6);
    expect(at.y).toBeCloseTo(300, 6);
  });

  it("leaves the camera level, its local +Y as near world up as the view allows", () => {
    const cam = camera();
    cam.position = { x: 0, y: 5, z: 5 };

    cam.lookAt({ x: 0, y: 0, z: 0 });

    // A point directly above the target draws above the centre of the field.
    const above = cam.worldToLogical({ x: 0, y: 1, z: 0 });
    expect(above.y).toBeLessThan(300);
    expect(above.x).toBeCloseTo(400, 6);
  });

  it("takes an up axis, which decides the roll about the view direction", () => {
    const rolled = camera();
    rolled.position = { x: 0, y: 0, z: 10 };

    rolled.lookAt({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });

    // With world `+X` as up, a point at world `+X` draws above the centre.
    const at = rolled.worldToLogical({ x: 1, y: 0, z: 0 });
    expect(at.y).toBeLessThan(300);
    expect(at.x).toBeCloseTo(400, 6);
  });

  it("defaults up to the world's own up axis", () => {
    const explicit = camera();
    const implicit = camera();
    explicit.position = { x: 4, y: 4, z: 4 };
    implicit.position = { x: 4, y: 4, z: 4 };

    explicit.lookAt({ x: 0, y: 0, z: 0 }, UP);
    implicit.lookAt({ x: 0, y: 0, z: 0 });

    expect(implicit.rotation).toEqual(explicit.rotation);
  });

  it("survives an overhead view, where every roll is equally near up", () => {
    const cam = camera();
    cam.position = { x: 0, y: 20, z: 0 };

    cam.lookAt({ x: 0, y: 0, z: 0 });

    // A zero cross product would be a `NaN` in the view matrix and a blank
    // picture; a stable perpendicular is picked instead.
    const at = cam.worldToLogical({ x: 0, y: 0, z: 0 });
    expect(Number.isFinite(at.x)).toBe(true);
    expect(at.x).toBeCloseTo(400, 6);
    expect(at.y).toBeCloseTo(300, 6);
    expect(at.visible).toBe(true);
  });

  it("leaves the rotation at the identity for a point on the camera itself", () => {
    const cam = camera();

    cam.lookAt({ x: 0, y: 0, z: 10 });

    expect(cam.rotation).toEqual({ x: 0, y: 0, z: 0, w: 1 });
  });

  it("replaces the rotation rather than composing onto it", () => {
    const cam = camera();
    cam.rotation = quatFromAxisAngle(UP, 1.1);

    cam.lookAt({ x: 0, y: 0, z: 0 });
    const once = { ...cam.rotation };
    cam.lookAt({ x: 0, y: 0, z: 0 });

    expect(cam.rotation).toEqual(once);
  });
});

/* -------------------------------------------------------------------------- */
/* Following a view target                                                    */
/* -------------------------------------------------------------------------- */

describe("follow", () => {
  it("sets and clears the target", () => {
    const cam = camera();
    const { actor } = viewTarget();

    cam.follow(actor);
    expect(cam.target).toBe(actor);

    cam.follow(null);
    expect(cam.target).toBeNull();
  });

  it("returns the pose to the game when the target is cleared", () => {
    const cam = camera();
    const { actor } = viewTarget();
    actor.transform.position = { x: 4, y: 0, z: 0 };
    cam.follow(actor);
    updateCamera(cam);
    expect(cam.position.x).toBe(4);

    cam.follow(null);
    cam.position = { x: -9, y: 0, z: 0 };
    updateCamera(cam);

    expect(cam.position.x).toBe(-9);
  });
});

describe("updateCamera and a view target", () => {
  it("adopts the component's world transform and field of view", () => {
    const cam = camera();
    const { actor, lens } = viewTarget(35);
    actor.transform.position = { x: 1, y: 2, z: 3 };
    cam.follow(actor);

    updateCamera(cam);

    expect(cam.position).toEqual({ x: 1, y: 2, z: 3 });
    expect(cam.fov).toBe(35);
    expect(lens.fov).toBe(35);
  });

  it("composes the component's offset with the actor's transform", () => {
    const cam = camera();
    const { actor, lens } = viewTarget();
    actor.transform.position = { x: 0, y: 0, z: 0 };
    actor.transform.rotation = quatFromAxisAngle(UP, Math.PI / 2);
    lens.offset.position = { x: 0, y: 2, z: 6 };
    cam.follow(actor);

    updateCamera(cam);

    // A chase camera rides the pawn's frame and turns with it: an offset behind
    // and above becomes, after a quarter turn about `+Y`, an offset along `+X`.
    expect(cam.position.x).toBeCloseTo(6, 9);
    expect(cam.position.y).toBeCloseTo(2, 9);
    expect(cam.position.z).toBeCloseTo(0, 9);
  });

  it("takes the rotation as well, so the picture turns with the target", () => {
    const cam = camera();
    const { actor } = viewTarget();
    actor.transform.rotation = quatFromAxisAngle(UP, Math.PI);
    cam.follow(actor);

    updateCamera(cam);

    expect(cam.rotation.y).toBeCloseTo(1, 9);
    expect(cam.rotation.w).toBeCloseTo(0, 9);
  });

  it("takes the first enabled CameraComponent, skipping a disabled one", () => {
    const cam = camera();
    const actor = new Actor();
    const first = actor.attach(new CameraComponent({ fov: 10 }));
    actor.attach(new CameraComponent({ fov: 20 }));
    first.enabled = false;
    cam.follow(actor);

    updateCamera(cam);

    expect(cam.fov).toBe(20);
  });

  it("takes the first of several enabled components, in attachment order", () => {
    const cam = camera();
    const actor = new Actor();
    actor.attach(new CameraComponent({ fov: 10 }));
    actor.attach(new CameraComponent({ fov: 20 }));
    cam.follow(actor);

    updateCamera(cam);

    expect(cam.fov).toBe(10);
  });

  it("leaves the pose where the game wrote it for a target with no such component", () => {
    const cam = camera();
    const actor = new Actor();
    actor.transform.position = { x: 50, y: 50, z: 50 };
    cam.follow(actor);
    cam.position = { x: 1, y: 1, z: 1 };

    updateCamera(cam);

    expect(cam.position).toEqual({ x: 1, y: 1, z: 1 });
  });

  it("leaves the pose alone when the target has been destroyed", () => {
    const cam = camera();
    const { actor } = viewTarget();
    actor.transform.position = { x: 9, y: 9, z: 9 };
    cam.follow(actor);
    cam.position = { x: 1, y: 1, z: 1 };

    actor.destroy();
    updateCamera(cam);

    // The camera does not lurch to the origin when its subject dies.
    expect(cam.position).toEqual({ x: 1, y: 1, z: 1 });
  });

  it("does not alias the target's own transform", () => {
    const cam = camera();
    const { actor } = viewTarget();
    actor.transform.position = { x: 3, y: 0, z: 0 };
    cam.follow(actor);
    updateCamera(cam);

    cam.position.x = 100;

    // Writing the camera's pose must not move the actor the camera watches.
    expect(actor.transform.position.x).toBe(3);
  });

  it("tracks the target frame by frame", () => {
    const cam = camera();
    const { actor } = viewTarget();
    cam.follow(actor);

    const seen: number[] = [];
    for (let frame = 0; frame < 4; frame += 1) {
      actor.transform.position = { x: frame, y: 0, z: 0 };
      updateCamera(cam);
      seen.push(cam.position.x);
    }

    expect(seen).toEqual([0, 1, 2, 3]);
  });

  it("moves the projection the pipeline renders through, not just the record", () => {
    const cam = camera();
    const { actor } = viewTarget();
    actor.transform.position = { x: 0, y: 0, z: 10 };
    cam.follow(actor);
    updateCamera(cam);

    // Following put the eye where the default camera stood, so the origin is
    // back at the centre of the field.
    const at = cam.worldToLogical({ x: 0, y: 0, z: 0 });
    expect(at.x).toBeCloseTo(400, 6);
    expect(at.visible).toBe(true);
  });
});

describe("updateCamera and bounds", () => {
  it("does nothing without bounds", () => {
    const cam = camera();
    cam.position = { x: 500, y: -400, z: 900 };

    updateCamera(cam);

    expect(cam.position).toEqual({ x: 500, y: -400, z: 900 });
  });

  it("clamps each axis of the position on its own", () => {
    const cam = camera();
    cam.bounds = {
      min: { x: -10, y: 0, z: -10 },
      max: { x: 10, y: 5, z: 10 },
    };
    cam.position = { x: 40, y: 2, z: -60 };

    updateCamera(cam);

    // `x` and `z` are pulled to the box; `y` was already inside and is untouched.
    expect(cam.position).toEqual({ x: 10, y: 2, z: -10 });
  });

  it("leaves the projection as it stands, so the camera keeps looking where it looked", () => {
    const cam = camera();
    cam.rotation = quatFromAxisAngle(UP, 0.4);
    cam.fov = 42;
    cam.bounds = { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } };
    cam.position = { x: 50, y: 0, z: 0 };
    const before = { ...cam.rotation };

    updateCamera(cam);

    expect(cam.rotation).toEqual(before);
    expect(cam.fov).toBe(42);
  });

  it("clamps a hand-driven camera as readily as a following one", () => {
    const cam = camera();
    cam.bounds = { min: { x: 0, y: 0, z: 0 }, max: { x: 4, y: 4, z: 4 } };
    cam.position = { x: -3, y: 9, z: 2 };

    updateCamera(cam);

    expect(cam.position).toEqual({ x: 0, y: 4, z: 2 });
  });

  it("runs after a followed target has been adopted", () => {
    const cam = camera();
    const { actor } = viewTarget();
    actor.transform.position = { x: 100, y: 0, z: 0 };
    cam.follow(actor);
    cam.bounds = {
      min: { x: -20, y: -20, z: -20 },
      max: { x: 20, y: 20, z: 20 },
    };

    updateCamera(cam);

    // A camera that reaches the edge of a level stops moving; a clamp that ran
    // first would be overwritten by the adoption and do nothing at all.
    expect(cam.position.x).toBe(20);
  });

  it("writes a fresh record rather than clamping through one the game shares", () => {
    const cam = camera();
    const shared = { x: 50, y: 0, z: 0 };
    cam.position = shared;
    cam.bounds = { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } };

    updateCamera(cam);

    // `camera.position = actor.transform.position` is an ordinary way to pin the
    // camera to an actor, and clamping in place would move the actor.
    expect(shared.x).toBe(50);
    expect(cam.position.x).toBe(1);
  });

  it("pins an axis to max for a box inverted on it, rather than reporting NaN", () => {
    const cam = camera();
    cam.bounds = { min: { x: 5, y: 0, z: 0 }, max: { x: -5, y: 0, z: 0 } };
    cam.position = { x: 0, y: 0, z: 0 };

    updateCamera(cam);

    // A camera that stops moving is a far easier symptom to trace than a `NaN`
    // in the view matrix.
    expect(cam.position.x).toBe(-5);
    expect(Number.isNaN(cam.position.x)).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* The three camera the pipeline renders through                              */
/* -------------------------------------------------------------------------- */

describe("cameraObject", () => {
  it("builds a perspective camera at the design aspect, not the canvas's", () => {
    const cam = camera(1280, 720);

    const object = cameraObject(cam, 1280, 720);

    expect(object).toBeInstanceOf(THREE.PerspectiveCamera);
    const perspective = object as THREE.PerspectiveCamera;
    expect(perspective.fov).toBe(60);
    expect(perspective.aspect).toBeCloseTo(1280 / 720, 12);
    expect(perspective.near).toBe(0.1);
    expect(perspective.far).toBe(1000);
    expect(perspective.zoom).toBe(1);
  });

  it("builds an orthographic box spanning orthoHeight vertically", () => {
    const cam = camera();
    cam.projection = "orthographic";

    const object = cameraObject(cam, W, H) as THREE.OrthographicCamera;

    expect(object).toBeInstanceOf(THREE.OrthographicCamera);
    expect(object.top).toBe(300);
    expect(object.bottom).toBe(-300);
    expect(object.right).toBeCloseTo(400, 9);
    expect(object.left).toBeCloseTo(-400, 9);
  });

  it("pushes the record's pose onto the object", () => {
    const cam = camera();
    cam.position = { x: 1, y: -2, z: 3 };
    cam.rotation = quatFromAxisAngle(UP, Math.PI / 4);

    const object = cameraObject(cam, W, H);

    expect([object.position.x, object.position.y, object.position.z]).toEqual([
      1, -2, 3,
    ]);
    expect(object.quaternion.y).toBeCloseTo(Math.sin(Math.PI / 8), 12);
    expect(object.scale.toArray()).toEqual([1, 1, 1]);
  });

  it("leaves the object with a current world matrix and projection matrix", () => {
    const cam = camera();
    cam.position = { x: 0, y: 4, z: 0 };
    cam.lookAt({ x: 0, y: 0, z: 0 });

    const object = cameraObject(cam, W, H);

    // The renderer draws from these two without touching them again, and the
    // projection arithmetic above reads the very same pair.
    const inverse = new THREE.Matrix4()
      .copy(object.matrixWorld)
      .invert().elements;
    expect(object.matrixWorldInverse.elements).toEqual(inverse);
    expect(object.projectionMatrix.elements.some((n) => n !== 0)).toBe(true);
  });

  it("returns the same object for a camera across frames", () => {
    const cam = camera();

    expect(cameraObject(cam, W, H)).toBe(cameraObject(cam, W, H));
  });

  it("gives each camera its own objects, so a transition takes its own with it", () => {
    expect(cameraObject(camera(), W, H)).not.toBe(cameraObject(camera(), W, H));
  });

  it("switches which object it answers with when the game switches projection", () => {
    const cam = camera();
    const perspective = cameraObject(cam, W, H);

    cam.projection = "orthographic";
    const orthographic = cameraObject(cam, W, H);
    cam.projection = "perspective";

    expect(orthographic).not.toBe(perspective);
    expect(orthographic).toBeInstanceOf(THREE.OrthographicCamera);
    // Switching back costs no allocation: both were built on the first call.
    expect(cameraObject(cam, W, H)).toBe(perspective);
  });

  it("brings the object up to date with a field the game wrote since", () => {
    const cam = camera();
    const object = cameraObject(cam, W, H) as THREE.PerspectiveCamera;
    expect(object.fov).toBe(60);

    cam.fov = 25;
    cam.near = 1;

    expect((cameraObject(cam, W, H) as THREE.PerspectiveCamera).fov).toBe(25);
    expect(object.near).toBe(1);
  });

  it("holds a nonsense design size at an aspect of 1 rather than NaN", () => {
    const cam = camera();

    const object = cameraObject(cam, 0, 0) as THREE.PerspectiveCamera;

    expect(object.aspect).toBe(1);
  });

  it("derives from the Camera interface, not from WorldCamera", () => {
    // The pipeline types against the interface and must render whatever
    // implementation a world carries, so the derivation is keyed by the record.
    const plain = {
      position: { x: 0, y: 0, z: 4 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      projection: "orthographic",
      fov: 60,
      near: 0.5,
      far: 50,
      orthoHeight: 8,
      bounds: null,
      target: null,
    } as unknown as Camera;

    const object = cameraObject(plain, W, H) as THREE.OrthographicCamera;

    expect(object).toBeInstanceOf(THREE.OrthographicCamera);
    expect(object.top).toBe(4);
    expect(object.near).toBe(0.5);
    expect(object.position.z).toBe(4);
  });
});

describe("the world pass draws through both halves at once", () => {
  it("renders the scene through the object the projection arithmetic answered from", () => {
    const { renderer, stub } = buildRenderer();
    const cam = camera();
    const scene = new THREE.Scene();
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial(),
    );
    scene.add(mesh);
    const vp = fitViewport(W, H, 500, 375, 2);

    applyRendererViewport(renderer, vp);
    stub.gl.forget();
    renderer.render(scene, cameraObject(cam, W, H));

    // The mesh is at the origin, which `worldToLogical` puts in the middle of
    // the field — and something really was drawn there.
    expect(cam.worldToLogical({ x: 0, y: 0, z: 0 }).visible).toBe(true);
    expect(renderer.info.render.calls).toBeGreaterThan(0);
    // Rendering does not disturb the letterboxed rectangle the frame set up.
    const viewport = renderer.getViewport(new THREE.Vector4());
    expect([viewport.x, viewport.y, viewport.z, viewport.w]).toEqual([
      0, 0, 1000, 750,
    ]);
    expect(renderer.getScissorTest()).toBe(true);
  });

  it("draws nothing for a mesh the camera reports as out of view", () => {
    const { renderer } = buildRenderer();
    const cam = camera();
    const scene = new THREE.Scene();
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial(),
    );
    // Behind the eye, which is exactly the case a naive `-1..1` test on the
    // divided coordinates gets wrong.
    mesh.position.set(0, 0, 40);
    scene.add(mesh);

    applyRendererViewport(renderer, fitViewport(W, H, 500, 375, 2));
    renderer.render(scene, cameraObject(cam, W, H));

    expect(cam.worldToLogical({ x: 0, y: 0, z: 40 }).visible).toBe(false);
    expect(renderer.info.render.calls).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* The two maps composed                                                      */
/* -------------------------------------------------------------------------- */

describe("the composition a validator checks a claim through", () => {
  it("takes a world point to a device pixel and the pixel back to a ray", () => {
    const cam = camera();
    cam.position = { x: 0, y: 6, z: 12 };
    cam.lookAt({ x: 0, y: 0, z: 0 });
    const vp = fitViewport(W, H, 1000, 600, 2);
    const point = { x: 1.5, y: 0.5, z: -2 };

    const at = cam.worldToLogical(point);
    const device = {
      x: vp.offsetX + at.x * vp.scale,
      y: vp.offsetY + at.y * vp.scale,
    };
    const back = {
      x: (device.x - vp.offsetX) / vp.scale,
      y: (device.y - vp.offsetY) / vp.scale,
    };
    const ray = cam.logicalToRay(back);

    expect(at.visible).toBe(true);
    expect(back.x).toBeCloseTo(at.x, 9);
    expect(back.y).toBeCloseTo(at.y, 9);
    // The line the device pixel picks along passes through the world point that
    // was drawn there, which is the whole claim the two maps make together.
    expect(liesOn(ray, point, 1e-5)).toBe(true);
  });

  it("agrees at any design size, not only at 4:3", () => {
    for (const [width, height] of [
      [1280, 720],
      [640, 640],
      [375, 812],
    ] as Array<[number, number]>) {
      const cam = camera(width, height);
      const centre = cam.worldToLogical({ x: 0, y: 0, z: 0 });
      expect(centre.x).toBeCloseTo(width / 2, 6);
      expect(centre.y).toBeCloseTo(height / 2, 6);

      const ray = cam.logicalToRay({ x: width / 2, y: height / 2 });
      expect(ray.direction.z).toBeCloseTo(-1, 9);
    }
  });

  it("holds the picture at the design aspect whatever the container's is", () => {
    const cam = camera(1280, 720);
    const object = cameraObject(cam, 1280, 720) as THREE.PerspectiveCamera;

    // The container is square; the fit letterboxes, and the projection is left
    // at the design ratio so the picture and `worldToLogical` agree.
    const vp = fitViewport(1280, 720, 900, 900, 1);
    expect(vp.offsetY).toBeGreaterThan(0);
    expect(object.aspect).toBeCloseTo(1280 / 720, 12);
  });
});

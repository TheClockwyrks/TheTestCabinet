import * as THREE from "three";
import { afterEach, describe, expect, it } from "vitest";
import type { SurfaceMetrics } from "./contract";
import { createStubCanvas } from "./testing/canvas";
import {
  applyRendererViewport,
  applyViewport,
  domSurface,
  fitViewport,
  syncCanvas,
  syncScreenCanvas,
  viewportRect,
} from "./viewport";

/**
 * A surface reporting fixed figures, which is what the engine is handed by a
 * validator and what makes every assertion below exact rather than dependent on the
 * machine the suite runs on.
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

/** A canvas laid out at a known CSS size — jsdom performs no layout, so we say so. */
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
 * multiplies by its own pixel ratio, rounds, and suppresses a call that would not
 * change the state. A double would agree with whatever this module happened to do.
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

describe("fitViewport", () => {
  it("letterboxes horizontally when the container is wider than the logical field", () => {
    const vp = fitViewport(800, 600, 1000, 600, 1);

    // Height is the binding axis, so the scale is 1 and the 200 spare CSS pixels
    // become two equal bars.
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

    // Width binds: 500/800 = 0.625, which leaves 500 - 375 = 125 vertical pixels
    // split into two bars of 62.5. Rounding the scale to 1 would clip the field;
    // rounding it to 0 would draw nothing.
    expect(vp.scale).toBeCloseTo(0.625, 12);
    expect(vp.offsetX).toBeCloseTo(0, 12);
    expect(vp.offsetY).toBeCloseTo(62.5, 12);
  });

  it("folds a device pixel ratio above 1 into the scale and the bars", () => {
    const vp = fitViewport(800, 600, 1000, 600, 2);

    // The fit ratio is still 1, but a logical unit is now two device pixels, and the
    // bars are measured in the same device pixels.
    expect(vp.scale).toBeCloseTo(2, 6);
    expect(vp.offsetX).toBeCloseTo(200, 6);
    expect(vp.offsetY).toBeCloseTo(0, 6);
  });

  it("folds a fractional device pixel ratio in without leaving a seam", () => {
    const vp = fitViewport(800, 600, 500, 500, 1.5);

    expect(vp.scale).toBeCloseTo(0.9375, 12);
    // The bars are centred against the rounded device size the backing store is
    // written at, so they sum to it exactly rather than to the unrounded product.
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

  it("centres the field: the two bars on the binding axis are equal", () => {
    // Stated on its own because the renderer's rectangle depends on it. A GL
    // viewport is measured from the bottom edge and a canvas transform from the
    // top, and it is only this equality that lets one `offsetY` serve both.
    for (const [cssW, cssH, dpr] of [
      [1000, 600, 1],
      [800, 900, 2],
      [500, 500, 1.5],
      [321, 977, 3],
    ] as const) {
      const vp = fitViewport(800, 600, cssW, cssH, dpr);
      const deviceW = Math.round(cssW * dpr);
      const deviceH = Math.round(cssH * dpr);

      expect(deviceW - vp.offsetX - vp.width * vp.scale).toBeCloseTo(
        vp.offsetX,
        9,
      );
      expect(deviceH - vp.offsetY - vp.height * vp.scale).toBeCloseTo(
        vp.offsetY,
        9,
      );
    }
  });

  it("yields a finite, zero-scale viewport for a container with no size", () => {
    const vp = fitViewport(800, 600, 0, 0, 1);

    expect(vp.scale).toBe(0);
    expect(Number.isNaN(vp.offsetX)).toBe(false);
    expect(Number.isNaN(vp.offsetY)).toBe(false);
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

    // A bad ratio falls back to 1 rather than collapsing an otherwise valid fit.
    expect(fitViewport(800, 600, 800, 600, 0).scale).toBeCloseTo(1, 6);
    expect(fitViewport(800, 600, 800, 600, Number.NaN).scale).toBeCloseTo(1, 6);
  });

  it("returns a fresh viewport each call, so a held one keeps its frame's values", () => {
    const first = fitViewport(800, 600, 1000, 600, 1);
    const second = fitViewport(800, 600, 1000, 600, 1);

    expect(first).not.toBe(second);
    expect(first).toEqual(second);
  });
});

describe("the logical-to-device mapping", () => {
  // The arithmetic a validator repeats to name the device pixel a logical point
  // drew into: `offsetX + x * scale`. If this drifts, every pixel check drifts with
  // it, so it is asserted here directly rather than only through the transform.
  const map = (vp: { scale: number; offsetX: number; offsetY: number }) => ({
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

    // 1000 CSS px at a ratio of 2 is 2000 device px; the field ends 200 short of it.
    expect(at.x(800)).toBeCloseTo(1800, 9);
    expect(at.y(600)).toBeCloseTo(1200, 9);
  });

  it("puts the logical centre at the centre of the backing store", () => {
    const vp = fitViewport(800, 600, 500, 500, 1.5);
    const at = map(vp);

    expect(at.x(400)).toBeCloseTo(Math.round(500 * 1.5) / 2, 9);
    expect(at.y(300)).toBeCloseTo(Math.round(500 * 1.5) / 2, 9);
  });

  it("round-trips a device point back through the inverse map", () => {
    const vp = fitViewport(800, 600, 1000, 600, 2);
    const at = map(vp);

    for (const logical of [0, 1, 123.5, 799]) {
      expect((at.x(logical) - vp.offsetX) / vp.scale).toBeCloseTo(logical, 9);
    }
  });

  it("takes a CSS-pixel pointer position to logical through the same scale", () => {
    // The documented pointer map, `(cssX * dpr - offsetX) / scale`, which is what
    // the input module applies before a game ever sees a position.
    const dpr = 2;
    const vp = fitViewport(800, 600, 1000, 600, dpr);

    expect((100 * dpr - vp.offsetX) / vp.scale).toBeCloseTo(0, 9);
    expect((600 * dpr - vp.offsetX) / vp.scale).toBeCloseTo(500, 9);
    expect((300 * dpr - vp.offsetY) / vp.scale).toBeCloseTo(300, 9);
  });

  it("is the transform applyViewport installs", () => {
    const vp = fitViewport(800, 600, 500, 500, 1.5);
    const { ctx, calls } = recordingContext();

    applyViewport(ctx, vp);

    // `setTransform(a, b, c, d, e, f)` maps x to `a * x + e`, which is the same
    // `offsetX + x * scale` a validator computes by hand.
    expect(calls).toEqual([[vp.scale, 0, 0, vp.scale, vp.offsetX, vp.offsetY]]);
  });
});

describe("applyViewport", () => {
  it("maps logical coordinates onto the letterboxed device pixels", () => {
    const vp = fitViewport(800, 600, 1000, 600, 2);
    const { ctx, calls } = recordingContext();

    applyViewport(ctx, vp);

    expect(calls).toEqual([[2, 0, 0, 2, 200, 0]]);
  });

  it("replaces the transform instead of compounding it across frames", () => {
    const vp = fitViewport(800, 600, 800, 600, 1);
    const { ctx, calls } = recordingContext();

    applyViewport(ctx, vp);
    applyViewport(ctx, vp);
    applyViewport(ctx, vp);

    // Three frames, three identical absolute transforms — a `scale()` per frame
    // would have shrunk the picture to a third by now.
    expect(calls).toHaveLength(3);
    expect(new Set(calls.map((c) => c.join(",")))).toEqual(
      new Set([[1, 0, 0, 1, 0, 0].join(",")]),
    );
  });

  it("installs a degenerate transform rather than an infinite one", () => {
    const vp = fitViewport(800, 600, 0, 0, 2);
    const { ctx, calls } = recordingContext();

    applyViewport(ctx, vp);

    // A zero scale draws nothing. A `NaN` in the transform would leave the context
    // in a state where every later draw silently no-ops, with nothing to trace.
    expect(calls).toEqual([[0, 0, 0, 0, 0, 0]]);
  });
});

describe("viewportRect", () => {
  it("is the letterboxed rectangle in device pixels", () => {
    const vp = fitViewport(800, 600, 1000, 600, 2);

    expect(viewportRect(vp)).toEqual({
      x: 200,
      y: 0,
      width: 1600,
      height: 1200,
    });
  });

  it("names the same region the screen layer's transform maps onto", () => {
    const vp = fitViewport(800, 600, 500, 500, 1.5);
    const rect = viewportRect(vp);

    // The logical corners, mapped by hand, are the rectangle's corners: this is the
    // agreement the whole design rests on — the HUD lands on the picture.
    expect(vp.offsetX + 0 * vp.scale).toBeCloseTo(rect.x, 9);
    expect(vp.offsetY + 0 * vp.scale).toBeCloseTo(rect.y, 9);
    expect(vp.offsetX + vp.width * vp.scale).toBeCloseTo(rect.x + rect.width, 9);
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
    const rect = viewportRect(fitViewport(800, 600, 0, 0, 2));

    expect(rect).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it("covers the whole backing store when the aspect ratios agree", () => {
    const vp = fitViewport(800, 600, 400, 300, 2);

    expect(viewportRect(vp)).toEqual({ x: 0, y: 0, width: 800, height: 600 });
  });
});

describe("applyRendererViewport", () => {
  it("sets the renderer's viewport and scissor to the letterboxed rectangle", () => {
    const { renderer } = buildRenderer();
    const vp = fitViewport(800, 600, 1000, 600, 2);

    applyRendererViewport(renderer, vp);

    const viewport = renderer.getViewport(new THREE.Vector4());
    const scissor = renderer.getScissor(new THREE.Vector4());
    expect([viewport.x, viewport.y, viewport.z, viewport.w]).toEqual([
      200, 0, 1600, 1200,
    ]);
    expect([scissor.x, scissor.y, scissor.z, scissor.w]).toEqual([
      200, 0, 1600, 1200,
    ]);
  });

  it("turns the scissor test on, so the bars keep the background clear", () => {
    const { renderer, stub } = buildRenderer();
    stub.gl.forget();

    applyRendererViewport(renderer, fitViewport(800, 600, 1000, 600, 2));

    expect(renderer.getScissorTest()).toBe(true);
    // Without the enable, the scene's own clear would paint over the letterbox
    // bars and the configured background would never be seen.
    const enables = stub.gl
      .callsTo("enable")
      .map((call) => stub.gl.constantName(call.args[0] as number));
    expect(enables).toContain("SCISSOR_TEST");
  });

  it("reaches GL as the device-pixel rectangle, rounded", () => {
    const { renderer, stub } = buildRenderer();
    stub.gl.forget();
    const vp = fitViewport(800, 600, 500, 500, 1.5);

    applyRendererViewport(renderer, vp);

    // 750×750 device pixels, a 750×562.5 picture centred vertically. three rounds
    // on the way to GL; what matters is that nothing else scaled it first.
    expect(stub.gl.lastCall("viewport")?.args).toEqual([0, 94, 750, 563]);
    expect(stub.gl.lastCall("scissor")?.args).toEqual([0, 94, 750, 563]);
  });

  it("assumes the renderer's own pixel ratio is 1, since the fit already folded it in", () => {
    const { renderer, stub } = buildRenderer();
    stub.gl.forget();

    // A renderer left at its default ratio multiplies by 1, so the rectangle
    // reaches GL unchanged. Were the ratio set to the device's, the picture would
    // be placed at `dpr` squared.
    expect(renderer.getPixelRatio()).toBe(1);

    applyRendererViewport(renderer, fitViewport(800, 600, 400, 300, 2));

    expect(stub.gl.lastCall("viewport")?.args).toEqual([0, 0, 800, 600]);
  });

  it("re-sets the same rectangle every frame without disturbing it", () => {
    const { renderer } = buildRenderer();
    const vp = fitViewport(800, 600, 1000, 600, 2);

    applyRendererViewport(renderer, vp);
    applyRendererViewport(renderer, vp);
    applyRendererViewport(renderer, vp);

    const viewport = renderer.getViewport(new THREE.Vector4());
    expect([viewport.x, viewport.y, viewport.z, viewport.w]).toEqual([
      200, 0, 1600, 1200,
    ]);
    expect(renderer.getScissorTest()).toBe(true);
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
    // Nothing is drawn, and nothing is drawn *wrong*: the frame lands nowhere and
    // the next one recovers as soon as the element has a size.
    expect(renderer.getScissorTest()).toBe(true);
  });
});

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

    expect(canvas.style.touchAction).toBe("pan-y");
    expect(canvas.style.userSelect).toBe("");
  });

  it("swallows the context menu and the wheel's page scroll while claimed", () => {
    const canvas = laidOutCanvas(400, 300);
    const give = domSurface(canvas).claimGestures?.();

    const menu = new Event("contextmenu", { cancelable: true });
    const scroll = new Event("wheel", { cancelable: true });
    canvas.dispatchEvent(menu);
    canvas.dispatchEvent(scroll);

    expect(menu.defaultPrevented).toBe(true);
    expect(scroll.defaultPrevented).toBe(true);

    give?.();

    const after = new Event("contextmenu", { cancelable: true });
    canvas.dispatchEvent(after);

    expect(after.defaultPrevented).toBe(false);
  });

  it("captures and releases a pointer on the element, and survives one that is gone", () => {
    const canvas = laidOutCanvas(400, 300);
    const captured: number[] = [];
    const released: number[] = [];
    canvas.setPointerCapture = (id: number): void => {
      captured.push(id);
    };
    canvas.releasePointerCapture = (id: number): void => {
      released.push(id);
      throw new Error("no such pointer");
    };
    const surface = domSurface(canvas);

    surface.capturePointer?.(7);
    surface.releasePointerCapture?.(7);

    expect(captured).toEqual([7]);
    expect(released).toEqual([7]);
  });
});

describe("syncCanvas", () => {
  it("takes its size and ratio from the surface, not from the element", () => {
    const canvas = laidOutCanvas(1, 1);
    Object.defineProperty(window, "devicePixelRatio", {
      value: 1,
      configurable: true,
    });

    const vp = syncCanvas(canvas, 800, 600, fixedSurface(400, 300, 3));

    // The element says 1×1 and the window says a ratio of 1; both are ignored.
    expect(canvas.width).toBe(1200);
    expect(canvas.height).toBe(900);
    // 400 CSS px across 800 logical units, tripled into device pixels.
    expect(vp.scale).toBeCloseTo(1.5, 9);
    expect(vp.offsetX).toBeCloseTo(0, 9);
  });

  it("writes the backing store only when it actually changed", () => {
    const canvas = laidOutCanvas(400, 300);
    const surface = fixedSurface(400, 300, 2);
    let stored = 0;
    let writes = 0;
    Object.defineProperty(canvas, "width", {
      get: () => stored,
      set: (value: number) => {
        writes += 1;
        stored = value;
      },
      configurable: true,
    });

    syncCanvas(canvas, 800, 600, surface);
    syncCanvas(canvas, 800, 600, surface);
    syncCanvas(canvas, 800, 600, surface);

    expect(stored).toBe(800);
    expect(writes).toBe(1);
  });

  it("rounds the backing store, and centres the bars against the rounded size", () => {
    const canvas = laidOutCanvas(501, 301);

    const vp = syncCanvas(canvas, 800, 600, fixedSurface(501, 301, 1.5));

    expect(canvas.width).toBe(Math.round(501 * 1.5));
    expect(canvas.height).toBe(Math.round(301 * 1.5));
    // The picture plus its two bars is the backing store exactly, on both axes.
    expect(vp.offsetX * 2 + vp.width * vp.scale).toBeCloseTo(canvas.width, 9);
    expect(vp.offsetY * 2 + vp.height * vp.scale).toBeCloseTo(canvas.height, 9);
  });

  it("keeps the last backing store when the surface reports no size", () => {
    const canvas = laidOutCanvas(400, 300);
    syncCanvas(canvas, 800, 600, fixedSurface(400, 300, 1));

    const vp = syncCanvas(canvas, 800, 600, fixedSurface(0, 0, 1));

    // The hidden frame draws nothing, but the previously rendered surface survives.
    expect(canvas.width).toBe(400);
    expect(canvas.height).toBe(300);
    expect(vp.scale).toBe(0);
  });

  it("keeps the last backing store when only one axis collapses", () => {
    const canvas = laidOutCanvas(400, 300);
    syncCanvas(canvas, 800, 600, fixedSurface(400, 300, 1));

    const vp = syncCanvas(canvas, 800, 600, fixedSurface(400, 0, 1));

    expect(canvas.width).toBe(400);
    expect(canvas.height).toBe(300);
    expect(vp.scale).toBe(0);
  });

  it("recovers the fit as soon as the surface has a size again", () => {
    const canvas = laidOutCanvas(400, 300);
    syncCanvas(canvas, 800, 600, fixedSurface(0, 0, 1));

    const vp = syncCanvas(canvas, 800, 600, fixedSurface(400, 300, 1));

    expect(canvas.width).toBe(400);
    expect(vp.scale).toBeCloseTo(0.5, 9);
  });

  it("survives a surface that reports nonsense, without resizing the canvas away", () => {
    const canvas = laidOutCanvas(400, 300);
    syncCanvas(canvas, 800, 600, fixedSurface(400, 300, 1));

    const vp = syncCanvas(
      canvas,
      800,
      600,
      fixedSurface(Number.NaN, Number.NaN, Number.NaN),
    );

    expect(canvas.width).toBe(400);
    expect(vp.scale).toBe(0);
    expect(Number.isFinite(vp.offsetX)).toBe(true);
  });
});

describe("syncCanvas and the CSS size", () => {
  it("pins a pixel size onto a canvas the page has not sized at all", () => {
    const canvas = document.createElement("canvas");
    // An unsized canvas takes its CSS size from its attributes, so the measurement
    // comes back equal to them. Without a pin, writing the backing store would feed
    // into the next measurement and the element would grow by `dpr` every frame.
    canvas.width = 300;
    canvas.height = 150;

    syncCanvas(canvas, 800, 600, fixedSurface(300, 150, 2));

    expect(canvas.style.width).toBe("300px");
    expect(canvas.style.height).toBe("150px");
    expect(canvas.width).toBe(600);
    expect(canvas.height).toBe(300);
  });

  it("does not let an unpinned canvas grow across repeated frames", () => {
    const canvas = document.createElement("canvas");
    canvas.width = 300;
    canvas.height = 150;

    // The surface models an element sized by its attributes: it reports whatever the
    // element's CSS size currently is, which is the pin once one exists and the
    // attributes until then. This is the runaway the pin exists to stop.
    const measure = (): { w: number; h: number } => {
      const pinned = Number.parseFloat(canvas.style.width);
      return Number.isFinite(pinned)
        ? { w: pinned, h: Number.parseFloat(canvas.style.height) }
        : { w: canvas.width, h: canvas.height };
    };
    const surface: SurfaceMetrics = {
      cssWidth: (): number => measure().w,
      cssHeight: (): number => measure().h,
      dpr: (): number => 2,
      events: (): EventTarget => new EventTarget(),
    };

    for (let i = 0; i < 10; i += 1) syncCanvas(canvas, 800, 600, surface);

    expect(canvas.width).toBe(600);
    expect(canvas.height).toBe(300);
    expect(canvas.style.width).toBe("300px");
  });

  it("leaves a canvas sized by a stylesheet alone, though its inline style is empty", () => {
    const canvas = document.createElement("canvas");
    canvas.width = 300;
    canvas.height = 150;
    // A stylesheet rule shows up as a measurement that differs from the attributes
    // and as an inline style that is still empty. Testing the inline style would pin
    // this canvas at 640×480 and it would never follow its container again.
    const surface = fixedSurface(640, 480, 1);

    syncCanvas(canvas, 800, 600, surface);

    expect(canvas.style.width).toBe("");
    expect(canvas.style.height).toBe("");
    expect(canvas.width).toBe(640);
    expect(canvas.height).toBe(480);
  });

  it("keeps following a stylesheet-sized container as it resizes", () => {
    const canvas = document.createElement("canvas");
    canvas.width = 300;
    canvas.height = 150;

    syncCanvas(canvas, 800, 600, fixedSurface(640, 480, 1));
    const vp = syncCanvas(canvas, 800, 600, fixedSurface(320, 240, 1));

    expect(canvas.style.width).toBe("");
    expect(canvas.width).toBe(320);
    expect(canvas.height).toBe(240);
    expect(vp.scale).toBeCloseTo(0.4, 9);
  });

  it("leaves an inline CSS size alone as well", () => {
    const canvas = document.createElement("canvas");
    canvas.width = 300;
    canvas.height = 150;
    canvas.style.width = "100%";
    canvas.style.height = "100%";

    syncCanvas(canvas, 800, 600, fixedSurface(640, 480, 1));

    expect(canvas.style.width).toBe("100%");
    expect(canvas.style.height).toBe("100%");
    expect(canvas.width).toBe(640);
  });

  it("writes no CSS size at all when the surface reports no size", () => {
    const canvas = document.createElement("canvas");
    canvas.width = 0;
    canvas.height = 0;

    syncCanvas(canvas, 800, 600, fixedSurface(0, 0, 1));

    expect(canvas.style.width).toBe("");
  });

  it("sizes a canvas that exposes no style at all, without touching one", () => {
    // A canvas driven headlessly behind a supplied surface — the arrangement a
    // validator uses — has no layout to feed back into and may expose no `style`.
    const headless = { width: 0, height: 0 } as unknown as HTMLCanvasElement;

    const vp = syncCanvas(headless, 800, 600, fixedSurface(400, 300, 2));

    expect(headless.width).toBe(800);
    expect(headless.height).toBe(600);
    expect(vp.scale).toBeCloseTo(1, 9);
  });
});

describe("syncScreenCanvas", () => {
  it("gives the screen canvas the stage canvas's backing store", () => {
    const stage = laidOutCanvas(400, 300);
    const screen = document.createElement("canvas");

    syncCanvas(stage, 800, 600, fixedSurface(400, 300, 2));
    syncScreenCanvas(screen, stage);

    expect([screen.width, screen.height]).toEqual([800, 600]);
    expect([screen.width, screen.height]).toEqual([stage.width, stage.height]);
  });

  it("copies the stage's size rather than measuring the surface again", () => {
    const stage = laidOutCanvas(400, 300);
    const screen = document.createElement("canvas");

    // The stage was synced at one ratio; a surface that has since changed is
    // irrelevant, because the screen layer's texture has to cover the picture that
    // was actually drawn, not the one the next frame will draw.
    syncCanvas(stage, 800, 600, fixedSurface(400, 300, 3));
    syncScreenCanvas(screen, stage);

    expect([screen.width, screen.height]).toEqual([1200, 900]);
  });

  it("writes nothing when the sizes already agree, so the HUD is not erased", () => {
    const stage = laidOutCanvas(400, 300);
    const screen = document.createElement("canvas");
    let writes = 0;
    let stored = 0;
    Object.defineProperty(screen, "width", {
      get: () => stored,
      set: (value: number) => {
        writes += 1;
        stored = value;
      },
      configurable: true,
    });

    syncCanvas(stage, 800, 600, fixedSurface(400, 300, 2));
    syncScreenCanvas(screen, stage);
    syncScreenCanvas(screen, stage);
    syncScreenCanvas(screen, stage);

    // Assigning `width` clears a canvas, so a write per frame would erase whatever
    // the previous frame's render drew on the screen layer.
    expect(writes).toBe(1);
    expect(stored).toBe(800);
  });

  it("follows the stage through a resize", () => {
    const stage = laidOutCanvas(400, 300);
    const screen = document.createElement("canvas");

    syncCanvas(stage, 800, 600, fixedSurface(400, 300, 2));
    syncScreenCanvas(screen, stage);
    syncCanvas(stage, 800, 600, fixedSurface(1000, 500, 1));
    syncScreenCanvas(screen, stage);

    expect([screen.width, screen.height]).toEqual([1000, 500]);
  });

  it("leaves both canvases alone when the surface reports no size", () => {
    const stage = laidOutCanvas(400, 300);
    const screen = document.createElement("canvas");

    syncCanvas(stage, 800, 600, fixedSurface(400, 300, 2));
    syncScreenCanvas(screen, stage);
    syncCanvas(stage, 800, 600, fixedSurface(0, 0, 2));
    syncScreenCanvas(screen, stage);

    // The last good frame survives on both surfaces, and they still agree.
    expect([screen.width, screen.height]).toEqual([800, 600]);
    expect([stage.width, stage.height]).toEqual([800, 600]);
  });

  it("writes no CSS size onto the screen canvas, which is never in the layout", () => {
    const stage = laidOutCanvas(300, 150);
    const screen = document.createElement("canvas");
    screen.width = 300;
    screen.height = 150;

    syncCanvas(stage, 800, 600, fixedSurface(300, 150, 2));
    syncScreenCanvas(screen, stage);

    expect(screen.style.width).toBe("");
    expect(screen.style.height).toBe("");
    expect(screen.width).toBe(600);
  });
});

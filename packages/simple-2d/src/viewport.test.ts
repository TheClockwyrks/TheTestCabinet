import { describe, expect, it } from "vitest";
import type { SurfaceMetrics } from "./contract";
import { applyViewport, domSurface, fitViewport, syncCanvas } from "./viewport";

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
  Object.defineProperty(canvas, "clientWidth", { value: cssW, configurable: true });
  Object.defineProperty(canvas, "clientHeight", { value: cssH, configurable: true });
  return canvas;
}

/** Records `setTransform` — jsdom has no real 2D context to interrogate. */
function recordingContext(): {
  ctx: CanvasRenderingContext2D;
  calls: number[][];
} {
  const calls: number[][] = [];
  const ctx = {
    setTransform(a: number, b: number, c: number, d: number, e: number, f: number) {
      calls.push([a, b, c, d, e, f]);
    },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
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

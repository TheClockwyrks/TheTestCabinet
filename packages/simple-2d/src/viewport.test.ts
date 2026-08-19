import { describe, expect, it } from "vitest";
import { applyViewport, fitViewport, syncCanvas } from "./viewport";

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

/** Pretend the document is on a display of the given ratio, for one test. */
function setDevicePixelRatio(ratio: number): void {
  Object.defineProperty(window, "devicePixelRatio", {
    value: ratio,
    configurable: true,
  });
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

  it("folds the device pixel ratio into the scale and the bars", () => {
    const vp = fitViewport(800, 600, 1000, 600, 2);

    // The fit ratio is still 1, but a logical unit is now two device pixels, and the
    // bars are measured in the same device pixels.
    expect(vp.scale).toBeCloseTo(2, 6);
    expect(vp.offsetX).toBeCloseTo(200, 6);
    expect(vp.offsetY).toBeCloseTo(0, 6);
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
      fitViewport(Number.NaN, 600, 800, 600, 1),
    ]) {
      for (const n of [vp.scale, vp.offsetX, vp.offsetY, vp.width, vp.height]) {
        expect(Number.isFinite(n)).toBe(true);
      }
    }

    // A bad ratio falls back to 1 rather than collapsing an otherwise valid fit.
    expect(fitViewport(800, 600, 800, 600, 0).scale).toBeCloseTo(1, 6);
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

describe("syncCanvas", () => {
  it("sizes the backing store by the device pixel ratio while pinning the CSS size", () => {
    setDevicePixelRatio(3);
    const canvas = laidOutCanvas(400, 300);

    const vp = syncCanvas(canvas, 800, 600);

    expect(canvas.width).toBe(1200);
    expect(canvas.height).toBe(900);
    expect(canvas.style.width).toBe("400px");
    expect(canvas.style.height).toBe("300px");
    // 400 CSS px across 800 logical units, tripled into device pixels.
    expect(vp.scale).toBeCloseTo(1.5, 6);
    expect(vp.offsetX).toBeCloseTo(0, 6);
  });

  it("writes the backing store only when it actually changed", () => {
    setDevicePixelRatio(2);
    const canvas = laidOutCanvas(400, 300);
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

    syncCanvas(canvas, 800, 600);
    syncCanvas(canvas, 800, 600);
    syncCanvas(canvas, 800, 600);

    expect(stored).toBe(800);
    expect(writes).toBe(1);
  });

  it("leaves an author-supplied CSS size alone so a responsive canvas can still resize", () => {
    setDevicePixelRatio(1);
    const canvas = laidOutCanvas(640, 480);
    canvas.style.width = "100%";

    syncCanvas(canvas, 800, 600);

    expect(canvas.style.width).toBe("100%");
    expect(canvas.width).toBe(640);
  });

  it("keeps the last backing store when the element has no size yet", () => {
    setDevicePixelRatio(1);
    const canvas = laidOutCanvas(400, 300);
    syncCanvas(canvas, 800, 600);

    Object.defineProperty(canvas, "clientWidth", {
      value: 0,
      configurable: true,
    });
    Object.defineProperty(canvas, "clientHeight", {
      value: 0,
      configurable: true,
    });
    const vp = syncCanvas(canvas, 800, 600);

    // The hidden frame draws nothing, but the previously rendered surface survives.
    expect(canvas.width).toBe(400);
    expect(canvas.height).toBe(300);
    expect(vp.scale).toBe(0);
  });
});

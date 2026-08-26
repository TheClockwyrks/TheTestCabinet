// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { SurfaceMetrics } from "./viewport";
import { domSurface, syncCanvas } from "./viewport";

/**
 * The two viewport behaviors that genuinely need a document: the default
 * surface's DOM measurements and the CSS-size pinning matrix, both driven over
 * real jsdom canvas elements. Everything computable from plain numbers — the
 * fit, the mapping, the projection pair, headless syncCanvas — is asserted in
 * `viewport.test.ts` under the suite's node default, so this file is the only
 * place the viewport suite pays for a DOM.
 */

/**
 * A surface reporting fixed figures, so a pinning assertion is about the pin
 * and not about jsdom's (absent) layout.
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

  it("reads the origin from the element's bounding rectangle at each call", () => {
    const canvas = laidOutCanvas(400, 300);
    let left = 12;
    let top = 34;
    canvas.getBoundingClientRect = () => ({ left, top }) as DOMRect;

    const surface = domSurface(canvas);
    expect(surface.origin?.()).toEqual({ x: 12, y: 34 });

    // The canvas moves with layout; the origin follows without a handler.
    left = 56;
    top = 78;
    expect(surface.origin?.()).toEqual({ x: 56, y: 78 });
  });
});

describe("syncCanvas and the CSS size", () => {
  it("pins a pixel size onto a canvas the page has not sized at all", () => {
    const canvas = document.createElement("canvas");
    // An unsized canvas takes its CSS size from its attributes, so the
    // measurement comes back equal to them. Without a pin, writing the backing
    // store would feed into the next measurement and the element would grow by
    // `dpr` every frame.
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

    // The surface models an element sized by its attributes: it reports
    // whatever the element's CSS size currently is, which is the pin once one
    // exists and the attributes until then. This is the runaway the pin
    // exists to stop.
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
    // A stylesheet rule shows up as a measurement that differs from the
    // attributes and as an inline style that is still empty. Testing the
    // inline style would pin this canvas at 640×480 and it would never follow
    // its container again.
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
});

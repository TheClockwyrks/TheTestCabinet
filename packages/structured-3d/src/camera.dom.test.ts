// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { domSurface, syncCanvas } from "./camera";
import type { SurfaceMetrics } from "./camera";

/**
 * The DOM half of the camera module's suite: `domSurface`, the one function in
 * the package that reads a measurement out of a document, and the CSS-size pin
 * exercised on a real element whose `style` is a live `CSSStyleDeclaration`.
 * Everything that can be asserted with numbers alone — the fit arithmetic, the
 * projection, the backing-store write rules over a hand-built canvas — lives in
 * `camera.test.ts` under the node environment; this file exists because these
 * few behaviors are *about* the DOM, not merely near it. jsdom performs no
 * layout, so a "laid-out" size is stated with `Object.defineProperty` on the
 * element, exactly what the engine would read back from a browser's layout.
 */

/** A surface reporting fixed figures, so the pin assertions are exact. */
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

  it("reads the ratio of the canvas's own document, and falls back to 1 with no window", () => {
    // A canvas inside a windowless document — `createHTMLDocument` has no
    // `defaultView` — is the closest jsdom gets to a detached frame; the
    // fallback keeps the ratio a number rather than an `undefined` that would
    // zero the fit.
    const windowless = document.implementation.createHTMLDocument();
    const canvas = windowless.createElement("canvas");
    expect(canvas.ownerDocument.defaultView).toBeNull();

    const surface = domSurface(canvas);
    expect(surface.dpr()).toBe(1);
    // The event target is still the canvas's own document.
    expect(surface.events()).toBe(windowless);
  });

  it("measures the origin at each call against where the element is now", () => {
    const canvas = laidOutCanvas(400, 300);
    let left = 24;
    canvas.getBoundingClientRect = () => ({ left, top: 16 }) as DOMRect;

    const surface = domSurface(canvas);
    expect(surface.origin?.()).toEqual({ x: 24, y: 16 });

    // The canvas moved with layout; the next event maps against the new spot.
    left = 124;
    expect(surface.origin?.()).toEqual({ x: 124, y: 16 });
  });
});

describe("syncCanvas and a real element's style", () => {
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

  it("leaves the style alone when the page sized the element", () => {
    // Reported 400×300 against attributes 300×150: a stylesheet is in charge,
    // and pinning would freeze the canvas at its first measured size.
    const canvas = document.createElement("canvas");
    canvas.width = 300;
    canvas.height = 150;

    syncCanvas(canvas, 800, 600, fixedSurface(400, 300, 2));

    expect(canvas.style.width).toBe("");
    expect(canvas.style.height).toBe("");
    expect(canvas.width).toBe(800);
    expect(canvas.height).toBe(600);
  });

  it("does not let an unsized canvas grow across repeated frames", () => {
    const canvas = document.createElement("canvas");
    canvas.width = 300;
    canvas.height = 150;

    // Each frame measures what the pin holds the CSS size at — the browser
    // keeps reporting 300×150 because the first frame wrote the style — so
    // the backing store settles at 600×300 instead of doubling every frame.
    for (let frame = 0; frame < 3; frame += 1) {
      syncCanvas(canvas, 800, 600, fixedSurface(300, 150, 2));
    }

    expect(canvas.width).toBe(600);
    expect(canvas.height).toBe(300);
    expect(canvas.style.width).toBe("300px");
  });
});

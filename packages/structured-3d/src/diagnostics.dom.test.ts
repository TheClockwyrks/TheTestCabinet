// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { createOverlaySurface } from "./diagnostics";

/**
 * The DOM half of the diagnostics suite: the overlay's own surface, which is an
 * element only where a document stands behind the rendering canvas. Everything
 * the panel says and how it is measured lives in `diagnostics.test.ts` under the
 * node environment; this file exists because these behaviors are *about* the
 * document — where the surface is inserted, that it lets pointer events through,
 * and that it tracks the canvas it annotates.
 *
 * jsdom's canvases yield no 2D context of their own, which is itself one of the
 * documented fallbacks, so the tests that need a working surface graft a context
 * onto the element the factory creates — exactly what a browser would have
 * handed it.
 */

/** What the overlay does to a 2D context, recorded rather than rasterized. */
function stubContext(): CanvasRenderingContext2D {
  return {
    save: () => {},
    restore: () => {},
    setTransform: () => {},
    clearRect: () => {},
    measureText: (text: string) => ({ width: text.length * 7 }) as TextMetrics,
    fillText: () => {},
    fillRect: () => {},
    font: "",
    textBaseline: "",
    textAlign: "",
    fillStyle: "",
  } as unknown as CanvasRenderingContext2D;
}

const nativeGetContext = HTMLCanvasElement.prototype.getContext;

/** Give every canvas in the document a 2D context, as a browser's would have one. */
function grantContexts(): void {
  HTMLCanvasElement.prototype.getContext = function getContext(
    kind: string,
  ): unknown {
    return kind === "2d" ? stubContext() : null;
  } as typeof HTMLCanvasElement.prototype.getContext;
}

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = nativeGetContext;
  document.body.innerHTML = "";
});

/** A rendering canvas in the document, at a stated backing store and laid-out size. */
function renderingCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 180;
  for (const [name, value] of [
    ["clientWidth", 160],
    ["clientHeight", 90],
    ["offsetLeft", 12],
    ["offsetTop", 24],
  ] as const) {
    Object.defineProperty(canvas, name, { value, configurable: true });
  }
  document.body.append(canvas);
  return canvas;
}

describe("the overlay's surface in a document", () => {
  it("sits immediately after the rendering canvas so it composites above it", () => {
    grantContexts();
    const canvas = renderingCanvas();

    const surface = createOverlaySurface(canvas);

    expect(surface).not.toBeNull();
    const overlay = canvas.nextElementSibling as HTMLCanvasElement | null;
    expect(overlay?.tagName).toBe("CANVAS");
    expect(overlay?.style.position).toBe("absolute");
    // Chrome must never intercept the game's input.
    expect(overlay?.style.pointerEvents).toBe("none");
  });

  it("tracks the canvas's backing store and pins itself over the canvas's box", () => {
    grantContexts();
    const canvas = renderingCanvas();
    const surface = createOverlaySurface(canvas);

    surface?.sync(320, 180);
    const overlay = canvas.nextElementSibling as HTMLCanvasElement;

    expect(overlay.width).toBe(320);
    expect(overlay.height).toBe(180);
    expect(overlay.style.left).toBe("12px");
    expect(overlay.style.top).toBe("24px");
    expect(overlay.style.width).toBe("160px");
    expect(overlay.style.height).toBe("90px");
  });

  it("leaves the CSS size alone for a canvas outside layout, which reports none", () => {
    grantContexts();
    const canvas = document.createElement("canvas");
    document.body.append(canvas);
    const surface = createOverlaySurface(canvas);

    surface?.sync(64, 32);
    const overlay = canvas.nextElementSibling as HTMLCanvasElement;

    // Writing the zeros the canvas reports would collapse the overlay for no
    // information.
    expect(overlay.style.width).toBe("");
    expect(overlay.width).toBe(64);
  });

  it("removes itself from the document when it is disposed, however often that is asked", () => {
    grantContexts();
    const canvas = renderingCanvas();
    const surface = createOverlaySurface(canvas);

    surface?.dispose();
    surface?.dispose();

    expect(canvas.nextElementSibling).toBeNull();
  });

  it("hands the same context back on every read", () => {
    grantContexts();
    const surface = createOverlaySurface(renderingCanvas());

    expect(surface?.context()).toBe(surface?.context());
  });

  it("is inert where the document's canvases yield no 2D context", () => {
    // jsdom without a native canvas binding, which is also the shape of a host
    // that can make no 2D surface at all: the overlay draws nothing. jsdom
    // announces its own "not implemented" notice on the way to answering
    // `null`, which is the notice this test's stderr carries.
    expect(createOverlaySurface(renderingCanvas())).toBeNull();
  });
});

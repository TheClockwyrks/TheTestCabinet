// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOverlaySurface } from "./diagnostics";

/**
 * The element-backed overlay surface — the branch that genuinely needs a
 * document: a `<canvas>` positioned over the rendering canvas, sized and pinned
 * by `sync`, removed by `dispose`. What the overlay *draws* on that surface is
 * asserted in `diagnostics.test.ts` under the suite's node default (against a
 * recording stub and real `@napi-rs/canvas` pixels), so this file only pays for
 * jsdom where the surface's placement in a document is the behavior under test.
 *
 * jsdom's own canvases yield no 2D context, so `getContext` is mocked on the
 * prototype to serve a per-element recording stub — which is also what lets a
 * test tell the overlay element's context from the rendering canvas's.
 */

/** One recorded 2D call: the method and the arguments it got. */
interface RecordedCall {
  op: string;
  args: unknown[];
}

/** The 2D-context stand-in `sync` blanks: records the calls, nothing more. */
interface StubContext {
  calls: RecordedCall[];
  setTransform(...args: unknown[]): void;
  clearRect(...args: unknown[]): void;
}

function stubContext(): StubContext {
  const calls: RecordedCall[] = [];
  return {
    calls,
    setTransform: (...args: unknown[]) =>
      calls.push({ op: "setTransform", args }),
    clearRect: (...args: unknown[]) => calls.push({ op: "clearRect", args }),
  };
}

/**
 * Serve every canvas its own stub 2D context, remembered per element, so a test
 * can ask which element's context the surface handed out.
 */
function serveContexts(): WeakMap<HTMLCanvasElement, StubContext> {
  const contexts = new WeakMap<HTMLCanvasElement, StubContext>();
  // `getContext` is an overload set whose last member returns a
  // `GPUCanvasContext`, which no single implementation signature satisfies, so
  // the replacement is asserted once here rather than at each return.
  const serve = function (
    this: HTMLCanvasElement,
    kind: string,
  ): StubContext | null {
    if (kind !== "2d") return null;
    let ctx = contexts.get(this);
    if (ctx === undefined) {
      ctx = stubContext();
      contexts.set(this, ctx);
    }
    return ctx;
  } as unknown as HTMLCanvasElement["getContext"];
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(serve);
  return contexts;
}

/** A rendering canvas mounted in the document, as a browser build has one. */
function mountedCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  document.body.appendChild(canvas);
  return canvas;
}

/** The overlay element the surface inserted: the canvas's next sibling. */
function overlayElement(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const element = canvas.nextSibling;
  expect(element).toBeInstanceOf(HTMLCanvasElement);
  return element as HTMLCanvasElement;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("createOverlaySurface with a document behind the canvas", () => {
  it("mounts a canvas element beside the rendering canvas, positioned and transparent to input", () => {
    serveContexts();
    const canvas = mountedCanvas();

    const surface = createOverlaySurface(canvas);

    expect(surface).not.toBeNull();
    const element = overlayElement(canvas);
    // Positioned, so it can sit over the picture; transparent to the pointer, so
    // chrome never intercepts the game's input.
    expect(element.style.position).toBe("absolute");
    expect(element.style.pointerEvents).toBe("none");
    // Beside the canvas rather than at the body's tail, so the overlay scrolls
    // and stacks with the picture it annotates.
    expect(element.previousSibling).toBe(canvas);
  });

  it("hands out the overlay element's own 2D context, never the rendering canvas's", () => {
    const contexts = serveContexts();
    const canvas = mountedCanvas();

    const surface = createOverlaySurface(canvas);

    const element = overlayElement(canvas);
    expect(surface?.context()).toBe(contexts.get(element));
    expect(surface?.context()).not.toBe(canvas.getContext("2d"));
  });

  it("sync sizes the backing store to the given device pixels and leaves the surface blank", () => {
    const contexts = serveContexts();
    const canvas = mountedCanvas();
    const surface = createOverlaySurface(canvas);
    const element = overlayElement(canvas);
    const ctx = contexts.get(element);
    ctx?.calls.splice(0);

    surface?.sync(1280, 720);

    expect(element.width).toBe(1280);
    expect(element.height).toBe(720);
    // Identity transform, then a full-size transparent clear: last frame's panel
    // never lingers, whatever transform the overlay left behind.
    expect(ctx?.calls).toEqual([
      { op: "setTransform", args: [1, 0, 0, 1, 0, 0] },
      { op: "clearRect", args: [0, 0, 1280, 720] },
    ]);
  });

  it("sync pins the overlay over the canvas's CSS box when the canvas reports one", () => {
    serveContexts();
    const canvas = mountedCanvas();
    // jsdom performs no layout, so the canvas's box is stated outright.
    Object.defineProperty(canvas, "offsetLeft", {
      value: 12,
      configurable: true,
    });
    Object.defineProperty(canvas, "offsetTop", {
      value: 34,
      configurable: true,
    });
    Object.defineProperty(canvas, "clientWidth", {
      value: 400,
      configurable: true,
    });
    Object.defineProperty(canvas, "clientHeight", {
      value: 300,
      configurable: true,
    });
    const surface = createOverlaySurface(canvas);

    surface?.sync(800, 600);

    // Same offset, same CSS size: one overlay device pixel over one canvas
    // device pixel, so the panel lands exactly on the picture it annotates.
    const element = overlayElement(canvas);
    expect(element.style.left).toBe("12px");
    expect(element.style.top).toBe("34px");
    expect(element.style.width).toBe("400px");
    expect(element.style.height).toBe("300px");
  });

  it("sync leaves the overlay's CSS size alone for a canvas outside layout", () => {
    serveContexts();
    const canvas = mountedCanvas();
    // A canvas outside layout reports zeros; writing those would collapse the
    // overlay for no information.
    const surface = createOverlaySurface(canvas);

    surface?.sync(800, 600);

    const element = overlayElement(canvas);
    expect(element.style.width).toBe("");
    expect(element.style.height).toBe("");
  });

  it("survives a canvas its document never mounted", () => {
    serveContexts();
    const canvas = document.createElement("canvas");

    const surface = createOverlaySurface(canvas);

    // No parent to insert beside, so the element floats — but the surface still
    // serves a context, and sync and dispose still have nothing to trip on.
    expect(surface).not.toBeNull();
    expect(() => surface?.sync(640, 360)).not.toThrow();
    expect(() => surface?.dispose()).not.toThrow();
  });

  it("dispose removes the element from the document, idempotently", () => {
    serveContexts();
    const canvas = mountedCanvas();
    const surface = createOverlaySurface(canvas);
    const element = overlayElement(canvas);

    surface?.dispose();

    expect(element.parentNode).toBeNull();
    expect(canvas.nextSibling).toBeNull();
    expect(() => surface?.dispose()).not.toThrow();
  });

  it("falls back to inert when the document's canvases yield no 2D context", () => {
    // jsdom without a native canvas binding: `getContext("2d")` answers null, so
    // the element branch declines — and with no `OffscreenCanvas` either, the
    // overlay is inert exactly as it is in Node.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);

    expect(createOverlaySurface(mountedCanvas())).toBeNull();
  });

  it("falls back to inert when creating the element's context throws", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () => {
        throw new Error("no 2D backend");
      },
    );

    expect(createOverlaySurface(mountedCanvas())).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { createCanvas } from "./index";

/**
 * The canvas contract: size coercion by the HTML rule, the getContext
 * identity rules, and the reallocate-and-clear semantics of size assignment.
 * What the cleared buffer actually holds is asserted here through readPixels
 * because that is the only public window onto it; the plane-level details
 * live in raster/framebuffer.test.ts.
 */

describe("createCanvas", () => {
  it("returns a canvas carrying the device-pixel size it was given", () => {
    const canvas = createCanvas(640, 360);
    expect(canvas.width).toBe(640);
    expect(canvas.height).toBe(360);
  });

  it("truncates fractional sizes toward zero, the HTML coercion rule", () => {
    const canvas = createCanvas(12.9, 7.2);
    expect(canvas.width).toBe(12);
    expect(canvas.height).toBe(7);
  });

  it("falls back to the element defaults of 300 by 150 for NaN sizes", () => {
    const canvas = createCanvas(Number.NaN, Number.NaN);
    expect(canvas.width).toBe(300);
    expect(canvas.height).toBe(150);
  });

  it("falls back to the element defaults for negative and non-finite sizes", () => {
    expect(createCanvas(-5, Number.POSITIVE_INFINITY).width).toBe(300);
    expect(createCanvas(-5, Number.POSITIVE_INFINITY).height).toBe(150);
  });

  it("accepts zero, which the HTML rule allows", () => {
    const canvas = createCanvas(0, 0);
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
  });
});

describe("getContext", () => {
  it("yields a live webgl2 context, the same object on every call", () => {
    const canvas = createCanvas(8, 8);
    const first = canvas.getContext("webgl2");
    const second = canvas.getContext("webgl2");
    expect(first).toBe(second);
  });

  it("returns null for every other context id, as a browser canvas does once webgl2 exists", () => {
    const canvas = createCanvas(8, 8);
    canvas.getContext("webgl2");
    expect(canvas.getContext("2d")).toBeNull();
    expect(canvas.getContext("webgl")).toBeNull();
    expect(canvas.getContext("bitmaprenderer")).toBeNull();
    expect(canvas.getContext("nonsense")).toBeNull();
  });

  it("returns null for a 2d context even before webgl2 was requested, because the overlay never draws here", () => {
    expect(createCanvas(8, 8).getContext("2d")).toBeNull();
  });

  it("honors attributes on the first call and reports them from getContextAttributes", () => {
    const gl = createCanvas(8, 8).getContext("webgl2", {
      alpha: false,
      antialias: false,
    });
    expect(gl.getContextAttributes()).toEqual({
      alpha: false,
      depth: true,
      stencil: false,
      antialias: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
    });
  });

  it("defaults to alpha, depth, antialias, and premultipliedAlpha on with stencil and preserveDrawingBuffer off", () => {
    const gl = createCanvas(8, 8).getContext("webgl2");
    expect(gl.getContextAttributes()).toEqual({
      alpha: true,
      depth: true,
      stencil: false,
      antialias: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
    });
  });

  it("ignores differing attributes on a repeat call, per the WebGL spec", () => {
    const canvas = createCanvas(8, 8);
    canvas.getContext("webgl2", { alpha: false });
    const gl = canvas.getContext("webgl2", { alpha: true, antialias: false });
    expect(gl.getContextAttributes().alpha).toBe(false);
    expect(gl.getContextAttributes().antialias).toBe(true);
  });

  it("hands back attribute copies, so a caller cannot mutate the context's record", () => {
    const gl = createCanvas(8, 8).getContext("webgl2");
    const attributes = gl.getContextAttributes();
    attributes.alpha = false;
    expect(gl.getContextAttributes().alpha).toBe(true);
  });

  it("carries the canvas back-reference the way browser contexts do", () => {
    const canvas = createCanvas(8, 8);
    expect(canvas.getContext("webgl2").canvas).toBe(canvas);
  });

  it("is never lost — there is no compositor to lose it to", () => {
    expect(createCanvas(8, 8).getContext("webgl2").isContextLost()).toBe(false);
  });
});

describe("size assignment", () => {
  /** Reads one pixel as RGBA bytes off the default framebuffer. */
  function sample(
    gl: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
    x: number,
    y: number,
  ): number[] {
    const bytes = new Uint8Array(4);
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    return [...bytes];
  }

  it("tracks assignments through drawingBufferWidth and drawingBufferHeight", () => {
    const canvas = createCanvas(8, 8);
    const gl = canvas.getContext("webgl2");
    canvas.width = 16;
    canvas.height = 4;
    expect(gl.drawingBufferWidth).toBe(16);
    expect(gl.drawingBufferHeight).toBe(4);
  });

  it("reallocates and clears to transparent black when the width is assigned", () => {
    const canvas = createCanvas(4, 4);
    const gl = canvas.getContext("webgl2");
    gl.clearColor(1, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    expect(sample(gl, 0, 0)).toEqual([255, 0, 0, 255]);
    canvas.width = 4;
    // Even assigning the SAME width resets the buffer, matching HTML canvas.
    expect(sample(gl, 0, 0)).toEqual([0, 0, 0, 0]);
  });

  it("clears to opaque black under alpha: false, whose buffer has no alpha channel", () => {
    const canvas = createCanvas(4, 4);
    const gl = canvas.getContext("webgl2", { alpha: false });
    canvas.height = 4;
    expect(sample(gl, 0, 0)).toEqual([0, 0, 0, 255]);
  });

  it("coerces an invalid assigned size to the element default", () => {
    const canvas = createCanvas(8, 8);
    canvas.width = Number.NaN;
    expect(canvas.width).toBe(300);
    canvas.height = -3;
    expect(canvas.height).toBe(150);
  });

  it("leaves viewport and scissor state untouched by a resize, per the WebGL spec", () => {
    const canvas = createCanvas(8, 8);
    const gl = canvas.getContext("webgl2");
    canvas.width = 32;
    expect([...(gl.getParameter(gl.VIEWPORT) as Int32Array)]).toEqual([
      0, 0, 8, 8,
    ]);
    expect([...(gl.getParameter(gl.SCISSOR_BOX) as Int32Array)]).toEqual([
      0, 0, 8, 8,
    ]);
  });
});

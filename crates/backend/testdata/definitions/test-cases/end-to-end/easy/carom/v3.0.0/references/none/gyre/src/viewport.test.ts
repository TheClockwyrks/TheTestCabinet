// The canvas fit. specs/overview.md asks for a uniform scale that keeps the whole
// 1280x720 field visible, centered in a letterbox on the background color, at the
// device's pixel density — at every window size and on load. All of that is one
// pure function of four numbers, so it is checked here without a browser.

import { describe, expect, it } from "vitest";
import { FIELD_H, FIELD_W } from "./constants";
import { deviceSize, domSurface, fitViewport, toLogical } from "./viewport";

/** The fit at `cssWidth x cssHeight` CSS pixels and a pixel ratio of `dpr`. */
function fit(cssWidth: number, cssHeight: number, dpr = 1) {
  return fitViewport(FIELD_W, FIELD_H, cssWidth, cssHeight, dpr);
}

describe("fitViewport", () => {
  it("keeps the logical field as the space the game draws in", () => {
    const view = fit(400, 300);
    expect(view.width).toBe(FIELD_W);
    expect(view.height).toBe(FIELD_H);
  });

  it("maps the field one-for-one onto an element of exactly its size", () => {
    expect(fit(FIELD_W, FIELD_H)).toEqual({
      width: FIELD_W,
      height: FIELD_H,
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    });
  });

  it("takes the scale from the tighter axis, so the whole field is visible", () => {
    // Too wide: height is the constraint, and the slack goes into side bars.
    const wide = fit(FIELD_W * 2, FIELD_H);
    expect(wide.scale).toBe(1);
    expect(wide.offsetX).toBe(FIELD_W / 2);
    expect(wide.offsetY).toBe(0);

    // Too tall: width is the constraint, and the slack goes into top and bottom.
    const tall = fit(FIELD_W, FIELD_H * 2);
    expect(tall.scale).toBe(1);
    expect(tall.offsetX).toBe(0);
    expect(tall.offsetY).toBe(FIELD_H / 2);
  });

  it("scales uniformly, so the aspect ratio never distorts", () => {
    const view = fit(640, 720);
    expect(view.scale).toBe(0.5);
    // A uniform scale means the drawn field keeps 16:9 whatever the element is.
    expect((FIELD_W * view.scale) / (FIELD_H * view.scale)).toBeCloseTo(
      FIELD_W / FIELD_H,
      12,
    );
  });

  it("centers the field: the two bars on an axis are equal", () => {
    const view = fit(1600, 720, 1);
    const right = 1600 - (view.offsetX + FIELD_W * view.scale);
    expect(view.offsetX).toBeGreaterThan(0);
    expect(right).toBeCloseTo(view.offsetX, 9);
  });

  it("folds the device pixel ratio into the scale and the offsets", () => {
    const view = fit(FIELD_W, FIELD_H, 2);
    expect(view.scale).toBe(2);
    expect(view.offsetX).toBe(0);

    const dense = fit(FIELD_W * 2, FIELD_H, 2);
    expect(dense.scale).toBe(2);
    // The bars are in DEVICE pixels: half the element's width, doubled.
    expect(dense.offsetX).toBe(FIELD_W);
  });

  it("collapses to a scale of zero on an element that has not been laid out", () => {
    expect(fit(0, 0).scale).toBe(0);
    expect(fit(Number.NaN, 300).scale).toBe(0);
    expect(fit(-100, 300).scale).toBe(0);
  });

  it("treats an unusable pixel ratio as one", () => {
    expect(fit(FIELD_W, FIELD_H, 0).scale).toBe(1);
    expect(fit(FIELD_W, FIELD_H, Number.NaN).scale).toBe(1);
    expect(fit(FIELD_W, FIELD_H, Number.POSITIVE_INFINITY).scale).toBe(1);
  });
});

describe("deviceSize", () => {
  it("rounds a CSS dimension to whole device pixels", () => {
    expect(deviceSize(100, 1)).toBe(100);
    expect(deviceSize(100, 2)).toBe(200);
    expect(deviceSize(100, 1.25)).toBe(125);
    expect(deviceSize(100.4, 1)).toBe(100);
  });

  it("agrees with the fit, so the two bars sum to the drawable area", () => {
    // Rounded the same way, or a fractional ratio leaves a seam at one edge.
    const cssWidth = 1000.6;
    const dpr = 1.25;
    const view = fit(cssWidth, 720, dpr);
    const used = view.offsetX * 2 + view.width * view.scale;
    expect(used).toBeCloseTo(deviceSize(cssWidth, dpr), 9);
  });

  it("collapses an unusable dimension to zero", () => {
    expect(deviceSize(Number.NaN, 2)).toBe(0);
    expect(deviceSize(-10, 2)).toBe(0);
  });
});

describe("toLogical", () => {
  const NO_OFFSET = { x: 0, y: 0 };

  it("is the exact inverse of the fit, at every corner", () => {
    for (const [w, h, dpr] of [
      [FIELD_W, FIELD_H, 1],
      [1920, 1080, 2],
      [800, 900, 1], // taller than 16:9: bars top and bottom
      [1600, 500, 3], // wider than 16:9: bars left and right
    ] as const) {
      const view = fit(w, h, dpr);
      const cssScale = view.scale / dpr;
      for (const [x, y] of [
        [0, 0],
        [FIELD_W, FIELD_H],
        [FIELD_W / 2, FIELD_H / 3],
      ] as const) {
        const client = {
          x: view.offsetX / dpr + x * cssScale,
          y: view.offsetY / dpr + y * cssScale,
        };
        const back = toLogical(view, NO_OFFSET, dpr, client.x, client.y);
        expect(back.x).toBeCloseTo(x, 6);
        expect(back.y).toBeCloseTo(y, 6);
      }
    }
  });

  it("takes the surface's own corner off the page position first", () => {
    const view = fit(FIELD_W, FIELD_H);
    expect(toLogical(view, { x: 40, y: 12 }, 1, 140, 112)).toEqual({
      x: 100,
      y: 100,
    });
  });

  it("reads a point inside a letterbox bar as outside the field", () => {
    // 800x900 letterboxes top and bottom, so the very top of the element is
    // above the field's own y = 0.
    const view = fit(800, 900);
    expect(toLogical(view, NO_OFFSET, 1, 400, 0).y).toBeLessThan(0);
  });

  it("collapses to the field's origin where there is no fit to invert", () => {
    // A zero-sized element, which is what a canvas reports before layout.
    expect(toLogical(fit(0, 0), NO_OFFSET, 1, 10, 10)).toEqual({ x: 0, y: 0 });
  });
});

describe("domSurface", () => {
  it("reads the canvas element's laid-out size, not its backing store", () => {
    const element = {
      clientWidth: 800,
      clientHeight: 450,
      width: 1600,
      height: 900,
      getBoundingClientRect: () => ({ left: 0, top: 0 }),
    } as unknown as HTMLCanvasElement;
    const surface = domSurface(element);
    expect(surface.cssWidth()).toBe(800);
    expect(surface.cssHeight()).toBe(450);
  });

  it("reads the element's corner in the page, which a pointer is relative to", () => {
    const element = {
      clientWidth: 800,
      clientHeight: 450,
      getBoundingClientRect: () => ({ left: 12, top: 34 }),
    } as unknown as HTMLCanvasElement;
    expect(domSurface(element).origin()).toEqual({ x: 12, y: 34 });
  });
});

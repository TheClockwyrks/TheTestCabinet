// The painted layer: made through whichever door the host opens, and safe when
// the host opens none.

import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it, vi } from "vitest";
import { TrailLayer, type LayerCanvas } from "./trail";
import { STAGE_H, STAGE_W } from "./constants";

/** A layer backed by a real 2D context, which is what a browser gives. */
function realLayer(): LayerCanvas {
  return createCanvas(STAGE_W, STAGE_H) as unknown as LayerCanvas;
}

describe("TrailLayer", () => {
  it("paints when the host gives it a surface", () => {
    const layer = new TrailLayer(realLayer);
    expect(layer.painted).toBe(true);
  });

  it("is made at the stage's size", () => {
    const make = vi.fn(realLayer);
    new TrailLayer(make);
    expect(make).toHaveBeenCalledWith(STAGE_W, STAGE_H);
  });

  it("moves the origin to the stamp's position", () => {
    const layer = new TrailLayer(realLayer);
    let seen: [number, number] | null = null;
    layer.stamp(120, 340, (ctx) => {
      const matrix = ctx.getTransform();
      seen = [matrix.e, matrix.f];
    });
    expect(seen).toEqual([120, 340]);
  });

  it("keeps a throwing stamp from leaving the context translated", () => {
    const layer = new TrailLayer(realLayer);
    expect(() =>
      layer.stamp(50, 50, () => {
        throw new Error("bad stamp");
      }),
    ).toThrow();
    let origin: [number, number] | null = null;
    layer.stamp(0, 0, (ctx) => {
      const matrix = ctx.getTransform();
      origin = [matrix.e, matrix.f];
    });
    expect(origin).toEqual([0, 0]);
  });

  it("keeps what it painted until it is cleared", () => {
    const layer = new TrailLayer(realLayer);
    const target = createCanvas(STAGE_W, STAGE_H);
    const ctx = target.getContext("2d");
    layer.stamp(100, 100, (surface) => {
      surface.fillStyle = "#ffffff";
      surface.fillRect(0, 0, 40, 40);
    });
    layer.blit(ctx as unknown as CanvasRenderingContext2D);
    expect(ctx.getImageData(110, 110, 1, 1).data[0]).toBe(255);

    layer.clear();
    ctx.clearRect(0, 0, STAGE_W, STAGE_H);
    layer.blit(ctx as unknown as CanvasRenderingContext2D);
    expect(ctx.getImageData(110, 110, 1, 1).data[3]).toBe(0);
  });

  it("is silent, not broken, where the host has no surface", () => {
    const layer = new TrailLayer(() => null);
    expect(layer.painted).toBe(false);
    expect(() => layer.stamp(0, 0, () => undefined)).not.toThrow();
    expect(() => layer.clear()).not.toThrow();
    const target = createCanvas(4, 4).getContext("2d");
    expect(() =>
      layer.blit(target as unknown as CanvasRenderingContext2D),
    ).not.toThrow();
  });

  it("degrades rather than throwing when the factory throws", () => {
    const layer = new TrailLayer(() => {
      throw new Error("no canvas here");
    });
    expect(layer.painted).toBe(false);
  });
});

import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { STAGE_H, STAGE_W } from "./constants";
import { createTrailLayer } from "./trail";
import type { Ctx } from "./cards";

/** A stage-sized surface backed by the node canvas the tests run over. */
function surface(): OffscreenCanvas {
  return createCanvas(STAGE_W, STAGE_H) as unknown as OffscreenCanvas;
}

function pixel(canvas: OffscreenCanvas, x: number, y: number): number[] {
  const ctx = canvas.getContext("2d") as unknown as Ctx;
  return [...ctx.getImageData(x, y, 1, 1).data];
}

describe("the painted layer", () => {
  it("keeps what was stamped on it", () => {
    const canvas = surface();
    const layer = createTrailLayer(canvas);
    expect(layer).not.toBeNull();

    layer?.stamp((ctx) => {
      ctx.fillStyle = "#ff0000";
      ctx.fillRect(100, 100, 40, 40);
    });
    expect(pixel(canvas, 120, 120).slice(0, 3)).toEqual([255, 0, 0]);

    layer?.stamp((ctx) => {
      ctx.fillStyle = "#0000ff";
      ctx.fillRect(300, 300, 40, 40);
    });
    // The first stamp is still there beside the second.
    expect(pixel(canvas, 120, 120).slice(0, 3)).toEqual([255, 0, 0]);
    expect(pixel(canvas, 320, 320).slice(0, 3)).toEqual([0, 0, 255]);
  });

  it("leaves the drawing state of the layer as it found it", () => {
    const canvas = surface();
    const layer = createTrailLayer(canvas);
    layer?.stamp((ctx) => {
      ctx.globalAlpha = 0.1;
      ctx.fillStyle = "#00ff00";
      ctx.fillRect(0, 0, 10, 10);
    });
    layer?.stamp((ctx) => {
      ctx.fillStyle = "#00ff00";
      ctx.fillRect(500, 500, 10, 10);
    });
    expect(pixel(canvas, 505, 505).slice(0, 3)).toEqual([0, 255, 0]);
  });

  it("wipes back to nothing when cleared", () => {
    const canvas = surface();
    const layer = createTrailLayer(canvas);
    layer?.stamp((ctx) => {
      ctx.fillStyle = "#ff0000";
      ctx.fillRect(100, 100, 40, 40);
    });
    layer?.clear();
    expect(pixel(canvas, 120, 120)[3]).toBe(0);
  });

  it("blits onto a frame at the stage origin", () => {
    const canvas = surface();
    const layer = createTrailLayer(canvas);
    layer?.stamp((ctx) => {
      ctx.fillStyle = "#ff0000";
      ctx.fillRect(100, 100, 40, 40);
    });
    const frame = surface();
    const ctx = frame.getContext("2d") as unknown as Ctx;
    layer?.blit(ctx);
    expect(pixel(frame, 120, 120).slice(0, 3)).toEqual([255, 0, 0]);
  });

  it("is absent where the host offers no surface", () => {
    expect(createTrailLayer(null)).toBeNull();
  });
});

import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { GEM_KINDS } from "./constants";
import {
  COLOR,
  FONT_BODY,
  KIND_FALLBACK,
  drawControl,
  drawTracked,
  font,
  roundedRect,
} from "./theme";

/** A real 2D context, so the text metrics are a real font's. */
function context(width = 400, height = 120): CanvasRenderingContext2D {
  return createCanvas(width, height).getContext(
    "2d",
  ) as unknown as CanvasRenderingContext2D;
}

/** The leftmost and rightmost painted columns of a raster. */
function extent(ctx: CanvasRenderingContext2D): [number, number] {
  const { width, height } = ctx.canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  let first = width;
  let last = -1;
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] <= 8) continue;
    const column = ((index - 3) / 4) % width;
    if (column < first) first = column;
    if (column > last) last = column;
  }
  return [first, last];
}

describe("font", () => {
  it("names a weight, a size, and a family", () => {
    expect(font(20)).toBe(`400 20px ${FONT_BODY}`);
    expect(font(20, 700, "serif")).toBe("700 20px serif");
  });
});

describe("KIND_FALLBACK", () => {
  it("carries one hue for each of the seven kinds", () => {
    for (const kind of GEM_KINDS) {
      expect(KIND_FALLBACK[kind], kind).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(Object.keys(KIND_FALLBACK)).toHaveLength(GEM_KINDS.length);
  });

  it("gives each kind a hue of its own", () => {
    expect(new Set(Object.values(KIND_FALLBACK)).size).toBe(GEM_KINDS.length);
  });
});

describe("drawTracked", () => {
  it("returns a width that grows with the tracking", () => {
    const ctx = context();
    ctx.font = font(20);
    const tight = drawTracked(ctx, "FACET", 200, 60, 0);
    const wide = drawTracked(ctx, "FACET", 200, 60, 10);
    expect(wide).toBeCloseTo(tight + 10 * 4, 6);
  });

  it("centers the text on the x it is given", () => {
    const ctx = context();
    ctx.font = font(28, 700);
    ctx.fillStyle = "#ffffff";
    const width = drawTracked(ctx, "FACET", 200, 70, 6);
    const [first, last] = extent(ctx);
    expect((first + last) / 2).toBeCloseTo(200, -1);
    expect(last - first).toBeLessThanOrEqual(width + 2);
  });

  it("hands the alignment back as it found it", () => {
    const ctx = context();
    ctx.textAlign = "right";
    drawTracked(ctx, "X", 100, 60, 2);
    expect(ctx.textAlign).toBe("right");
  });

  it("draws a single glyph with no tracking to add", () => {
    const ctx = context();
    ctx.font = font(20);
    expect(drawTracked(ctx, "X", 100, 60, 12)).toBeGreaterThan(0);
  });
});

describe("roundedRect", () => {
  it("paints inside the rectangle and nothing outside it", () => {
    const ctx = context(100, 100);
    ctx.fillStyle = COLOR.gold;
    roundedRect(ctx, 20, 20, 60, 60, 10);
    ctx.fill();
    const data = ctx.getImageData(0, 0, 100, 100).data;
    let outside = 0;
    for (let index = 3; index < data.length; index += 4) {
      if (data[index] <= 8) continue;
      const pixel = (index - 3) / 4;
      const x = pixel % 100;
      const y = Math.floor(pixel / 100);
      if (x < 19 || x > 81 || y < 19 || y > 81) outside += 1;
    }
    expect(outside).toBe(0);
    expect(data[(50 * 100 + 50) * 4 + 3]).toBeGreaterThan(0);
  });

  it("clamps a radius larger than the rectangle it rounds", () => {
    const ctx = context(60, 60);
    ctx.fillStyle = COLOR.gold;
    expect(() => {
      roundedRect(ctx, 10, 10, 20, 20, 500);
      ctx.fill();
    }).not.toThrow();
  });
});

describe("drawControl", () => {
  it("fills the rectangle it is given, so the target it draws is pressable", () => {
    const ctx = context(240, 120);
    const rect = { x: 20, y: 20, w: 176, h: 72 };
    drawControl(ctx, rect, "PAUSE");

    const painted = (
      x: number,
      y: number,
      width: number,
      height: number,
    ): number => {
      const data = ctx.getImageData(x, y, width, height).data;
      let count = 0;
      for (let index = 3; index < data.length; index += 4) {
        if (data[index] > 8) count += 1;
      }
      return count;
    };

    // The plate covers its own rectangle, and its word is inside it.
    expect(
      painted(rect.x + 4, rect.y + 4, rect.w - 8, rect.h - 8),
    ).toBeGreaterThan(0);
    // Nothing is painted outside it.
    expect(painted(0, 0, 240, rect.y - 2)).toBe(0);
    expect(
      painted(0, rect.y + rect.h + 2, 240, 120 - rect.y - rect.h - 2),
    ).toBe(0);
  });

  it("hands the context back as it found it", () => {
    const ctx = context(240, 120);
    ctx.textAlign = "right";
    ctx.lineWidth = 7;
    drawControl(ctx, { x: 20, y: 20, w: 176, h: 72 }, "BACK");
    expect(ctx.textAlign).toBe("right");
    expect(ctx.lineWidth).toBe(7);
  });
});

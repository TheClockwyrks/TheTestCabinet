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
  /** How many pixels of a region carry any paint at all. */
  function inkIn(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
  ): number {
    const data = ctx.getImageData(x, y, width, height).data;
    let count = 0;
    for (let index = 3; index < data.length; index += 4) {
      if (data[index] > 8) count += 1;
    }
    return count;
  }

  const PLATE = { x: 40, y: 20, w: 320, h: 72 } as const;

  it("fills the rectangle it is given and paints outside none of it", () => {
    const ctx = context();
    drawControl(ctx, PLATE, "CONTINUE", false);
    expect(
      inkIn(ctx, PLATE.x + 4, PLATE.y + 4, PLATE.w - 8, PLATE.h - 8),
    ).toBeGreaterThan(0);
    expect(inkIn(ctx, 0, 0, 400, PLATE.y - 2)).toBe(0);
    expect(inkIn(ctx, 0, PLATE.y + PLATE.h + 2, 400, 6)).toBe(0);
  });

  it("draws the highlighted one apart from the rest", () => {
    const dim = context();
    drawControl(dim, PLATE, "CONTINUE", false);
    const lit = context();
    drawControl(lit, PLATE, "CONTINUE", true);
    const before = dim.getImageData(0, 0, 400, 120).data;
    const after = lit.getImageData(0, 0, 400, 120).data;
    let differing = 0;
    for (let index = 0; index < before.length; index += 4) {
      if (before[index] !== after[index]) differing += 1;
    }
    expect(differing).toBeGreaterThan(0);
  });

  it("hands the context back as it found it", () => {
    const ctx = context();
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    drawControl(ctx, PLATE, "PAUSE", true);
    expect(ctx.textBaseline).toBe("alphabetic");
    expect(ctx.textAlign).toBe("left");
  });
});

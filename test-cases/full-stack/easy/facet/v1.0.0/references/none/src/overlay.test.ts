import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { Diagnostics, OVERLAY_KEY } from "./overlay";

/** A real 2D context, so the panel is checked against a genuine raster. */
function context(width = 400, height = 200): CanvasRenderingContext2D {
  const canvas = createCanvas(width, height);
  return canvas.getContext("2d") as unknown as CanvasRenderingContext2D;
}

/** Whether any pixel in the panel's corner has been painted. */
function painted(ctx: CanvasRenderingContext2D): boolean {
  const data = ctx.getImageData(0, 0, 40, 40).data;
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] !== 0) return true;
  }
  return false;
}

describe("Diagnostics", () => {
  it("is toggled by the backtick key", () => {
    expect(OVERLAY_KEY).toBe("Backquote");
  });

  it("starts hidden and toggles both ways", () => {
    const panel = new Diagnostics<number>();
    expect(panel.visible()).toBe(false);
    panel.toggle();
    expect(panel.visible()).toBe(true);
    panel.toggle();
    expect(panel.visible()).toBe(false);
  });

  it("keeps the lines in the order they were registered in", () => {
    const panel = new Diagnostics<{ a: number; b: string }>();
    panel.register("alpha", (state) => state.a);
    panel.register("beta", (state) => state.b);
    expect(panel.lines({ count: 3, dt: 0.016 }, { a: 1, b: "x" })).toEqual([
      "frame 3  dt 16.00ms",
      "alpha 1",
      "beta x",
    ]);
  });

  it("reads the state it is handed rather than one it closed over", () => {
    const panel = new Diagnostics<number>();
    panel.register("score", (state) => state);
    expect(panel.lines({ count: 0, dt: 0 }, 7)[1]).toBe("score 7");
    expect(panel.lines({ count: 0, dt: 0 }, 9)[1]).toBe("score 9");
  });

  it("shortens a fractional number and passes a boolean through", () => {
    const panel = new Diagnostics<number>();
    panel.register("t", () => 1.23456);
    panel.register("on", () => true);
    const lines = panel.lines({ count: 0, dt: 0 }, 0);
    expect(lines[1]).toBe("t 1.23");
    expect(lines[2]).toBe("on true");
  });

  it("reports a throwing source in its own line rather than raising", () => {
    const panel = new Diagnostics<number>();
    panel.register("bad", () => {
      throw new Error("no");
    });
    expect(panel.lines({ count: 0, dt: 0 }, 0)[1]).toBe("bad <no>");
  });

  it("reports a source that threw a non-error too", () => {
    const panel = new Diagnostics<number>();
    panel.register("bad", () => {
      throw "no";
    });
    expect(panel.lines({ count: 0, dt: 0 }, 0)[1]).toBe("bad <error>");
  });

  it("draws nothing while it is hidden", () => {
    const panel = new Diagnostics<number>();
    panel.register("score", (state) => state);
    const ctx = context();
    panel.draw(ctx, { count: 1, dt: 0.016 }, 5);
    expect(painted(ctx)).toBe(false);
  });

  it("draws the panel while it is shown, and restores the transform", () => {
    const panel = new Diagnostics<number>();
    panel.register("score", (state) => state);
    const ctx = context();
    ctx.setTransform(2, 0, 0, 2, 10, 10);
    panel.toggle();
    panel.draw(ctx, { count: 1, dt: 0.016 }, 5);
    expect(painted(ctx)).toBe(true);
    const after = ctx.getTransform();
    expect([after.a, after.d, after.e, after.f]).toEqual([2, 2, 10, 10]);
  });
});

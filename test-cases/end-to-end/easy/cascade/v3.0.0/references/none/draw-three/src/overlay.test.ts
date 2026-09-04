// The debug overlay: read-only, off at the start, and never able to fail a frame.

import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { Diagnostics } from "./overlay";

const frame = { count: 12, dt: 1 / 60 };

describe("Diagnostics", () => {
  it("starts hidden and toggles", () => {
    const panel = new Diagnostics();
    expect(panel.visible()).toBe(false);
    panel.toggle();
    expect(panel.visible()).toBe(true);
    panel.toggle();
    expect(panel.visible()).toBe(false);
  });

  it("keeps its lines in the order the sources were named", () => {
    const panel = new Diagnostics();
    panel.register("screen", () => "playing");
    panel.register("stock", () => 24);
    expect(panel.lines(frame)).toEqual([
      "frame 12  dt 16.67ms",
      "screen playing",
      "stock 24",
    ]);
    expect(panel.size).toBe(2);
  });

  it("calls every source fresh on every read", () => {
    const panel = new Diagnostics();
    let value = 1;
    panel.register("n", () => value);
    expect(panel.lines(frame)[1]).toBe("n 1");
    value = 2;
    expect(panel.lines(frame)[1]).toBe("n 2");
  });

  it("reports a throwing source rather than raising it", () => {
    const panel = new Diagnostics();
    panel.register("bad", () => {
      throw new Error("no read");
    });
    expect(panel.lines(frame)[1]).toBe("bad <no read>");
  });

  it("shortens a fractional number to two places", () => {
    const panel = new Diagnostics();
    panel.register("t", () => 1.23456);
    expect(panel.lines(frame)[1]).toBe("t 1.23");
  });
});

describe("drawing the panel", () => {
  /** A context carrying a transform of the caller's, to be handed back intact. */
  function context(): CanvasRenderingContext2D {
    const ctx = createCanvas(400, 200).getContext("2d");
    ctx.setTransform(2, 0, 0, 2, 30, 40);
    return ctx as unknown as CanvasRenderingContext2D;
  }

  it("draws nothing while it is hidden", () => {
    const ctx = context();
    const panel = new Diagnostics();
    panel.register("screen", () => "playing");
    panel.draw(ctx, frame);
    const image = ctx.getImageData(4, 4, 1, 1);
    expect(image.data[3]).toBe(0);
  });

  it("paints over the finished frame once it is shown", () => {
    const ctx = context();
    const panel = new Diagnostics();
    panel.register("screen", () => "playing");
    panel.toggle();
    panel.draw(ctx, frame);
    expect(ctx.getImageData(4, 4, 1, 1).data[3]).toBeGreaterThan(0);
  });

  it("hands the transform back exactly as it was", () => {
    const ctx = context();
    const panel = new Diagnostics();
    panel.register("screen", () => "playing");
    panel.toggle();
    panel.draw(ctx, frame);
    const matrix = ctx.getTransform();
    expect([matrix.a, matrix.d, matrix.e, matrix.f]).toEqual([2, 2, 30, 40]);
  });
});

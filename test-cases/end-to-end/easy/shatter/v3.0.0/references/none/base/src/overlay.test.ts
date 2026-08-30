import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";

import { FIELD_H, FIELD_W } from "./constants";
import { Diagnostics, OVERLAY_KEY } from "./overlay";

describe("the debug overlay", () => {
  it("is off until it is toggled, and toggles back", () => {
    const panel = new Diagnostics();
    expect(panel.visible()).toBe(false);
    panel.toggle();
    expect(panel.visible()).toBe(true);
    panel.toggle();
    expect(panel.visible()).toBe(false);
  });

  it("is toggled by the backtick key", () => {
    expect(OVERLAY_KEY).toBe("Backquote");
  });

  it("keeps the lines in the order they were registered in", () => {
    const panel = new Diagnostics();
    panel.register("screen", () => "playing");
    panel.register("score", () => 40);
    expect(panel.lines({ count: 3, dt: 0.016 })).toEqual([
      "tick 3  frame 16.00ms",
      "screen playing",
      "score 40",
    ]);
  });

  it("calls every source afresh, so the panel reports the live game", () => {
    const panel = new Diagnostics();
    let reads = 0;
    panel.register("reads", () => {
      reads += 1;
      return reads;
    });
    panel.lines({ count: 0, dt: 0 });
    panel.lines({ count: 0, dt: 0 });
    expect(reads).toBe(2);
  });

  it("shortens a fractional number to two places", () => {
    const panel = new Diagnostics();
    panel.register("value", () => 1 / 3);
    expect(panel.lines({ count: 0, dt: 0 })[1]).toBe("value 0.33");
  });

  it("reports a source that threw rather than raising it", () => {
    const panel = new Diagnostics();
    panel.register("bad", () => {
      throw new Error("nope");
    });
    expect(panel.lines({ count: 0, dt: 0 })[1]).toBe("bad <nope>");
  });

  it("draws nothing while it is hidden, and a panel once it is shown", () => {
    const canvas = createCanvas(FIELD_W, FIELD_H);
    const ctx = canvas.getContext("2d") as unknown as CanvasRenderingContext2D;
    const panel = new Diagnostics();
    panel.register("screen", () => "playing");
    panel.register("rocks", () => 4);

    const lit = (): number => {
      const { data } = ctx.getImageData(0, 0, 200, 60);
      let count = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0) count += 1;
      return count;
    };

    panel.draw(ctx, { count: 0, dt: 0 });
    expect(lit()).toBe(0);

    panel.toggle();
    panel.draw(ctx, { count: 12, dt: 0.016 });
    expect(lit()).toBeGreaterThan(500);
  });

  it("hands the caller's transform back, having drawn in device space", () => {
    const canvas = createCanvas(FIELD_W, FIELD_H);
    const ctx = canvas.getContext("2d") as unknown as CanvasRenderingContext2D;
    ctx.setTransform(2, 0, 0, 2, 40, 30);
    const panel = new Diagnostics();
    panel.register("value", () => "x");
    panel.toggle();
    panel.draw(ctx, { count: 1, dt: 0.016 });
    const after = ctx.getTransform();
    expect(after.a).toBe(2);
    expect(after.d).toBe(2);
    expect(after.e).toBe(40);
    expect(after.f).toBe(30);
  });

  it("shortens a value that is neither a number nor a string", () => {
    const panel = new Diagnostics();
    panel.register("pair", () => ({ x: 1 }));
    expect(panel.lines({ count: 0, dt: 0 })[1]).toBe('pair {"x":1}');
  });
});

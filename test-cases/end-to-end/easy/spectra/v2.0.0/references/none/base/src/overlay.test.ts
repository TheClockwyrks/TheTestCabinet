import { describe, expect, it } from "vitest";

import { createCanvas } from "@napi-rs/canvas";

import { OVERLAY_KEY } from "./constants";
import { Diagnostics } from "./overlay";

/** A real 2D context, so the panel is drawn rather than mocked. */
function context(): CanvasRenderingContext2D {
  return createCanvas(400, 200).getContext(
    "2d",
  ) as unknown as CanvasRenderingContext2D;
}

describe("the diagnostics overlay", () => {
  it("is off when the game starts, and toggles", () => {
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

  it("keeps the order its sources were named in", () => {
    const panel = new Diagnostics();
    panel.register("first", () => 1);
    panel.register("second", () => 2);
    panel.register("third", () => 3);
    expect(panel.names()).toEqual(["first", "second", "third"]);
    expect(panel.lines({ count: 0, dt: 0 }).slice(1)).toEqual([
      "first 1",
      "second 2",
      "third 3",
    ]);
  });

  it("calls every source fresh on every read", () => {
    const panel = new Diagnostics();
    let value = 0;
    panel.register("counter", () => {
      value += 1;
      return value;
    });
    expect(panel.lines({ count: 0, dt: 0 })[1]).toBe("counter 1");
    expect(panel.lines({ count: 0, dt: 0 })[1]).toBe("counter 2");
  });

  it("reports a throwing source in its own line rather than raising", () => {
    const panel = new Diagnostics();
    panel.register("bad", () => {
      throw new Error("no");
    });
    panel.register("worse", () => {
      throw "a string";
    });
    const lines = panel.lines({ count: 1, dt: 0.016 });
    expect(lines[1]).toBe("bad <no>");
    expect(lines[2]).toBe("worse <error>");
  });

  it("shortens a number and passes a string through", () => {
    const panel = new Diagnostics();
    panel.register("whole", () => 7);
    panel.register("fraction", () => 1 / 3);
    panel.register("word", () => "cyan");
    panel.register("thing", () => ({ a: 1 }));
    const lines = panel.lines({ count: 0, dt: 0 }).slice(1);
    expect(lines).toEqual([
      "whole 7",
      "fraction 0.33",
      "word cyan",
      'thing {"a":1}',
    ]);
  });

  it("heads the panel with the frame and its delta", () => {
    const panel = new Diagnostics();
    expect(panel.lines({ count: 42, dt: 1 / 60 })[0]).toBe(
      "frame 42  dt 16.67ms",
    );
  });

  it("draws nothing while it is hidden and something while it is shown", () => {
    const panel = new Diagnostics();
    panel.register("screen", () => "title");
    const ctx = context();
    const before = ctx.getImageData(2, 2, 1, 1).data[3];
    panel.draw(ctx, { count: 0, dt: 0 });
    expect(ctx.getImageData(2, 2, 1, 1).data[3]).toBe(before);
    panel.toggle();
    panel.draw(ctx, { count: 0, dt: 0 });
    expect(ctx.getImageData(2, 2, 1, 1).data[3]).toBeGreaterThan(0);
  });

  it("hands the context back with the transform it was given", () => {
    const panel = new Diagnostics();
    panel.register("screen", () => "title");
    panel.toggle();
    const ctx = context();
    ctx.setTransform(2, 0, 0, 2, 30, 40);
    const before = ctx.getTransform();
    panel.draw(ctx, { count: 0, dt: 0 });
    const after = ctx.getTransform();
    expect([after.a, after.d, after.e, after.f]).toEqual([
      before.a,
      before.d,
      before.e,
      before.f,
    ]);
  });
});

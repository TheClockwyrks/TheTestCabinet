import { describe, expect, it } from "vitest";
import { Diagnostics, OVERLAY_KEY } from "./overlay";
import { stageContext } from "./harness.test-support";

describe("the diagnostics panel", () => {
  it("is hidden until it is toggled, and hides again", () => {
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

  it("keeps its lines in the order they were named, heading first", () => {
    const panel = new Diagnostics();
    panel.register("screen", () => "playing");
    panel.register("stock", () => 24);
    expect(panel.lines({ count: 3, dt: 1 / 60 })).toEqual([
      "frame 3  dt 16.67ms",
      "screen playing",
      "stock 24",
    ]);
  });

  it("calls every source fresh on each read", () => {
    const panel = new Diagnostics();
    let value = 1;
    panel.register("n", () => value);
    expect(panel.lines({ count: 0, dt: 0 })[1]).toBe("n 1");
    value = 2;
    expect(panel.lines({ count: 0, dt: 0 })[1]).toBe("n 2");
  });

  it("reports a throwing source in its own line rather than raising", () => {
    const panel = new Diagnostics();
    panel.register("bad", () => {
      throw new Error("nope");
    });
    expect(panel.lines({ count: 0, dt: 0 })[1]).toBe("bad <nope>");
  });

  it("draws nothing while it is hidden, and leaves the transform as it found it", () => {
    const { ctx } = stageContext();
    const panel = new Diagnostics();
    panel.register("screen", () => "title");
    ctx.setTransform(2, 0, 0, 2, 10, 20);
    panel.draw(ctx, { count: 1, dt: 0 });
    panel.toggle();
    panel.draw(ctx, { count: 1, dt: 0 });
    const after = ctx.getTransform();
    expect([after.a, after.d, after.e, after.f]).toEqual([2, 2, 10, 20]);
  });
});

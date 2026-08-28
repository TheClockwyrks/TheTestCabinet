import { describe, expect, it } from "vitest";

import { Diagnostics, OVERLAY_KEY } from "./overlay";
import { stageContext } from "./harness.test-support";

describe("Diagnostics", () => {
  it("starts hidden and toggles", () => {
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

  it("heads its lines with the tick the panel is drawn over", () => {
    const panel = new Diagnostics();
    expect(panel.lines({ count: 42, time: 0.35 })[0]).toBe("tick 42  t 0.35s");
  });

  it("calls every source afresh, so the panel reports the live game", () => {
    const panel = new Diagnostics();
    let value = 1;
    panel.register("depth", () => value);
    expect(panel.lines({ count: 0, time: 0 })[1]).toBe("depth 1");
    value = 2;
    expect(panel.lines({ count: 0, time: 0 })[1]).toBe("depth 2");
  });

  it("keeps the order its sources were named in", () => {
    const panel = new Diagnostics();
    panel.register("a", () => 1);
    panel.register("b", () => 2);
    expect(panel.lines({ count: 0, time: 0 }).slice(1)).toEqual(["a 1", "b 2"]);
  });

  it("formats a fraction to two places and a string as it stands", () => {
    const panel = new Diagnostics();
    panel.register("g", () => 0.3456);
    panel.register("screen", () => "playing");
    panel.register("tile", () => ({ tx: 1 }));
    expect(panel.lines({ count: 0, time: 0 }).slice(1)).toEqual([
      "g 0.35",
      "screen playing",
      'tile {"tx":1}',
    ]);
  });

  it("reports a throwing source in its own line rather than raising it", () => {
    const panel = new Diagnostics();
    panel.register("broken", () => {
      throw new Error("no such field");
    });
    expect(panel.lines({ count: 0, time: 0 })[1]).toBe(
      "broken <no such field>",
    );
  });

  it("draws nothing while it is hidden", () => {
    const { ctx, read } = stageContext();
    const panel = new Diagnostics();
    panel.register("depth", () => 1);
    panel.draw(ctx, { count: 0, time: 0 });
    expect(read(4, 4)[3]).toBe(0);
  });

  it("draws its panel in device space and restores the transform", () => {
    const { ctx, read } = stageContext();
    ctx.setTransform(2, 0, 0, 2, 40, 40);
    const panel = new Diagnostics();
    panel.register("depth", () => 1);
    panel.toggle();
    panel.draw(ctx, { count: 0, time: 0 });
    // Drawn at the canvas's own origin, not the transformed one.
    expect(read(4, 4)[3]).toBeGreaterThan(0);
    const after = ctx.getTransform();
    expect([after.a, after.d, after.e, after.f]).toEqual([2, 2, 40, 40]);
  });
});

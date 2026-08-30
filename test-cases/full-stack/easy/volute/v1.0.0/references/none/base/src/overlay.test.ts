import { describe, expect, it } from "vitest";
import { Diagnostics } from "./overlay";

describe("the debug overlay", () => {
  it("starts hidden and toggles", () => {
    const panel = new Diagnostics();
    expect(panel.visible()).toBe(false);
    panel.toggle();
    expect(panel.visible()).toBe(true);
    panel.toggle();
    expect(panel.visible()).toBe(false);
  });

  it("reads every source fresh on every read", () => {
    const panel = new Diagnostics();
    let value = 1;
    panel.register("count", () => value);
    expect(panel.lines({ ticks: 0, dt: 0 })).toContain("count 1");
    value = 2;
    expect(panel.lines({ ticks: 0, dt: 0 })).toContain("count 2");
  });

  it("reports a throwing source rather than raising it", () => {
    const panel = new Diagnostics();
    panel.register("bad", () => {
      throw new Error("nope");
    });
    expect(panel.lines({ ticks: 0, dt: 0 })).toContain("bad <nope>");
  });

  it("formats numbers, strings, null and objects on one line each", () => {
    const panel = new Diagnostics();
    panel.register("whole", () => 3);
    panel.register("real", () => 1.23456);
    panel.register("word", () => "playing");
    panel.register("nothing", () => null);
    panel.register("shape", () => ({ a: 1 }));
    const lines = panel.lines({ ticks: 7, dt: 1 / 60 });
    expect(lines[0]).toContain("tick 7");
    expect(lines).toContain("whole 3");
    expect(lines).toContain("real 1.23");
    expect(lines).toContain("word playing");
    expect(lines).toContain("nothing none");
    expect(lines).toContain('shape {"a":1}');
  });

  it("draws nothing while it is hidden", () => {
    const panel = new Diagnostics();
    let calls = 0;
    const ctx = {
      save: () => {
        calls += 1;
      },
    } as unknown as CanvasRenderingContext2D;
    panel.draw(ctx, { ticks: 0, dt: 0 });
    expect(calls).toBe(0);
  });
});

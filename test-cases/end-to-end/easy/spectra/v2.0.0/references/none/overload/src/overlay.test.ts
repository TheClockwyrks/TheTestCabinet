// Spectra — the diagnostics overlay's own behaviour, without a canvas.

import { describe, expect, it } from "vitest";
import { Diagnostics } from "./overlay";

describe("Diagnostics", () => {
  it("starts hidden and toggles both ways", () => {
    const panel = new Diagnostics();
    expect(panel.visible()).toBe(false);
    panel.toggle();
    expect(panel.visible()).toBe(true);
    panel.toggle();
    expect(panel.visible()).toBe(false);
  });

  it("keeps its lines in the order they were named, heading first", () => {
    const panel = new Diagnostics();
    panel.register("first", () => 1);
    panel.register("second", () => "two");
    const lines = panel.lines({ count: 7, dt: 1 / 60 });
    expect(lines[0]).toContain("frame 7");
    expect(lines[1]).toBe("first 1");
    expect(lines[2]).toBe("second two");
  });

  it("calls each source fresh on every read", () => {
    const panel = new Diagnostics();
    let value = 0;
    panel.register("counter", () => (value += 1));
    panel.lines({ count: 0, dt: 0 });
    expect(panel.lines({ count: 0, dt: 0 })[1]).toBe("counter 2");
  });

  it("reports a throwing source in its own line rather than raising", () => {
    const panel = new Diagnostics();
    panel.register("bad", () => {
      throw new Error("nope");
    });
    expect(panel.lines({ count: 0, dt: 0 })[1]).toBe("bad <nope>");
  });

  it("formats a number, a string and an object each on one line", () => {
    const panel = new Diagnostics();
    panel.register("whole", () => 4);
    panel.register("fraction", () => 1 / 3);
    panel.register("shape", () => ({ a: 1 }));
    const lines = panel.lines({ count: 0, dt: 0 });
    expect(lines[1]).toBe("whole 4");
    expect(lines[2]).toBe("fraction 0.33");
    expect(lines[3]).toBe('shape {"a":1}');
  });

  it("draws nothing while it is hidden", () => {
    const panel = new Diagnostics();
    let calls = 0;
    const ctx = {
      save: () => (calls += 1),
    } as unknown as CanvasRenderingContext2D;
    panel.draw(ctx, { count: 0, dt: 0 });
    expect(calls).toBe(0);
  });
});

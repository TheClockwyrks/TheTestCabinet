import { describe, expect, it } from "vitest";

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
});

// The diagnostics overlay: named sources read fresh on every draw, each a pure
// read of the state it is handed, with a throwing source reported in its line
// rather than raised. The drawing itself is checked through the runtime in
// runtime.test.ts; here the panel's content and visibility are driven
// directly.

import { describe, expect, it } from "vitest";
import { Diagnostics } from "./overlay";

interface ToyState {
  score: number;
  label: string;
}

const FRAME = { count: 12, dt: 1 / 60 };

describe("the panel's lines", () => {
  it("leads with the frame position and lists sources in naming order", () => {
    const panel = new Diagnostics<ToyState>();
    panel.register("score", (state) => state.score);
    panel.register("label", (state) => state.label);
    expect(panel.lines(FRAME, { score: 3, label: "ok" })).toEqual([
      "frame 12  dt 16.67ms",
      "score 3",
      "label ok",
    ]);
  });

  it("reads the state it is handed, not one it closed over", () => {
    const panel = new Diagnostics<ToyState>();
    panel.register("score", (state) => state.score);
    expect(panel.lines(FRAME, { score: 1, label: "" })[1]).toBe("score 1");
    expect(panel.lines(FRAME, { score: 2, label: "" })[1]).toBe("score 2");
  });

  it("formats numbers briefly and objects as JSON", () => {
    const panel = new Diagnostics<ToyState>();
    panel.register("fraction", () => 1 / 3);
    panel.register("flag", () => true);
    panel.register("pair", () => ({ a: 1 }));
    const lines = panel.lines(FRAME, { score: 0, label: "" });
    expect(lines[1]).toBe("fraction 0.33");
    expect(lines[2]).toBe("flag true");
    expect(lines[3]).toBe('pair {"a":1}');
  });

  it("reports a throwing source in its own line rather than raising", () => {
    const panel = new Diagnostics<ToyState>();
    panel.register("bad", () => {
      throw new Error("broken read");
    });
    expect(panel.lines(FRAME, { score: 0, label: "" })[1]).toBe(
      "bad <broken read>",
    );
  });

  it("replaces a source re-registered under the same name", () => {
    const panel = new Diagnostics<ToyState>();
    panel.register("value", () => 1);
    panel.register("value", () => 2);
    const lines = panel.lines(FRAME, { score: 0, label: "" });
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe("value 2");
  });
});

describe("visibility", () => {
  it("starts hidden and toggles", () => {
    const panel = new Diagnostics<ToyState>();
    expect(panel.visible()).toBe(false);
    panel.toggle();
    expect(panel.visible()).toBe(true);
    panel.toggle();
    expect(panel.visible()).toBe(false);
  });
});

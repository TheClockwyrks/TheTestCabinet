// The diagnostics overlay: named sources read fresh on every draw, each a pure
// read of the state it is handed, with a throwing source reported in its line
// rather than raised. The drawing over a real canvas is checked through the
// runtime in runtime.test.ts; here the panel's content, its visibility, and
// what it does with nothing to show are driven directly.

import { describe, expect, it } from "vitest";
import { Diagnostics } from "./overlay";

interface ToyState {
  score: number;
  label: string;
}

describe("the panel's lines", () => {
  it("lists the registered sources, in naming order, and nothing else", () => {
    const panel = new Diagnostics<ToyState>();
    panel.register("score", (state) => state.score);
    panel.register("label", (state) => state.label);
    expect(panel.lines({ score: 3, label: "ok" })).toEqual([
      "score 3",
      "label ok",
    ]);
  });

  it("lists nothing at all until a source is registered", () => {
    expect(
      new Diagnostics<ToyState>().lines({ score: 3, label: "ok" }),
    ).toEqual([]);
  });

  it("reads the state it is handed, not one it closed over", () => {
    const panel = new Diagnostics<ToyState>();
    panel.register("score", (state) => state.score);
    expect(panel.lines({ score: 1, label: "" })[0]).toBe("score 1");
    expect(panel.lines({ score: 2, label: "" })[0]).toBe("score 2");
  });

  it("formats numbers briefly and objects as JSON", () => {
    const panel = new Diagnostics<ToyState>();
    panel.register("fraction", () => 1 / 3);
    panel.register("flag", () => true);
    panel.register("pair", () => ({ a: 1 }));
    const lines = panel.lines({ score: 0, label: "" });
    expect(lines[0]).toBe("fraction 0.33");
    expect(lines[1]).toBe("flag true");
    expect(lines[2]).toBe('pair {"a":1}');
  });

  it("reports a throwing source in its own line rather than raising", () => {
    const panel = new Diagnostics<ToyState>();
    panel.register("bad", () => {
      throw new Error("broken read");
    });
    expect(panel.lines({ score: 0, label: "" })[0]).toBe("bad <broken read>");
  });

  it("replaces a source re-registered under the same name", () => {
    const panel = new Diagnostics<ToyState>();
    panel.register("value", () => 1);
    panel.register("value", () => 2);
    const lines = panel.lines({ score: 0, label: "" });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe("value 2");
  });
});

describe("drawing", () => {
  it("touches the context for nothing when no source is registered", () => {
    const calls: string[] = [];
    const ctx = new Proxy(
      {},
      {
        get(_target, key) {
          return (...args: unknown[]) => {
            calls.push(String(key));
            return key === "measureText" ? { width: args.length } : undefined;
          };
        },
        set() {
          calls.push("<property>");
          return true;
        },
      },
    ) as CanvasRenderingContext2D;
    const panel = new Diagnostics<ToyState>();
    panel.toggle();
    panel.draw(ctx, { score: 0, label: "" });
    expect(calls).toEqual([]);
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

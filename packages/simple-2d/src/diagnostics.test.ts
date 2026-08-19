import { describe, expect, it } from "vitest";
import { Diagnostics } from "./diagnostics";

interface RecordedCall {
  op: string;
  args: unknown[];
  /** The style state at the moment of the call, since `restore` is a fake here. */
  font: string;
  fillStyle: string;
}

/**
 * A stand-in for a 2D context that records the calls the overlay makes.
 *
 * jsdom's `getContext("2d")` returns `null` without a native canvas binding, so the
 * overlay is checked against a recorder rather than a real surface — which is also
 * what lets a test assert the *order* of `save`/`restore` around the drawing.
 */
function fakeContext(): { calls: RecordedCall[]; ctx: CanvasRenderingContext2D } {
  const calls: RecordedCall[] = [];
  const ctx = {
    font: "",
    fillStyle: "",
    textBaseline: "",
    textAlign: "",
    save(): void {
      record("save", []);
    },
    restore(): void {
      record("restore", []);
    },
    fillRect(x: number, y: number, w: number, h: number): void {
      record("fillRect", [x, y, w, h]);
    },
    fillText(text: string, x: number, y: number): void {
      record("fillText", [text, x, y]);
    },
    measureText(text: string): TextMetrics {
      return { width: text.length * 7 } as TextMetrics;
    },
  };
  function record(op: string, args: unknown[]): void {
    calls.push({ op, args, font: ctx.font, fillStyle: ctx.fillStyle });
  }
  return { calls, ctx: ctx as unknown as CanvasRenderingContext2D };
}

/** The text of every line the overlay drew. */
function drawnLines(calls: RecordedCall[]): string[] {
  return calls.filter((c) => c.op === "fillText").map((c) => String(c.args[0]));
}

describe("Diagnostics.read", () => {
  it("round-trips registered sources by name", () => {
    const diagnostics = new Diagnostics();
    diagnostics.register("score", () => 42);
    diagnostics.register("mode", () => "serve");

    expect(diagnostics.read()).toEqual({ score: 42, mode: "serve" });
  });

  it("evaluates sources on every read rather than sampling at registration", () => {
    const diagnostics = new Diagnostics();
    let frames = 0;
    diagnostics.register("frames", () => ++frames);

    expect(diagnostics.read()["frames"]).toBe(1);
    expect(diagnostics.read()["frames"]).toBe(2);
  });

  it("re-registering a name replaces the source and keeps its position", () => {
    const diagnostics = new Diagnostics();
    diagnostics.register("a", () => 1);
    diagnostics.register("b", () => 2);
    diagnostics.register("a", () => 99);

    expect(Object.keys(diagnostics.read())).toEqual(["a", "b"]);
    expect(diagnostics.read()["a"]).toBe(99);
  });

  it("contains a throwing source and still reads the others", () => {
    const diagnostics = new Diagnostics();
    diagnostics.register("ok", () => "fine");
    diagnostics.register("boom", () => {
      throw new Error("no ball yet");
    });
    diagnostics.register("after", () => 7);

    expect(diagnostics.read()).toEqual({ ok: "fine", boom: "no ball yet", after: 7 });
  });

  it("stringifies a non-Error throw", () => {
    const diagnostics = new Diagnostics();
    diagnostics.register("odd", () => {
      throw "just a string";
    });

    expect(diagnostics.read()["odd"]).toBe("just a string");
  });

  it("reads whether or not the overlay is visible", () => {
    const diagnostics = new Diagnostics();
    diagnostics.register("x", () => 1);

    expect(diagnostics.enabled()).toBe(false);
    expect(diagnostics.read()).toEqual({ x: 1 });
  });
});

describe("Diagnostics enablement", () => {
  it("starts hidden and follows setEnabled", () => {
    const diagnostics = new Diagnostics();
    expect(diagnostics.enabled()).toBe(false);

    diagnostics.setEnabled(true);
    expect(diagnostics.enabled()).toBe(true);

    diagnostics.setEnabled(false);
    expect(diagnostics.enabled()).toBe(false);
  });

  it("toggle flips in both directions", () => {
    const diagnostics = new Diagnostics();

    diagnostics.toggle();
    expect(diagnostics.enabled()).toBe(true);

    diagnostics.toggle();
    expect(diagnostics.enabled()).toBe(false);
  });
});

describe("Diagnostics.draw", () => {
  it("draws nothing while disabled", () => {
    const diagnostics = new Diagnostics();
    diagnostics.register("score", () => 3);
    const { calls, ctx } = fakeContext();

    diagnostics.draw(ctx, 640, 360);

    expect(calls).toEqual([]);
  });

  it("draws nothing when no sources are registered", () => {
    const diagnostics = new Diagnostics();
    diagnostics.setEnabled(true);
    const { calls, ctx } = fakeContext();

    diagnostics.draw(ctx, 640, 360);

    expect(calls).toEqual([]);
  });

  it("draws a panel and one line per source, in a monospace face", () => {
    const diagnostics = new Diagnostics();
    diagnostics.register("score", () => 3);
    diagnostics.register("mode", () => "rally");
    diagnostics.setEnabled(true);
    const { calls, ctx } = fakeContext();

    diagnostics.draw(ctx, 640, 360);

    const panel = calls.find((c) => c.op === "fillRect");
    expect(panel).toBeDefined();
    expect(drawnLines(calls)).toEqual(["score: 3", "mode: rally"]);
    for (const line of calls.filter((c) => c.op === "fillText")) {
      expect(line.font).toContain("monospace");
    }
  });

  it("balances save and restore around the drawing", () => {
    const diagnostics = new Diagnostics();
    diagnostics.register("score", () => 3);
    diagnostics.setEnabled(true);
    const { calls, ctx } = fakeContext();

    diagnostics.draw(ctx, 640, 360);

    const saves = calls.filter((c) => c.op === "save").length;
    const restores = calls.filter((c) => c.op === "restore").length;
    expect(saves).toBe(1);
    expect(restores).toBe(1);
    expect(calls[0]?.op).toBe("save");
    expect(calls[calls.length - 1]?.op).toBe("restore");
  });

  it("restores the context even when the context throws mid-draw", () => {
    const diagnostics = new Diagnostics();
    diagnostics.register("score", () => 3);
    diagnostics.setEnabled(true);
    const { calls, ctx } = fakeContext();
    // A lost or fake context can fail at any call; the game's style must come back.
    ctx.fillText = () => {
      throw new Error("context lost");
    };

    expect(() => diagnostics.draw(ctx, 640, 360)).toThrow("context lost");
    expect(calls.filter((c) => c.op === "restore").length).toBe(1);
  });

  it("keeps drawing when a source throws, showing its message", () => {
    const diagnostics = new Diagnostics();
    diagnostics.register("boom", () => {
      throw new Error("no ball yet");
    });
    diagnostics.register("score", () => 3);
    diagnostics.setEnabled(true);
    const { calls, ctx } = fakeContext();

    diagnostics.draw(ctx, 640, 360);

    expect(drawnLines(calls)).toEqual(["boom: no ball yet", "score: 3"]);
    expect(calls.filter((c) => c.op === "restore").length).toBe(1);
  });

  it("JSON-stringifies object values and rounds noisy floats", () => {
    const diagnostics = new Diagnostics();
    diagnostics.register("ball", () => ({ x: 1, y: 2 }));
    diagnostics.register("speed", () => 1 / 3);
    diagnostics.register("lives", () => 3);
    diagnostics.setEnabled(true);
    const { calls, ctx } = fakeContext();

    diagnostics.draw(ctx, 640, 360);

    expect(drawnLines(calls)).toEqual(['ball: {"x":1,"y":2}', "speed: 0.333", "lives: 3"]);
  });

  it("survives a cyclic value", () => {
    const diagnostics = new Diagnostics();
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    diagnostics.register("cyclic", () => cyclic);
    diagnostics.setEnabled(true);
    const { calls, ctx } = fakeContext();

    expect(() => diagnostics.draw(ctx, 640, 360)).not.toThrow();
    expect(drawnLines(calls)).toHaveLength(1);
  });

  it("clamps the panel to the logical canvas", () => {
    const diagnostics = new Diagnostics();
    diagnostics.register("a-very-long-diagnostic-name", () => "with a long value too");
    diagnostics.setEnabled(true);
    const { calls, ctx } = fakeContext();

    diagnostics.draw(ctx, 120, 90);

    const panel = calls.find((c) => c.op === "fillRect");
    expect(panel?.args[2] as number).toBeLessThanOrEqual(120);
    expect(panel?.args[3] as number).toBeLessThanOrEqual(90);
  });
});

import { describe, expect, it } from "vitest";
import type { DiagnosticValue, FrameMetrics } from "./contract";
import { Diagnostics, type FrameTimings } from "./diagnostics";

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
 * what lets a test assert the *order* of `save`/`restore` around the drawing, and
 * tell the graph's bars from the panel behind them by the fill each was drawn with.
 */
function fakeContext(): {
  calls: RecordedCall[];
  ctx: CanvasRenderingContext2D;
} {
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

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function rects(calls: RecordedCall[]): (Rect & { fillStyle: string })[] {
  return calls
    .filter((c) => c.op === "fillRect")
    .map((c) => ({
      x: c.args[0] as number,
      y: c.args[1] as number,
      w: c.args[2] as number,
      h: c.args[3] as number,
      fillStyle: c.fillStyle,
    }));
}

/**
 * The graph's bars: the rectangles sharing the fill of the last one drawn.
 *
 * Identifying them by fill rather than by position keeps the test off the overlay's
 * private geometry — it asserts what a reader sees (a band of bars in one colour),
 * not the constants that place them.
 */
function bars(calls: RecordedCall[]): Rect[] {
  const drawn = rects(calls);
  const last = drawn[drawn.length - 1];
  if (last === undefined) return [];
  return drawn.filter((r) => r.fillStyle === last.fillStyle);
}

/** The plot area the bars stand in: the rectangle drawn immediately before them. */
function plotArea(calls: RecordedCall[]): Rect | undefined {
  const drawn = rects(calls);
  const barFill = drawn[drawn.length - 1]?.fillStyle;
  const firstBar = drawn.findIndex((r) => r.fillStyle === barFill);
  return firstBar > 0 ? drawn[firstBar - 1] : undefined;
}

/** A frame loop's timing, as the overlay reads it. */
function timings(
  metrics: Partial<FrameMetrics>,
  series: readonly number[] = [],
): FrameTimings {
  const summary: FrameMetrics = {
    samples: series.length,
    meanMs: 0,
    p95Ms: 0,
    p99Ms: 0,
    ...metrics,
  };
  return { metrics: () => summary, series: () => series };
}

/** An overlay showing `values`, with no frames timed. */
function withSources(values: Record<string, DiagnosticValue>): Diagnostics {
  const diagnostics = new Diagnostics();
  for (const [name, value] of Object.entries(values))
    diagnostics.register(name, () => value);
  diagnostics.setEnabled(true);
  return diagnostics;
}

describe("Diagnostics.read", () => {
  it("returns one reading per source, in registration order", () => {
    const diagnostics = new Diagnostics();
    diagnostics.register("score", () => 42);
    diagnostics.register("mode", () => "serve");

    expect(diagnostics.read()).toEqual([
      { name: "score", value: 42 },
      { name: "mode", value: "serve" },
    ]);
  });

  it("reports each of the three value types as itself", () => {
    const diagnostics = new Diagnostics();
    diagnostics.register("phase", () => "rally");
    diagnostics.register("speed", () => 1 / 3);
    diagnostics.register("paused", () => false);

    expect(diagnostics.read()).toEqual([
      { name: "phase", value: "rally" },
      { name: "speed", value: 1 / 3 },
      { name: "paused", value: false },
    ]);
  });

  it("evaluates sources on every read rather than sampling at registration", () => {
    const diagnostics = new Diagnostics();
    let frames = 0;
    diagnostics.register("frames", () => ++frames);

    expect(diagnostics.read()).toEqual([{ name: "frames", value: 1 }]);
    expect(diagnostics.read()).toEqual([{ name: "frames", value: 2 }]);
  });

  it("re-registering a name replaces the source and keeps its position", () => {
    const diagnostics = new Diagnostics();
    diagnostics.register("a", () => 1);
    diagnostics.register("b", () => 2);
    diagnostics.register("a", () => 99);

    expect(diagnostics.read()).toEqual([
      { name: "a", value: 99 },
      { name: "b", value: 2 },
    ]);
  });

  it("holds one reading per name however often a name is re-registered", () => {
    const diagnostics = new Diagnostics();
    for (let i = 0; i < 5000; i++) diagnostics.register("frames", () => i);

    expect(diagnostics.read().map((reading) => reading.name)).toEqual([
      "frames",
    ]);
  });

  it("reports a throwing source as an error with no value, and reads the others", () => {
    const diagnostics = new Diagnostics();
    diagnostics.register("ok", () => "fine");
    diagnostics.register("boom", () => {
      throw new Error("no ball yet");
    });
    diagnostics.register("after", () => 7);

    const readings = diagnostics.read();

    expect(readings).toEqual([
      { name: "ok", value: "fine" },
      { name: "boom", error: "no ball yet" },
      { name: "after", value: 7 },
    ]);
    // A failure is not a reading of any type: nothing compares equal to the
    // message the panel happens to draw in the value's place.
    expect(readings[1]).not.toHaveProperty("value");
  });

  it("stringifies a non-Error throw", () => {
    const diagnostics = new Diagnostics();
    diagnostics.register("odd", () => {
      throw "just a string";
    });

    expect(diagnostics.read()).toEqual([
      { name: "odd", error: "just a string" },
    ]);
  });

  it("returns values unformatted", () => {
    const diagnostics = new Diagnostics();
    diagnostics.register("speed", () => 1 / 3);
    diagnostics.register("spin", () => Number.POSITIVE_INFINITY);

    expect(diagnostics.read()).toEqual([
      { name: "speed", value: 1 / 3 },
      { name: "spin", value: Number.POSITIVE_INFINITY },
    ]);
  });

  it("reads whether or not the overlay is visible, and leaves it as it found it", () => {
    const diagnostics = new Diagnostics();
    diagnostics.register("x", () => 1);

    expect(diagnostics.enabled()).toBe(false);
    expect(diagnostics.read()).toEqual([{ name: "x", value: 1 }]);
    expect(diagnostics.enabled()).toBe(false);

    diagnostics.setEnabled(true);
    expect(diagnostics.read()).toEqual([{ name: "x", value: 1 }]);
    expect(diagnostics.enabled()).toBe(true);
  });

  it("reads the same registry however often it is read", () => {
    const diagnostics = new Diagnostics();
    const state = { hits: 3 };
    diagnostics.register("hits", () => state.hits);

    const first = diagnostics.read();
    const second = diagnostics.read();

    expect(second).toEqual(first);
    expect(state).toEqual({ hits: 3 });
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

describe("Diagnostics.metrics", () => {
  it("reports an empty window before a loop is attached", () => {
    expect(new Diagnostics().metrics()).toEqual({
      samples: 0,
      meanMs: 0,
      p95Ms: 0,
      p99Ms: 0,
    });
  });

  it("passes the loop's summary through unchanged", () => {
    const summary: FrameMetrics = {
      samples: 12,
      meanMs: 16.7,
      p95Ms: 22.4,
      p99Ms: 31,
    };
    const diagnostics = new Diagnostics({
      metrics: () => summary,
      series: () => [],
    });

    expect(diagnostics.metrics()).toEqual(summary);
  });

  it("reads the loop again on every call", () => {
    let samples = 0;
    const diagnostics = new Diagnostics({
      metrics: (): FrameMetrics => ({
        samples: ++samples,
        meanMs: 0,
        p95Ms: 0,
        p99Ms: 0,
      }),
      series: () => [],
    });

    expect(diagnostics.metrics().samples).toBe(1);
    expect(diagnostics.metrics().samples).toBe(2);
  });
});

describe("Diagnostics.draw", () => {
  it("draws nothing while disabled", () => {
    const diagnostics = withSources({ score: 3 });
    diagnostics.setEnabled(false);
    const { calls, ctx } = fakeContext();

    diagnostics.draw(ctx, 640, 360);

    expect(calls).toEqual([]);
  });

  it("draws nothing with no sources and no frames timed", () => {
    const diagnostics = new Diagnostics();
    diagnostics.setEnabled(true);
    const { calls, ctx } = fakeContext();

    diagnostics.draw(ctx, 640, 360);

    expect(calls).toEqual([]);
  });

  it("draws a panel and one line per source, in a monospace face", () => {
    const diagnostics = withSources({ score: 3, mode: "rally" });
    const { calls, ctx } = fakeContext();

    diagnostics.draw(ctx, 640, 360);

    expect(rects(calls).length).toBeGreaterThan(0);
    expect(drawnLines(calls)).toEqual(["score: 3", "mode: rally"]);
    for (const line of calls.filter((c) => c.op === "fillText")) {
      expect(line.font).toContain("monospace");
    }
  });

  it("balances save and restore around the drawing", () => {
    const diagnostics = withSources({ score: 3 });
    const { calls, ctx } = fakeContext();

    diagnostics.draw(ctx, 640, 360);

    expect(calls.filter((c) => c.op === "save").length).toBe(1);
    expect(calls.filter((c) => c.op === "restore").length).toBe(1);
    expect(calls[0]?.op).toBe("save");
    expect(calls[calls.length - 1]?.op).toBe("restore");
  });

  it("restores the context even when the context throws mid-draw", () => {
    const diagnostics = withSources({ score: 3 });
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

  it("formats each value type on its own line", () => {
    const diagnostics = withSources({
      phase: "rally",
      lives: 3,
      speed: 1 / 3,
      paused: false,
      served: true,
    });
    const { calls, ctx } = fakeContext();

    diagnostics.draw(ctx, 640, 360);

    expect(drawnLines(calls)).toEqual([
      "phase: rally",
      "lives: 3",
      "speed: 0.333",
      "paused: false",
      "served: true",
    ]);
  });

  it("shows a whole float without a fractional part as an integer", () => {
    const diagnostics = withSources({ speed: 12.0, ratio: -0.5 });
    const { calls, ctx } = fakeContext();

    diagnostics.draw(ctx, 640, 360);

    expect(drawnLines(calls)).toEqual(["speed: 12", "ratio: -0.500"]);
  });

  it("draws a number that is not finite as itself", () => {
    const diagnostics = withSources({
      drift: Number.NaN,
      ceiling: Number.POSITIVE_INFINITY,
      floor: Number.NEGATIVE_INFINITY,
    });
    const { calls, ctx } = fakeContext();

    diagnostics.draw(ctx, 640, 360);

    expect(drawnLines(calls)).toEqual([
      "drift: NaN",
      "ceiling: Infinity",
      "floor: -Infinity",
    ]);
  });

  it("clamps the panel to the surface", () => {
    const diagnostics = withSources({
      "a-very-long-diagnostic-name": "with a long value too",
    });
    const { calls, ctx } = fakeContext();

    diagnostics.draw(ctx, 120, 90);

    const panel = rects(calls)[0];
    expect(panel?.w).toBeLessThanOrEqual(120);
    expect(panel?.h).toBeLessThanOrEqual(90);
  });

  it("clamps the panel to a surface smaller than its own margins", () => {
    const diagnostics = withSources({ score: 3 });
    const { calls, ctx } = fakeContext();

    diagnostics.draw(ctx, 4, 4);

    const panel = rects(calls)[0];
    expect(panel?.w).toBe(0);
    expect(panel?.h).toBe(0);
  });
});

describe("Diagnostics.draw frame metrics", () => {
  it("renders the figures it was handed, after the game's own lines", () => {
    const diagnostics = new Diagnostics(
      timings(
        { samples: 600, meanMs: 16.66, p95Ms: 22.42, p99Ms: 31.04 },
        [16, 17],
      ),
    );
    diagnostics.register("score", () => 3);
    diagnostics.setEnabled(true);
    const { calls, ctx } = fakeContext();

    diagnostics.draw(ctx, 640, 360);

    expect(drawnLines(calls)).toEqual([
      "score: 3",
      "frame: 16.7 / 22.4 / 31.0 ms",
    ]);
  });

  it("draws the metrics with no source registered at all", () => {
    const diagnostics = new Diagnostics(
      timings({ meanMs: 8, p95Ms: 9, p99Ms: 40 }, [8, 9, 40]),
    );
    diagnostics.setEnabled(true);
    const { calls, ctx } = fakeContext();

    diagnostics.draw(ctx, 640, 360);

    expect(drawnLines(calls)).toEqual(["frame: 8.0 / 9.0 / 40.0 ms"]);
  });

  it("omits the metrics line and the graph while the window is empty", () => {
    const diagnostics = new Diagnostics(timings({ samples: 0 }, []));
    diagnostics.register("score", () => 3);
    diagnostics.setEnabled(true);
    const { calls, ctx } = fakeContext();

    diagnostics.draw(ctx, 640, 360);

    expect(drawnLines(calls)).toEqual(["score: 3"]);
    // The panel alone: no plot area and no bars behind it.
    expect(rects(calls)).toHaveLength(1);
  });

  it("plots one column per sample, oldest at the left", () => {
    const series = [4, 40, 4, 4];
    const diagnostics = new Diagnostics(
      timings({ meanMs: 13, p95Ms: 40, p99Ms: 40 }, series),
    );
    diagnostics.setEnabled(true);
    const { calls, ctx } = fakeContext();

    diagnostics.draw(ctx, 640, 360);

    const drawn = bars(calls);
    expect(drawn).toHaveLength(series.length);
    expect(drawn.map((b) => b.x)).toEqual(
      [...drawn.map((b) => b.x)].sort((a, b) => a - b),
    );
    // The spike is the second sample, so it is the second column and the tallest.
    const heights = drawn.map((b) => b.h);
    expect(heights[1]).toBeGreaterThan(heights[0] ?? 0);
    expect(heights[1]).toBe(Math.max(...heights));
  });

  it("scales to the tallest sample, which fills the plot area", () => {
    const diagnostics = new Diagnostics(
      timings({ meanMs: 60, p95Ms: 90, p99Ms: 90 }, [30, 90]),
    );
    diagnostics.setEnabled(true);
    const { calls, ctx } = fakeContext();

    diagnostics.draw(ctx, 640, 360);

    const drawn = bars(calls);
    const tallest = drawn[1];
    expect(tallest?.h).toBeGreaterThan(0);
    // 30 ms against a 90 ms ceiling is a third of the tallest bar.
    expect(drawn[0]?.h).toBeCloseTo((tallest?.h ?? 0) / 3, 5);
  });

  it("keeps an even run flat rather than amplifying it to full height", () => {
    const even = new Array<number>(120).fill(16.7);
    const diagnostics = new Diagnostics(
      timings({ meanMs: 16.7, p95Ms: 16.7, p99Ms: 16.7 }, even),
    );
    diagnostics.setEnabled(true);
    const { calls, ctx } = fakeContext();

    diagnostics.draw(ctx, 640, 360);

    const drawn = bars(calls);
    const plot = plotArea(calls);
    expect(plot).toBeDefined();
    // Half the 33.3 ms floor: a steady sixty-a-second run reads as a low, flat band.
    expect(drawn[0]?.h ?? 0).toBeCloseTo((plot?.h ?? 0) * (16.7 / 33.3), 5);
  });

  it("keeps every bar inside the plot area, however long the window", () => {
    const series = Array.from({ length: 2048 }, (_, i) => (i % 97) + 1);
    const diagnostics = new Diagnostics(
      timings({ meanMs: 49, p95Ms: 93, p99Ms: 97 }, series),
    );
    diagnostics.setEnabled(true);
    const { calls, ctx } = fakeContext();

    diagnostics.draw(ctx, 640, 360);

    const drawn = bars(calls);
    expect(drawn).toHaveLength(series.length);
    const panel = rects(calls)[0];
    const right = (panel?.x ?? 0) + (panel?.w ?? 0);
    for (const bar of drawn) {
      expect(bar.h).toBeGreaterThanOrEqual(0);
      expect(bar.y).toBeGreaterThanOrEqual(0);
      // A column narrower than a pixel is still drawn a pixel wide, so a spike
      // survives a full window; nothing may spill past the panel it sits in.
      expect(bar.w).toBeGreaterThanOrEqual(1);
      expect(bar.x).toBeLessThanOrEqual(right);
    }
  });

  it("survives a non-finite sample", () => {
    const diagnostics = new Diagnostics(
      timings({ meanMs: 16, p95Ms: 16, p99Ms: 16 }, [
        16,
        Number.NaN,
        Number.POSITIVE_INFINITY,
      ]),
    );
    diagnostics.setEnabled(true);
    const { calls, ctx } = fakeContext();

    expect(() => diagnostics.draw(ctx, 640, 360)).not.toThrow();
    for (const bar of bars(calls)) expect(Number.isFinite(bar.h)).toBe(true);
  });

  it("holds no copy of the series between draws", () => {
    let series: readonly number[] = [10, 20, 30, 40];
    const diagnostics = new Diagnostics({
      metrics: (): FrameMetrics => ({
        samples: series.length,
        meanMs: 25,
        p95Ms: 40,
        p99Ms: 40,
      }),
      series: () => series,
    });
    diagnostics.setEnabled(true);

    const first = fakeContext();
    diagnostics.draw(first.ctx, 640, 360);
    expect(bars(first.calls)).toHaveLength(4);

    // The loop's ring is the only owner: a window that shrank plots as it is now.
    series = [10];
    const second = fakeContext();
    diagnostics.draw(second.ctx, 640, 360);
    expect(bars(second.calls)).toHaveLength(1);
  });
});

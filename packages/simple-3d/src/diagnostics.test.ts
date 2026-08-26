import { afterEach, describe, expect, it, vi } from "vitest";
import { createCanvas } from "@napi-rs/canvas";
import {
  Diagnostics,
  SampleWindow,
  createOverlaySurface,
  type FrameMetrics,
  type FrameTimings,
} from "./diagnostics";

/**
 * The registry, the frame-time window, the panel's drawing, and the overlay
 * surface's headless branches — everything that runs with no document. The panel is
 * checked against a recording stub rather than a real surface, which is what lets a
 * test assert the *order* of `save`/`restore` around the drawing and tell the
 * graph's bars from the panel behind them by the fill each was drawn with; two
 * checks then land on a real `@napi-rs/canvas` context to see actual pixels. The
 * element-backed overlay surface needs a document and lives in
 * `diagnostics.overlay.test.ts` under jsdom.
 */

interface RecordedCall {
  op: string;
  args: unknown[];
  /** The style state at the moment of the call, since `restore` is a fake here. */
  font: string;
  fillStyle: string;
}

/** A stand-in for a 2D context that records the calls the overlay makes. */
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
function withSources(values: Record<string, unknown>): Diagnostics {
  const diagnostics = new Diagnostics();
  for (const [name, value] of Object.entries(values))
    diagnostics.register(name, () => value);
  diagnostics.setEnabled(true);
  return diagnostics;
}

describe("SampleWindow", () => {
  it("reports an empty window as zeros", () => {
    expect(new SampleWindow().metrics()).toEqual({
      samples: 0,
      meanMs: 0,
      p95Ms: 0,
      p99Ms: 0,
    });
    expect(new SampleWindow().series()).toEqual([]);
  });

  it("summarizes one sample as all three figures", () => {
    const window = new SampleWindow();
    window.record(16, 10);

    expect(window.metrics()).toEqual({
      samples: 1,
      meanMs: 10,
      p95Ms: 10,
      p99Ms: 10,
    });
  });

  it("takes the mean and the nearest-rank percentiles over the window", () => {
    const window = new SampleWindow();
    // Four samples: ceil(0.95 * 4) - 1 = 3, so both percentiles are the largest.
    for (const [i, cost] of [1, 2, 3, 4].entries()) window.record(i * 16, cost);

    expect(window.metrics()).toEqual({
      samples: 4,
      meanMs: 2.5,
      p95Ms: 4,
      p99Ms: 4,
    });
  });

  it("reports frame times that actually happened, at the documented ranks", () => {
    const window = new SampleWindow();
    for (let i = 1; i <= 100; i++) window.record(i * 16, i);

    // Nearest rank: sorted[ceil(0.95 * 100) - 1] = the 95th sample, no interpolation.
    expect(window.metrics()).toEqual({
      samples: 100,
      meanMs: 50.5,
      p95Ms: 95,
      p99Ms: 99,
    });
  });

  it("drops samples older than ten seconds of simulated time as new frames arrive", () => {
    const window = new SampleWindow();
    window.record(0, 10);
    window.record(5_000, 20);
    window.record(14_000, 30);

    // The sample at t=0 is 14 s old and gone; the one at t=5000 is 9 s old and kept.
    expect(window.series()).toEqual([20, 30]);
    expect(window.metrics().samples).toBe(2);
  });

  it("keeps a sample exactly ten seconds old", () => {
    const window = new SampleWindow();
    window.record(0, 10);
    window.record(10_000, 20);

    expect(window.metrics().samples).toBe(2);
  });

  it("caps the ring at 2048 samples however fast the frames arrive", () => {
    const window = new SampleWindow();
    // Three thousand frames inside one simulated second: age evicts nothing, so the
    // capacity is the rule that holds.
    for (let i = 0; i < 3_000; i++) window.record(i / 3, i);

    const series = window.series();
    expect(series).toHaveLength(2_048);
    expect(series[0]).toBe(952);
    expect(series[series.length - 1]).toBe(2_999);
  });

  it("lists samples oldest first", () => {
    const window = new SampleWindow();
    window.record(0, 5);
    window.record(16, 7);
    window.record(32, 9);

    expect(window.series()).toEqual([5, 7, 9]);
  });

  it("refills one reusable buffer rather than allocating a series per read", () => {
    const window = new SampleWindow();
    window.record(0, 5);
    const first = window.series();

    window.record(16, 7);
    const second = window.series();

    // The same buffer, refilled: reading the window sixty times a second must not
    // allocate the window all over again for a picture thrown away immediately.
    expect(second).toBe(first);
    expect([...second]).toEqual([5, 7]);
  });
});

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

  it("holds one entry per name however often a name is re-registered", () => {
    const diagnostics = new Diagnostics();
    for (let i = 0; i < 5000; i++) diagnostics.register("frames", () => i);

    expect(Object.keys(diagnostics.read())).toEqual(["frames"]);
  });

  it("contains a throwing source and still reads the others", () => {
    const diagnostics = new Diagnostics();
    diagnostics.register("ok", () => "fine");
    diagnostics.register("boom", () => {
      throw new Error("no ball yet");
    });
    diagnostics.register("after", () => 7);

    expect(diagnostics.read()).toEqual({
      ok: "fine",
      boom: "no ball yet",
      after: 7,
    });
  });

  it("stringifies a non-Error throw", () => {
    const diagnostics = new Diagnostics();
    diagnostics.register("odd", () => {
      throw "just a string";
    });

    expect(diagnostics.read()["odd"]).toBe("just a string");
  });

  it("returns values unformatted", () => {
    const diagnostics = new Diagnostics();
    diagnostics.register("speed", () => 1 / 3);
    diagnostics.register("ball", () => ({ x: 1 }));

    expect(diagnostics.read()).toEqual({ speed: 1 / 3, ball: { x: 1 } });
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

  it("reads a SampleWindow directly, which satisfies the timings seam", () => {
    const window = new SampleWindow();
    window.record(16, 8);
    const diagnostics = new Diagnostics(window);

    expect(diagnostics.metrics()).toEqual({
      samples: 1,
      meanMs: 8,
      p95Ms: 8,
      p99Ms: 8,
    });
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
    // A lost or fake context can fail at any call; the overlay's style must come
    // off the context stack regardless.
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
      target: null,
      pick: undefined,
      ball: { x: 1, y: 2, z: 3 },
      path: [1, 2],
      paused: false,
    });
    const { calls, ctx } = fakeContext();

    diagnostics.draw(ctx, 640, 360);

    expect(drawnLines(calls)).toEqual([
      "phase: rally",
      "lives: 3",
      "speed: 0.333",
      "target: null",
      "pick: undefined",
      'ball: {"x":1,"y":2,"z":3}',
      "path: [1,2]",
      "paused: false",
    ]);
  });

  it("shows a whole float without a fractional part as an integer", () => {
    const diagnostics = withSources({ speed: 12.0, ratio: -0.5 });
    const { calls, ctx } = fakeContext();

    diagnostics.draw(ctx, 640, 360);

    expect(drawnLines(calls)).toEqual(["speed: 12", "ratio: -0.500"]);
  });

  it("survives a cyclic value", () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    const diagnostics = withSources({ cyclic });
    const { calls, ctx } = fakeContext();

    expect(() => diagnostics.draw(ctx, 640, 360)).not.toThrow();
    expect(drawnLines(calls)).toHaveLength(1);
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

describe("the overlay on a real 2D surface", () => {
  // `@napi-rs/canvas` is the 2D surface the structured-2d examples already draw
  // with; here it stands in for the overlay surface a browser would composite, so
  // a check can look at actual pixels rather than at a call log.
  it("paints the translucent panel into real pixels, and only where the panel is", () => {
    const surface = createCanvas(320, 180);
    const raw = surface.getContext("2d");
    const diagnostics = withSources({ score: 3 });

    diagnostics.draw(raw as unknown as CanvasRenderingContext2D, 320, 180);

    // Inside the panel (it starts at the 8-pixel margin): the panel fill landed.
    expect(raw.getImageData(10, 10, 1, 1).data[3]).toBeGreaterThan(0);
    // Far corner, outside any panel: untouched, still fully transparent.
    expect(raw.getImageData(310, 170, 1, 1).data[3]).toBe(0);
  });

  it("leaves a hidden overlay's surface fully transparent", () => {
    const surface = createCanvas(64, 48);
    const raw = surface.getContext("2d");
    const diagnostics = withSources({ score: 3 });
    diagnostics.setEnabled(false);

    diagnostics.draw(raw as unknown as CanvasRenderingContext2D, 64, 48);

    expect(
      raw.getImageData(0, 0, 64, 48).data.every((byte) => byte === 0),
    ).toBe(true);
  });
});

describe("createOverlaySurface without a document", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** A canvas as the headless harness serves it: sizes, no owner document. */
  function bareCanvas(width = 640, height = 360): HTMLCanvasElement {
    return { width, height } as unknown as HTMLCanvasElement;
  }

  /** A 2D-context stand-in recording the blanking calls `sync` makes. */
  function stubContext(): {
    calls: { op: string; args: unknown[] }[];
    ctx: unknown;
  } {
    const calls: { op: string; args: unknown[] }[] = [];
    return {
      calls,
      ctx: {
        setTransform: (...args: unknown[]) =>
          calls.push({ op: "setTransform", args }),
        clearRect: (...args: unknown[]) =>
          calls.push({ op: "clearRect", args }),
      },
    };
  }

  it("is inert in Node, where there is no document and no 2D OffscreenCanvas", () => {
    // The documented headless branch: the engine then draws nothing and calls
    // `draw` on nothing, while `read` and `metrics` answer as always.
    expect(createOverlaySurface(bareCanvas())).toBeNull();
  });

  it("serves an OffscreenCanvas where the host has one, sized to the canvas", () => {
    const made: { width: number; height: number }[] = [];
    const recorder = stubContext();
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        constructor(
          public width: number,
          public height: number,
        ) {
          made.push(this);
        }
        getContext(kind: string): unknown {
          return kind === "2d" ? recorder.ctx : null;
        }
      },
    );

    const surface = createOverlaySurface(bareCanvas(640, 360));

    expect(surface).not.toBeNull();
    expect(made).toEqual([
      expect.objectContaining({ width: 640, height: 360 }),
    ]);
    // "Reached through draw": the offscreen surface's whole observable behavior is
    // that its context is what the engine hands the overlay.
    expect(surface?.context()).toBe(recorder.ctx);
  });

  it("sync tracks the backing-store size and leaves the offscreen surface blank", () => {
    const recorder = stubContext();
    let instance: { width: number; height: number } | undefined;
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        constructor(
          public width: number,
          public height: number,
        ) {
          instance = this;
        }
        getContext(): unknown {
          return recorder.ctx;
        }
      },
    );
    const surface = createOverlaySurface(bareCanvas());

    surface?.sync(1280, 720);

    expect(instance).toEqual(
      expect.objectContaining({ width: 1280, height: 720 }),
    );
    expect(recorder.calls).toEqual([
      { op: "setTransform", args: [1, 0, 0, 1, 0, 0] },
      { op: "clearRect", args: [0, 0, 1280, 720] },
    ]);
    // Nothing to detach from a document that never held it.
    expect(() => surface?.dispose()).not.toThrow();
  });

  it("stays inert when the OffscreenCanvas yields no 2D context", () => {
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        constructor(
          public width: number,
          public height: number,
        ) {}
        getContext(): unknown {
          return null;
        }
      },
    );

    expect(createOverlaySurface(bareCanvas())).toBeNull();
  });

  it("stays inert when constructing the OffscreenCanvas throws", () => {
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        constructor() {
          throw new Error("no 2D backend");
        }
      },
    );

    expect(createOverlaySurface(bareCanvas())).toBeNull();
  });
});

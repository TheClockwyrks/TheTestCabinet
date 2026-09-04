import { describe, expect, it } from "vitest";
import type { DiagnosticValue, FrameMetrics } from "./contract";
import type {
  FrameTimings,
  FrameTimingSummary,
  RendererCounts,
} from "./diagnostics";
import { Diagnostics, rendererCounts } from "./diagnostics";
import type { Context2dStub, RecordedOp } from "./testing/canvas";
import { createContext2dStub } from "./testing/canvas";

/**
 * The surface the overlay draws through.
 *
 * The harness's recording context stands in for the screen layer: jsdom's
 * `getContext("2d")` answers `null` without a native canvas binding, and a recorder
 * is what lets a test assert the *order* of `save`/`restore` around the drawing,
 * tell the graph's bars from the panel behind them by the fill each was drawn with,
 * and see that the overlay set no transform of its own.
 */
function overlay(): Context2dStub {
  return createContext2dStub(document.createElement("canvas"));
}

/** The text of every line the overlay drew. */
function drawnLines(stub: Context2dStub): string[] {
  return stub.opsOf("fillText").map((op) => op.text ?? "");
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
}

function toRect(op: RecordedOp): Rect {
  return {
    x: op.args[0] as number,
    y: op.args[1] as number,
    w: op.args[2] as number,
    h: op.args[3] as number,
    fill: op.fill,
  };
}

function rects(stub: Context2dStub): Rect[] {
  return stub.opsOf("fillRect").map(toRect);
}

/**
 * The graph's bars: the rectangles sharing the fill of the last one drawn.
 *
 * Identifying them by fill rather than by position keeps the test off the overlay's
 * private geometry — it asserts what a reader sees (a band of bars in one colour),
 * not the constants that place them.
 */
function bars(stub: Context2dStub): Rect[] {
  const drawn = rects(stub);
  const last = drawn[drawn.length - 1];
  if (last === undefined) return [];
  return drawn.filter((rect) => rect.fill === last.fill);
}

/** The plot area the bars stand in: the rectangle drawn immediately before them. */
function plotArea(stub: Context2dStub): Rect | undefined {
  const drawn = rects(stub);
  const barFill = drawn[drawn.length - 1]?.fill;
  const firstBar = drawn.findIndex((rect) => rect.fill === barFill);
  return firstBar > 0 ? drawn[firstBar - 1] : undefined;
}

/** A frame loop's timing, as the overlay reads it. */
function timings(
  metrics: Partial<FrameTimingSummary>,
  series: readonly number[] = [],
): FrameTimings {
  const summary: FrameTimingSummary = {
    samples: series.length,
    meanMs: 0,
    p95Ms: 0,
    p99Ms: 0,
    ...metrics,
  };
  return { metrics: () => summary, series: () => series };
}

/** A renderer's counters for the frame it last drew. */
function counts(drawCalls: number, triangles: number): RendererCounts {
  return { drawCalls: () => drawCalls, triangles: () => triangles };
}

/** An overlay showing `values`, with no frames timed. */
function withSources(values: Record<string, DiagnosticValue>): Diagnostics {
  const diagnostics = new Diagnostics();
  for (const [name, value] of Object.entries(values))
    diagnostics.register(name, () => value);
  diagnostics.setEnabled(true);
  return diagnostics;
}

/** An overlay with one timed frame, so the metrics line and the graph are drawn. */
function withMetrics(
  metrics: Partial<FrameTimingSummary>,
  series: readonly number[],
  renderer: RendererCounts = counts(0, 0),
): Diagnostics {
  const diagnostics = new Diagnostics(timings(metrics, series), renderer);
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
    diagnostics.register("phase", () => "build");
    diagnostics.register("speed", () => 1 / 3);
    diagnostics.register("landed", () => false);

    expect(diagnostics.read()).toEqual([
      { name: "phase", value: "build" },
      { name: "speed", value: 1 / 3 },
      { name: "landed", value: false },
    ]);
  });

  it("evaluates sources on every read rather than sampling at registration", () => {
    const diagnostics = new Diagnostics();
    let frames = 0;
    diagnostics.register("frames", () => ++frames);

    expect(diagnostics.read()).toEqual([{ name: "frames", value: 1 }]);
    expect(diagnostics.read()).toEqual([{ name: "frames", value: 2 }]);
  });

  it("reads the state the caller hands the source, not one closed over", () => {
    // The engine calls a registered source with the state it currently holds, and a
    // frame replaces that value rather than mutating it. A source reading its
    // argument therefore tracks the run; one reading the object `initialize` built
    // would report the opening state forever.
    const diagnostics = new Diagnostics();
    let state = { ship: { x: 0, y: 12, z: 0 } };
    diagnostics.register(
      "ship",
      () => `${state.ship.x}, ${state.ship.y}, ${state.ship.z}`,
    );

    expect(diagnostics.read()).toEqual([{ name: "ship", value: "0, 12, 0" }]);

    state = { ship: { x: 1, y: 11, z: -2 } };
    expect(diagnostics.read()).toEqual([{ name: "ship", value: "1, 11, -2" }]);
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
      throw new Error("no target yet");
    });
    diagnostics.register("after", () => 7);

    const readings = diagnostics.read();

    expect(readings).toEqual([
      { name: "ok", value: "fine" },
      { name: "boom", error: "no target yet" },
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

  it("reads an empty registry as no readings at all", () => {
    expect(new Diagnostics().read()).toEqual([]);
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
  it("reports an empty window and no renderer cost before anything is attached", () => {
    // Zero draw calls and zero triangles is what the contract promises before the
    // first render, and what a freshly built renderer reports too.
    expect(new Diagnostics().metrics()).toEqual({
      samples: 0,
      meanMs: 0,
      p95Ms: 0,
      p99Ms: 0,
      drawCalls: 0,
      triangles: 0,
    });
  });

  it("puts the loop's window beside the renderer's counts for the last frame", () => {
    const diagnostics = new Diagnostics(
      timings({ samples: 12, meanMs: 16.7, p95Ms: 22.4, p99Ms: 31 }),
      counts(48, 12_744),
    );

    expect(diagnostics.metrics()).toEqual({
      samples: 12,
      meanMs: 16.7,
      p95Ms: 22.4,
      p99Ms: 31,
      drawCalls: 48,
      triangles: 12_744,
    });
  });

  it("takes the counts from the renderer even when the loop offers its own", () => {
    // The renderer is the only authority on the two counts; a loop handing back a
    // whole `FrameMetrics` must not be able to slip a stale figure past it.
    const stale: FrameMetrics = {
      samples: 3,
      meanMs: 5,
      p95Ms: 5,
      p99Ms: 5,
      drawCalls: 999,
      triangles: 999,
    };
    const diagnostics = new Diagnostics(
      { metrics: () => stale, series: () => [] },
      counts(7, 21),
    );

    expect(diagnostics.metrics()).toMatchObject({
      samples: 3,
      drawCalls: 7,
      triangles: 21,
    });
  });

  it("reads both seams again on every call", () => {
    let samples = 0;
    let frame = 0;
    const diagnostics = new Diagnostics(
      {
        metrics: (): FrameTimingSummary => ({
          samples: ++samples,
          meanMs: 0,
          p95Ms: 0,
          p99Ms: 0,
        }),
        series: () => [],
      },
      { drawCalls: () => ++frame, triangles: () => frame * 100 },
    );

    expect(diagnostics.metrics()).toMatchObject({
      samples: 1,
      drawCalls: 1,
      triangles: 100,
    });
    expect(diagnostics.metrics()).toMatchObject({
      samples: 2,
      drawCalls: 2,
      triangles: 200,
    });
  });

  it("follows a seam wired after construction", () => {
    // The engine builds the overlay before the loop and the renderer exist, then
    // wires both in; an overlay read in between reports the idle figures.
    const diagnostics = new Diagnostics();
    expect(diagnostics.metrics()).toMatchObject({ samples: 0, drawCalls: 0 });

    diagnostics.timings = timings({
      samples: 4,
      meanMs: 8,
      p95Ms: 9,
      p99Ms: 9,
    });
    diagnostics.counts = counts(5, 60);

    expect(diagnostics.metrics()).toMatchObject({
      samples: 4,
      meanMs: 8,
      drawCalls: 5,
      triangles: 60,
    });
  });
});

describe("rendererCounts", () => {
  /** A stand-in for the render stage, whose `counts()` the engine wires in. */
  function stage(drawCalls: number, triangles: number) {
    const counts = { drawCalls, triangles };
    return {
      counts: () => counts,
      /** What a frame does: the stage recaptures the scene's counts as it draws. */
      drew(nextCalls: number, nextTriangles: number) {
        counts.drawCalls = nextCalls;
        counts.triangles = nextTriangles;
      },
    };
  }

  it("reads the stage's counts on every call rather than capturing them once", () => {
    // The stage recaptures its counts as each frame's scene is drawn, so the adapter
    // must read through rather than hold what they were when the engine was built.
    const drawn = stage(4, 900);
    const seam = rendererCounts(drawn);

    expect(seam.drawCalls()).toBe(4);
    expect(seam.triangles()).toBe(900);

    drawn.drew(61, 128_400);

    expect(seam.drawCalls()).toBe(61);
    expect(seam.triangles()).toBe(128_400);
  });

  it("carries the stage's counts through to the metrics the overlay reports", () => {
    const diagnostics = new Diagnostics(
      timings({ samples: 1, meanMs: 16, p95Ms: 16, p99Ms: 16 }),
      rendererCounts(stage(12, 3_600)),
    );

    expect(diagnostics.metrics()).toMatchObject({
      drawCalls: 12,
      triangles: 3_600,
    });
  });

  it("reports the scene's counts and not the composite's", () => {
    // The regression this whole seam exists for: three resets `renderer.info` at the
    // top of every `render` call and the engine makes a second one to composite the
    // screen layer, so an overlay reading the renderer live would show one draw call
    // and two triangles whatever the game submitted. The stage's snapshot is taken
    // between the two, and is what the panel must report.
    const live = { calls: 0, triangles: 0 };
    const drawn = stage(0, 0);
    const seam = rendererCounts(drawn);

    // The scene render, and the stage capturing what it cost.
    live.calls = 48;
    live.triangles = 12_744;
    drawn.drew(live.calls, live.triangles);

    // The composite: three's own reset, then the engine's one full-screen quad.
    live.calls = 1;
    live.triangles = 2;

    expect(seam.drawCalls()).toBe(48);
    expect(seam.triangles()).toBe(12_744);
  });
});

describe("Diagnostics.draw", () => {
  it("draws nothing while disabled", () => {
    const diagnostics = withSources({ score: 3 });
    diagnostics.setEnabled(false);
    const stub = overlay();

    diagnostics.draw(stub.ctx, 640, 360);

    expect(stub.ops).toEqual([]);
  });

  it("draws nothing with no sources and no frames timed", () => {
    const diagnostics = new Diagnostics();
    diagnostics.setEnabled(true);
    const stub = overlay();

    diagnostics.draw(stub.ctx, 640, 360);

    expect(stub.ops).toEqual([]);
  });

  it("draws a panel and one line per source, in a monospace face", () => {
    const diagnostics = withSources({ score: 3, phase: "build" });
    const stub = overlay();

    diagnostics.draw(stub.ctx, 640, 360);

    expect(rects(stub).length).toBeGreaterThan(0);
    expect(drawnLines(stub)).toEqual(["score: 3", "phase: build"]);
    expect(stub.ctx.font).toContain("monospace");
  });

  it("sets no transform of its own, so it draws in the device space the engine reset to", () => {
    // The screen layer's transform is the identity when the engine calls this. The
    // overlay is chrome in the canvas's backing store rather than in the game's
    // letterboxed logical coordinates, so it must not scale or translate itself.
    const diagnostics = withMetrics(
      { meanMs: 16, p95Ms: 16, p99Ms: 16 },
      [16, 16],
    );
    diagnostics.register("score", () => 3);
    const stub = overlay();

    diagnostics.draw(stub.ctx, 640, 360);

    expect(stub.names()).not.toContain("setTransform");
    expect(stub.names()).not.toContain("translate");
    expect(stub.names()).not.toContain("scale");
    expect(stub.names()).not.toContain("transform");
    for (const op of stub.ops) expect(op.transform).toEqual([1, 0, 0, 1, 0, 0]);
  });

  it("balances save and restore around the drawing", () => {
    const diagnostics = withSources({ score: 3 });
    const stub = overlay();

    diagnostics.draw(stub.ctx, 640, 360);

    expect(stub.opsOf("save")).toHaveLength(1);
    expect(stub.opsOf("restore")).toHaveLength(1);
    expect(stub.names()[0]).toBe("save");
    expect(stub.names().at(-1)).toBe("restore");
  });

  it("restores the context even when the context throws mid-draw", () => {
    const diagnostics = withSources({ score: 3 });
    const stub = overlay();
    // A lost or fake context can fail at any call; the game's style must come back.
    stub.ctx.fillText = (): never => {
      throw new Error("context lost");
    };

    expect(() => diagnostics.draw(stub.ctx, 640, 360)).toThrow("context lost");
    expect(stub.opsOf("restore")).toHaveLength(1);
  });

  it("restores the context even when measuring throws", () => {
    const diagnostics = withSources({ score: 3 });
    const stub = overlay();
    stub.ctx.measureText = (): never => {
      throw new Error("measure failed");
    };

    expect(() => diagnostics.draw(stub.ctx, 640, 360)).toThrow(
      "measure failed",
    );
    expect(stub.opsOf("restore")).toHaveLength(1);
  });

  it("keeps drawing when a source throws, showing its message", () => {
    const diagnostics = new Diagnostics();
    diagnostics.register("boom", () => {
      throw new Error("no target yet");
    });
    diagnostics.register("score", () => 3);
    diagnostics.setEnabled(true);
    const stub = overlay();

    diagnostics.draw(stub.ctx, 640, 360);

    expect(drawnLines(stub)).toEqual(["boom: no target yet", "score: 3"]);
    expect(stub.opsOf("restore")).toHaveLength(1);
  });

  it("formats each value type on its own line", () => {
    const diagnostics = withSources({
      phase: "build",
      lives: 3,
      speed: 1 / 3,
      paused: false,
      landed: true,
    });
    const stub = overlay();

    diagnostics.draw(stub.ctx, 640, 360);

    expect(drawnLines(stub)).toEqual([
      "phase: build",
      "lives: 3",
      "speed: 0.333",
      "paused: false",
      "landed: true",
    ]);
  });

  it("shows a whole float without a fractional part as an integer", () => {
    const diagnostics = withSources({ speed: 12.0, ratio: -0.5 });
    const stub = overlay();

    diagnostics.draw(stub.ctx, 640, 360);

    expect(drawnLines(stub)).toEqual(["speed: 12", "ratio: -0.500"]);
  });

  it("draws a number that is not finite as itself", () => {
    const diagnostics = withSources({
      drift: Number.NaN,
      ceiling: Number.POSITIVE_INFINITY,
      floor: Number.NEGATIVE_INFINITY,
    });
    const stub = overlay();

    diagnostics.draw(stub.ctx, 640, 360);

    expect(drawnLines(stub)).toEqual([
      "drift: NaN",
      "ceiling: Infinity",
      "floor: -Infinity",
    ]);
  });

  it("draws lines in registration order, with a re-registered name in its old place", () => {
    const diagnostics = new Diagnostics();
    diagnostics.register("target", () => "none");
    diagnostics.register("placed", () => 2);
    diagnostics.register("target", () => "crate");
    diagnostics.setEnabled(true);
    const stub = overlay();

    diagnostics.draw(stub.ctx, 640, 360);

    expect(drawnLines(stub)).toEqual(["target: crate", "placed: 2"]);
  });

  it("clamps the panel to the surface", () => {
    const diagnostics = withSources({
      "a-very-long-diagnostic-name": "with a long value too",
    });
    const stub = overlay();

    diagnostics.draw(stub.ctx, 120, 90);

    const panel = rects(stub)[0];
    expect(panel?.w).toBeLessThanOrEqual(120);
    expect(panel?.h).toBeLessThanOrEqual(90);
  });

  it("clamps the panel to a surface smaller than its own margins", () => {
    const diagnostics = withSources({ score: 3 });
    const stub = overlay();

    diagnostics.draw(stub.ctx, 4, 4);

    const panel = rects(stub)[0];
    expect(panel?.w).toBe(0);
    expect(panel?.h).toBe(0);
  });

  it("sizes its type to the surface height, with a floor for legibility", () => {
    // The height is in device pixels, so this follows the device pixel ratio for
    // free: the same canvas at twice the ratio draws the overlay twice as large.
    const tall = overlay();
    withSources({ score: 3 }).draw(tall.ctx, 1920, 1080);
    expect(tall.ctx.font).toContain("22px");

    const short = overlay();
    withSources({ score: 3 }).draw(short.ctx, 320, 180);
    expect(short.ctx.font).toContain("11px");
  });
});

describe("Diagnostics.draw frame metrics", () => {
  it("renders the timings and the renderer's counts, after the game's own lines", () => {
    const diagnostics = withMetrics(
      { samples: 600, meanMs: 16.66, p95Ms: 22.42, p99Ms: 31.04 },
      [16, 17],
      counts(48, 12_744),
    );
    diagnostics.register("score", () => 3);
    const stub = overlay();

    diagnostics.draw(stub.ctx, 640, 360);

    expect(drawnLines(stub)).toEqual([
      "score: 3",
      "frame: 16.7 / 22.4 / 31.0 ms · 48 draws · 12744 tris",
    ]);
  });

  it("draws the metrics with no source registered at all", () => {
    const diagnostics = withMetrics(
      { meanMs: 8, p95Ms: 9, p99Ms: 40 },
      [8, 9, 40],
      counts(3, 900),
    );
    const stub = overlay();

    diagnostics.draw(stub.ctx, 640, 360);

    expect(drawnLines(stub)).toEqual([
      "frame: 8.0 / 9.0 / 40.0 ms · 3 draws · 900 tris",
    ]);
  });

  it("reports a scene the renderer drew nothing for as zero of each", () => {
    const diagnostics = withMetrics({ meanMs: 4, p95Ms: 4, p99Ms: 4 }, [4]);
    const stub = overlay();

    diagnostics.draw(stub.ctx, 640, 360);

    expect(drawnLines(stub)).toEqual([
      "frame: 4.0 / 4.0 / 4.0 ms · 0 draws · 0 tris",
    ]);
  });

  it("omits the metrics line and the graph while the window is empty", () => {
    const diagnostics = new Diagnostics(
      timings({ samples: 0 }, []),
      counts(9, 99),
    );
    diagnostics.register("score", () => 3);
    diagnostics.setEnabled(true);
    const stub = overlay();

    diagnostics.draw(stub.ctx, 640, 360);

    expect(drawnLines(stub)).toEqual(["score: 3"]);
    // The panel alone: no plot area and no bars behind it.
    expect(rects(stub)).toHaveLength(1);
  });

  it("plots one column per sample, oldest at the left", () => {
    const series = [4, 40, 4, 4];
    const diagnostics = withMetrics(
      { meanMs: 13, p95Ms: 40, p99Ms: 40 },
      series,
    );
    const stub = overlay();

    diagnostics.draw(stub.ctx, 640, 360);

    const drawn = bars(stub);
    expect(drawn).toHaveLength(series.length);
    expect(drawn.map((bar) => bar.x)).toEqual(
      [...drawn.map((bar) => bar.x)].sort((a, b) => a - b),
    );
    // The spike is the second sample, so it is the second column and the tallest.
    const heights = drawn.map((bar) => bar.h);
    expect(heights[1]).toBeGreaterThan(heights[0] ?? 0);
    expect(heights[1]).toBe(Math.max(...heights));
  });

  it("scales to the tallest sample, which fills the plot area", () => {
    const diagnostics = withMetrics(
      { meanMs: 60, p95Ms: 90, p99Ms: 90 },
      [30, 90],
    );
    const stub = overlay();

    diagnostics.draw(stub.ctx, 640, 360);

    const drawn = bars(stub);
    const tallest = drawn[1];
    expect(tallest?.h).toBeGreaterThan(0);
    // 30 ms against a 90 ms ceiling is a third of the tallest bar.
    expect(drawn[0]?.h).toBeCloseTo((tallest?.h ?? 0) / 3, 5);
  });

  it("keeps an even run flat rather than amplifying it to full height", () => {
    const even = new Array<number>(120).fill(16.7);
    const diagnostics = withMetrics(
      { meanMs: 16.7, p95Ms: 16.7, p99Ms: 16.7 },
      even,
    );
    const stub = overlay();

    diagnostics.draw(stub.ctx, 640, 360);

    const drawn = bars(stub);
    const plot = plotArea(stub);
    expect(plot).toBeDefined();
    // Half the 33.3 ms floor: a steady sixty-a-second run reads as a low, flat band.
    expect(drawn[0]?.h ?? 0).toBeCloseTo((plot?.h ?? 0) * (16.7 / 33.3), 5);
  });

  it("keeps every bar inside the plot area, however long the window", () => {
    const series = Array.from({ length: 2048 }, (_, i) => (i % 97) + 1);
    const diagnostics = withMetrics(
      { meanMs: 49, p95Ms: 93, p99Ms: 97 },
      series,
    );
    const stub = overlay();

    diagnostics.draw(stub.ctx, 640, 360);

    const drawn = bars(stub);
    expect(drawn).toHaveLength(series.length);
    const panel = rects(stub)[0];
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
    const diagnostics = withMetrics({ meanMs: 16, p95Ms: 16, p99Ms: 16 }, [
      16,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]);
    const stub = overlay();

    expect(() => diagnostics.draw(stub.ctx, 640, 360)).not.toThrow();
    for (const bar of bars(stub)) expect(Number.isFinite(bar.h)).toBe(true);
  });

  it("holds no copy of the series between draws", () => {
    let series: readonly number[] = [10, 20, 30, 40];
    const diagnostics = new Diagnostics({
      metrics: (): FrameTimingSummary => ({
        samples: series.length,
        meanMs: 25,
        p95Ms: 40,
        p99Ms: 40,
      }),
      series: () => series,
    });
    diagnostics.setEnabled(true);

    const first = overlay();
    diagnostics.draw(first.ctx, 640, 360);
    expect(bars(first)).toHaveLength(4);

    // The loop's ring is the only owner: a window that shrank plots as it is now.
    series = [10];
    const second = overlay();
    diagnostics.draw(second.ctx, 640, 360);
    expect(bars(second)).toHaveLength(1);
  });

  it("reports the counts of the frame it is drawn over, not the ones it was built with", () => {
    // A validator watching the panel across frames reads the renderer's cost for
    // the picture under it, so the counts must be pulled on each draw.
    const frames = [
      { calls: 3, triangles: 90 },
      { calls: 41, triangles: 22_000 },
    ];
    let frame = 0;
    const diagnostics = withMetrics(
      { meanMs: 16, p95Ms: 16, p99Ms: 16 },
      [16],
      {
        drawCalls: () => frames[frame]?.calls ?? 0,
        triangles: () => frames[frame]?.triangles ?? 0,
      },
    );

    const first = overlay();
    diagnostics.draw(first.ctx, 640, 360);
    expect(drawnLines(first)).toEqual([
      "frame: 16.0 / 16.0 / 16.0 ms · 3 draws · 90 tris",
    ]);

    frame = 1;
    const second = overlay();
    diagnostics.draw(second.ctx, 640, 360);
    expect(drawnLines(second)).toEqual([
      "frame: 16.0 / 16.0 / 16.0 ms · 41 draws · 22000 tris",
    ]);
  });

  it("draws the metrics line and the graph without disturbing what read reports", () => {
    const diagnostics = withMetrics(
      { meanMs: 16, p95Ms: 16, p99Ms: 16 },
      [16],
      counts(2, 4),
    );
    diagnostics.register("score", () => 3);
    const stub = overlay();

    const before = diagnostics.read();
    diagnostics.draw(stub.ctx, 640, 360);

    expect(diagnostics.read()).toEqual(before);
    expect(diagnostics.enabled()).toBe(true);
  });
});

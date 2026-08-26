import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it, vi } from "vitest";
import {
  Diagnostics,
  SampleWindow,
  createOverlaySurface,
  type FrameMetrics,
  type FrameTimings,
  type WorldLine,
} from "./diagnostics";

/**
 * The two registries, the frame-time window, and the panel, with the overlay's
 * surface treated as what it is — a seam. Most of the drawing claims are stated
 * against a context stand-in that logs the lines and rectangles the overlay
 * issued, because the claims are about *what* the panel says and in what order;
 * one test draws on a real `@napi-rs/canvas` 2D surface, so the column that is
 * asserted line by line elsewhere is known to reach pixels at all.
 *
 * The environment is node, which is also the environment the surface factory's
 * documented "inert" answer belongs to; the element-backed surface, which needs
 * a document, is asserted in `diagnostics.dom.test.ts`.
 */

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

/** A 2D context stand-in recording the text and rectangles the overlay drew. */
function stubContext(
  overrides: Partial<Record<"measureText", (text: string) => TextMetrics>> = {},
): {
  ctx: CanvasRenderingContext2D;
  texts: string[];
  rects: { x: number; y: number; w: number; h: number }[];
  clears: { w: number; h: number }[];
  save: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
} {
  const texts: string[] = [];
  const rects: { x: number; y: number; w: number; h: number }[] = [];
  const clears: { w: number; h: number }[] = [];
  const save = vi.fn();
  const restore = vi.fn();
  const ctx = {
    save,
    restore,
    setTransform: () => {},
    clearRect: (_x: number, _y: number, w: number, h: number) => {
      clears.push({ w, h });
    },
    font: "",
    textBaseline: "",
    textAlign: "",
    fillStyle: "",
    measureText:
      overrides.measureText ??
      ((text: string) => ({ width: text.length * 7 }) as TextMetrics),
    fillText: (text: string) => {
      texts.push(text);
    },
    fillRect: (x: number, y: number, w: number, h: number) => {
      rects.push({ x, y, w, h });
    },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, texts, rects, clears, save, restore };
}

/** Frame timing the test states outright, so a panel's metrics line is exact. */
function fixedTimings(
  metrics: FrameMetrics,
  series: readonly number[] = [],
): FrameTimings {
  return { metrics: () => metrics, series: () => series };
}

/** A diagnostics over a settable world line, which is how the engine wires one. */
function diagnosticsWith(line: WorldLine | null = null): {
  diagnostics: Diagnostics;
  world: { line: WorldLine | null };
} {
  const world = { line };
  const diagnostics = new Diagnostics(undefined, () => world.line);
  return { diagnostics, world };
}

/** A window fed one sample per frame at a fixed step of simulated time. */
function windowOf(samples: readonly number[], stepMs = 16): SampleWindow {
  const window = new SampleWindow();
  samples.forEach((cost, index) => {
    window.record((index + 1) * stepMs, cost);
  });
  return window;
}

/* -------------------------------------------------------------------------- */
/* Visibility                                                                 */
/* -------------------------------------------------------------------------- */

describe("the overlay's visibility", () => {
  it("is hidden when the engine is created", () => {
    expect(new Diagnostics().enabled()).toBe(false);
  });

  it("shows, hides, and toggles — which is what the Backquote key drives", () => {
    const diagnostics = new Diagnostics();

    diagnostics.setEnabled(true);
    expect(diagnostics.enabled()).toBe(true);
    diagnostics.setEnabled(false);
    expect(diagnostics.enabled()).toBe(false);

    diagnostics.toggle();
    expect(diagnostics.enabled()).toBe(true);
    diagnostics.toggle();
    expect(diagnostics.enabled()).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* read                                                                       */
/* -------------------------------------------------------------------------- */

describe("reading the registries", () => {
  it("evaluates the instance registry first, each registry in registration order", () => {
    const diagnostics = new Diagnostics();
    diagnostics.registerWorld("wave", () => 3);
    diagnostics.registerInstance("build", () => "patrol 1.4.0");
    diagnostics.registerInstance("opens", () => 1);
    diagnostics.registerWorld("drones", () => 6);

    expect(Object.entries(diagnostics.read())).toEqual([
      ["build", "patrol 1.4.0"],
      ["opens", 1],
      ["wave", 3],
      ["drones", 6],
    ]);
  });

  it("calls a source on every read rather than sampling it at registration", () => {
    const diagnostics = new Diagnostics();
    let score = 0;
    diagnostics.registerWorld("score", () => score);

    expect(diagnostics.read()["score"]).toBe(0);
    score = 7;
    expect(diagnostics.read()["score"]).toBe(7);
  });

  it("replaces a re-registered name's source and keeps the name where it was", () => {
    const diagnostics = new Diagnostics();
    diagnostics.registerWorld("wave", () => 1);
    diagnostics.registerWorld("drones", () => 6);
    diagnostics.registerWorld("wave", () => 9);

    expect(Object.entries(diagnostics.read())).toEqual([
      ["wave", 9],
      ["drones", 6],
    ]);
  });

  it("contributes a throwing source's message as its value, and never throws itself", () => {
    const diagnostics = new Diagnostics();
    diagnostics.registerInstance("bad", () => {
      throw new Error("the lead is gone");
    });
    diagnostics.registerInstance("odd", () => {
      throw "not an Error";
    });
    diagnostics.registerInstance("fine", () => 2);

    expect(diagnostics.read()).toEqual({
      bad: "the lead is gone",
      odd: "not an Error",
      fine: 2,
    });
  });

  it("reads the same whether the overlay is shown or hidden", () => {
    const diagnostics = new Diagnostics();
    diagnostics.registerInstance("build", () => "1.0.0");

    const hidden = diagnostics.read();
    diagnostics.setEnabled(true);

    expect(diagnostics.read()).toEqual(hidden);
  });

  it("drops the world registry when the world closes and leaves the instance registry alone", () => {
    const diagnostics = new Diagnostics();
    diagnostics.registerInstance("build", () => "1.0.0");
    diagnostics.registerWorld("wave", () => 3);

    diagnostics.clearWorldRegistry();

    expect(diagnostics.read()).toEqual({ build: "1.0.0" });
  });
});

/* -------------------------------------------------------------------------- */
/* The frame-time window                                                      */
/* -------------------------------------------------------------------------- */

describe("the frame-time window", () => {
  it("reports zeros for a window holding nothing", () => {
    expect(new SampleWindow().metrics()).toEqual({
      samples: 0,
      meanMs: 0,
      p95Ms: 0,
      p99Ms: 0,
    });
  });

  it("means the samples it holds", () => {
    const window = windowOf([2, 4, 6, 8]);

    expect(window.metrics()).toEqual({
      samples: 4,
      meanMs: 5,
      p95Ms: 8,
      p99Ms: 8,
    });
  });

  it("takes each percentile by nearest rank over the ascending samples", () => {
    // 100 samples of 1..100, so the sample at ceil(p * n) - 1 is p itself.
    const window = windowOf(
      Array.from({ length: 100 }, (_, i) => i + 1),
      1,
    );
    const metrics = window.metrics();

    expect(metrics.samples).toBe(100);
    expect(metrics.p95Ms).toBe(95);
    expect(metrics.p99Ms).toBe(99);
  });

  it("reports a figure that actually happened rather than an interpolated one", () => {
    const window = windowOf([1, 1, 1, 1, 1, 1, 1, 1, 1, 50], 1);

    expect(window.metrics().p95Ms).toBe(50);
    expect(window.metrics().p99Ms).toBe(50);
  });

  it("drops a sample older than ten seconds of simulated time", () => {
    const window = new SampleWindow();
    window.record(0, 40);
    window.record(5_000, 10);
    window.record(10_000, 10);

    expect(window.metrics().samples).toBe(3);

    window.record(10_001, 10);

    // The stall at zero has aged out of the ten-second window.
    expect(window.metrics().samples).toBe(3);
    expect(window.metrics().meanMs).toBe(10);
  });

  it("holds at most 2048 samples, so the memory is flat at any frame rate", () => {
    const window = new SampleWindow();
    for (let i = 0; i < 3_000; i++) window.record(i, i);

    expect(window.metrics().samples).toBe(2048);
    // The oldest live sample is the 2048th from the end.
    expect(window.series()[0]).toBe(3_000 - 2048);
    expect(window.series()[2047]).toBe(2_999);
  });

  it("hands out its samples oldest first", () => {
    expect([...windowOf([3, 1, 2]).series()]).toEqual([3, 1, 2]);
  });
});

/* -------------------------------------------------------------------------- */
/* The panel                                                                  */
/* -------------------------------------------------------------------------- */

describe("drawing the panel", () => {
  it("performs no drawing while the overlay is hidden", () => {
    const { diagnostics } = diagnosticsWith({
      level: "patrol",
      phase: "playing",
      actors: 6,
    });
    diagnostics.registerInstance("build", () => "1.4.0");
    const { ctx, texts, rects, save } = stubContext();

    diagnostics.draw(ctx, 400, 300);

    expect(texts).toEqual([]);
    expect(rects).toEqual([]);
    expect(save).not.toHaveBeenCalled();
  });

  it("draws the world line, the instance lines, the world lines, and the metrics line in that order", () => {
    const { diagnostics } = diagnosticsWith({
      level: "patrol",
      phase: "playing",
      actors: 6,
    });
    diagnostics.timings = fixedTimings(
      { samples: 24, meanMs: 3.416_66, p95Ms: 5.208, p99Ms: 6.125 },
      [3, 4, 5],
    );
    diagnostics.registerInstance("build", () => "patrol 1.4.0");
    diagnostics.registerInstance("opens", () => 1);
    diagnostics.registerWorld("wave", () => 3);
    diagnostics.registerWorld("lead", () => ({ x: -3.625, y: 1, z: 0 }));
    diagnostics.registerWorld("pace", () => 3.875);
    diagnostics.setEnabled(true);
    const { ctx, texts } = stubContext();

    diagnostics.draw(ctx, 400, 300);

    expect(texts).toEqual([
      "level: patrol  phase: playing  actors: 6",
      "build: patrol 1.4.0",
      "opens: 1",
      "wave: 3",
      'lead: {"x":-3.625,"y":1,"z":0}',
      "pace: 3.875",
      "frame: 3.417 / 5.208 / 6.125 ms",
    ]);
  });

  it("formats each value the way the display table says", () => {
    const { diagnostics } = diagnosticsWith();
    diagnostics.registerInstance("string", () => "as itself");
    diagnostics.registerInstance("integer", () => 12);
    diagnostics.registerInstance("fraction", () => 1 / 3);
    diagnostics.registerInstance("nothing", () => null);
    diagnostics.registerInstance("absent", () => undefined);
    diagnostics.registerInstance("bag", () => ({ a: 1 }));
    diagnostics.registerInstance("list", () => [1, 2]);
    diagnostics.registerInstance("flag", () => true);
    diagnostics.setEnabled(true);
    const { ctx, texts } = stubContext();

    diagnostics.draw(ctx, 400, 300);

    expect(texts.slice(0, 8)).toEqual([
      "string: as itself",
      "integer: 12",
      "fraction: 0.333",
      "nothing: null",
      "absent: undefined",
      'bag: {"a":1}',
      "list: [1,2]",
      "flag: true",
    ]);
  });

  it("falls back to the String form of a value JSON.stringify refuses", () => {
    const { diagnostics } = diagnosticsWith();
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    diagnostics.registerInstance("loop", () => cyclic);
    diagnostics.setEnabled(true);
    const { ctx, texts } = stubContext();

    diagnostics.draw(ctx, 400, 300);

    expect(texts[0]).toBe("loop: [object Object]");
  });

  it("keeps the metrics line over an empty window", () => {
    const { diagnostics } = diagnosticsWith();
    diagnostics.setEnabled(true);
    const { ctx, texts, rects } = stubContext();

    diagnostics.draw(ctx, 400, 300);

    expect(texts).toEqual(["frame: 0 / 0 / 0 ms"]);
    // No samples, so no graph: one rectangle, the panel itself.
    expect(rects).toHaveLength(1);
  });

  it("stands the frame-time graph to the right of the text, one column per sample", () => {
    const { diagnostics } = diagnosticsWith();
    diagnostics.timings = fixedTimings(
      { samples: 3, meanMs: 10, p95Ms: 12, p99Ms: 12 },
      [10, 11, 12],
    );
    diagnostics.setEnabled(true);
    const { ctx, rects } = stubContext();

    diagnostics.draw(ctx, 400, 300);

    // The panel, the plot area, and one bar per sample.
    expect(rects).toHaveLength(5);
    const panel = rects[0]!;
    const plot = rects[1]!;
    expect(plot.x).toBeGreaterThan(panel.x);
    const bars = rects.slice(2);
    expect(bars.map((bar) => bar.x)).toEqual(
      [...bars].sort((a, b) => a.x - b.x).map((bar) => bar.x),
    );
  });

  it("scales the graph from a floor of 33.3 ms, so an even run reads as flat", () => {
    const even = diagnosticsWith().diagnostics;
    even.timings = fixedTimings(
      { samples: 2, meanMs: 16.7, p95Ms: 16.7, p99Ms: 16.7 },
      [16.7, 16.7],
    );
    even.setEnabled(true);
    const uneven = diagnosticsWith().diagnostics;
    uneven.timings = fixedTimings(
      { samples: 2, meanMs: 40, p95Ms: 66.6, p99Ms: 66.6 },
      [16.7, 66.6],
    );
    uneven.setEnabled(true);

    const flat = stubContext();
    even.draw(flat.ctx, 400, 300);
    const spiky = stubContext();
    uneven.draw(spiky.ctx, 400, 300);

    const plot = flat.rects[1]!;
    const bar = flat.rects[2]!;
    // Half the floor's height rather than the full height a window-maximum
    // scale would have drawn.
    expect(bar.h).toBeCloseTo((16.7 / 33.3) * plot.h, 6);
    // The tallest sample sets the scale once it passes the floor.
    expect(spiky.rects[3]!.h).toBeCloseTo(spiky.rects[1]!.h, 6);
  });

  it("clamps the panel to the surface it is drawn on", () => {
    const { diagnostics } = diagnosticsWith({
      level: "a-very-long-level-name",
      phase: "playing",
      actors: 6,
    });
    diagnostics.setEnabled(true);
    const { ctx, rects } = stubContext();

    diagnostics.draw(ctx, 60, 40);
    const panel = rects[0]!;

    expect(panel.w).toBeLessThanOrEqual(60);
    expect(panel.h).toBeLessThanOrEqual(40);
  });

  it("saves and restores the context around everything it does", () => {
    const { diagnostics } = diagnosticsWith();
    diagnostics.setEnabled(true);
    const { ctx, save, restore } = stubContext();

    diagnostics.draw(ctx, 400, 300);

    expect(save).toHaveBeenCalledTimes(1);
    expect(restore).toHaveBeenCalledTimes(1);
  });

  it("restores the context even when the drawing throws", () => {
    const { diagnostics } = diagnosticsWith();
    diagnostics.setEnabled(true);
    const { ctx, save, restore } = stubContext({
      measureText: () => {
        throw new Error("the context is gone");
      },
    });

    expect(() => diagnostics.draw(ctx, 400, 300)).toThrow(
      /the context is gone/,
    );
    expect(save).toHaveBeenCalledTimes(1);
    expect(restore).toHaveBeenCalledTimes(1);
  });

  it("survives a world-line provider that throws, drawing the rest of the panel", () => {
    const diagnostics = new Diagnostics(undefined, () => {
      throw new Error("no world");
    });
    diagnostics.registerInstance("build", () => "1.0.0");
    diagnostics.setEnabled(true);
    const { ctx, texts } = stubContext();

    diagnostics.draw(ctx, 400, 300);

    expect(texts[0]).toBe("build: 1.0.0");
  });

  it("draws its column onto a real 2D surface", () => {
    const { diagnostics } = diagnosticsWith({
      level: "patrol",
      phase: "playing",
      actors: 6,
    });
    diagnostics.registerInstance("build", () => "patrol 1.4.0");
    const canvas = createCanvas(320, 180);
    const ctx = canvas.getContext("2d") as unknown as CanvasRenderingContext2D;

    diagnostics.draw(ctx, 320, 180);
    const blank = canvas.toBuffer("image/png").length;
    diagnostics.setEnabled(true);
    diagnostics.draw(ctx, 320, 180);

    // The panel is translucent black over transparency, so the top-left corner
    // carries it and the far corner does not.
    const painted = ctx.getImageData(20, 20, 1, 1).data;
    expect(painted[3]).toBeGreaterThan(0);
    expect(ctx.getImageData(319, 179, 1, 1).data[3]).toBe(0);
    expect(canvas.toBuffer("image/png").length).toBeGreaterThan(blank);
  });
});

/* -------------------------------------------------------------------------- */
/* The overlay surface                                                        */
/* -------------------------------------------------------------------------- */

describe("the overlay surface", () => {
  it("is inert where no 2D surface can be made at all", () => {
    // Node: no document behind the canvas and no 2D `OffscreenCanvas`. The
    // engine draws nothing and calls `draw` on nothing, while `read` and
    // `metrics` answer as always.
    const canvas = { width: 320, height: 180 } as unknown as HTMLCanvasElement;

    expect(createOverlaySurface(canvas)).toBeNull();
  });

  it("uses an offscreen surface where the host has one but no document", () => {
    const made: { width: number; height: number }[] = [];
    const surfaceContext = stubContext();
    class FakeOffscreen {
      constructor(
        public width: number,
        public height: number,
      ) {
        made.push({ width, height });
      }

      getContext(): unknown {
        return surfaceContext.ctx;
      }
    }
    const host = globalThis as { OffscreenCanvas?: unknown };
    const had = host.OffscreenCanvas;
    host.OffscreenCanvas = FakeOffscreen;
    try {
      const canvas = {
        width: 320,
        height: 180,
      } as unknown as HTMLCanvasElement;
      const surface = createOverlaySurface(canvas);

      expect(surface).not.toBeNull();
      expect(made).toEqual([{ width: 320, height: 180 }]);
      surface?.sync(64, 32);
      // The one surface tracks the canvas's backing store and comes back blank
      // every frame, so last frame's panel never lingers.
      expect(made).toEqual([{ width: 320, height: 180 }]);
      expect(surfaceContext.clears).toEqual([{ w: 64, h: 32 }]);
      expect(surface?.context()).toBe(surfaceContext.ctx);
      // Nothing to detach: an offscreen surface was never in a document.
      expect(() => surface?.dispose()).not.toThrow();
    } finally {
      if (had === undefined) delete host.OffscreenCanvas;
      else host.OffscreenCanvas = had;
    }
  });
});

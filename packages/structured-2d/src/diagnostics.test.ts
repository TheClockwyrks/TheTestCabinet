import { describe, expect, it, vi } from "vitest";
import { Diagnostics, type WorldStatus } from "./diagnostics";

/**
 * A 2D context stand-in recording the text and rectangles the overlay drew.
 * Style assignments land on plain properties, which is all the overlay needs.
 */
function stubContext(
  overrides: Partial<Record<"measureText", (text: string) => TextMetrics>> = {},
): {
  ctx: CanvasRenderingContext2D;
  texts: string[];
  rects: { x: number; y: number; w: number; h: number }[];
  save: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
} {
  const texts: string[] = [];
  const rects: { x: number; y: number; w: number; h: number }[] = [];
  const save = vi.fn();
  const restore = vi.fn();
  const ctx = {
    save,
    restore,
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
  return { ctx, texts, rects, save, restore };
}

/** A diagnostics over a settable world line. */
function diagnosticsWith(status: WorldStatus | null = null): {
  diagnostics: Diagnostics;
  world: { status: WorldStatus | null };
} {
  const world = { status };
  const diagnostics = new Diagnostics({ world: () => world.status });
  return { diagnostics, world };
}

describe("Diagnostics visibility", () => {
  it("is hidden when the engine is created", () => {
    expect(new Diagnostics().enabled()).toBe(false);
  });

  it("shows, hides, and toggles", () => {
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

describe("Diagnostics.read", () => {
  it("evaluates the instance registry first, each in registration order", () => {
    const diagnostics = new Diagnostics();
    diagnostics.registerWorld("wave", () => 3);
    diagnostics.registerInstance("build", () => "patrol 1.4.0");
    diagnostics.registerInstance("opens", () => 1);
    diagnostics.registerWorld("drones", () => 6);

    expect(diagnostics.read()).toEqual([
      { name: "build", value: "patrol 1.4.0" },
      { name: "opens", value: 1 },
      { name: "wave", value: 3 },
      { name: "drones", value: 6 },
    ]);
  });

  it("reports each of the three value types as itself", () => {
    const diagnostics = new Diagnostics();
    diagnostics.registerInstance("title", () => "vault");
    diagnostics.registerWorld("bricks", () => 12);
    diagnostics.registerWorld("cleared", () => false);

    expect(diagnostics.read()).toEqual([
      { name: "title", value: "vault" },
      { name: "bricks", value: 12 },
      { name: "cleared", value: false },
    ]);
  });

  it("keeps a reading in each registry for a name registered in both", () => {
    const diagnostics = new Diagnostics();
    diagnostics.registerInstance("score", () => 1);
    diagnostics.registerWorld("score", () => 2);

    expect(diagnostics.read()).toEqual([
      { name: "score", value: 1 },
      { name: "score", value: 2 },
    ]);
  });

  it("invokes each source on every read, never sampling at registration", () => {
    const diagnostics = new Diagnostics();
    let score = 0;
    diagnostics.registerInstance("score", () => score);

    expect(diagnostics.read()).toEqual([{ name: "score", value: 0 }]);
    score = 42;
    expect(diagnostics.read()).toEqual([{ name: "score", value: 42 }]);
  });

  it("replaces a re-registered source and keeps its original position", () => {
    const diagnostics = new Diagnostics();
    diagnostics.registerInstance("a", () => 1);
    diagnostics.registerInstance("b", () => 2);

    diagnostics.registerInstance("a", () => 10);

    expect(diagnostics.read()).toEqual([
      { name: "a", value: 10 },
      { name: "b", value: 2 },
    ]);
  });

  it("reports a throwing source as an error with no value, and never itself throws", () => {
    const diagnostics = new Diagnostics();
    diagnostics.registerInstance("bad", () => {
      throw new Error("no world open");
    });
    diagnostics.registerWorld("worse", () => {
      // A thrown non-Error contributes its String form.
      throw "plain refusal";
    });
    diagnostics.registerWorld("fine", () => 7);

    const readings = diagnostics.read();

    expect(readings).toEqual([
      { name: "bad", error: "no world open" },
      { name: "worse", error: "plain refusal" },
      { name: "fine", value: 7 },
    ]);
    // A failure is not a reading of any type: nothing compares equal to the
    // message the panel happens to draw in the value's place.
    expect(readings[0]).not.toHaveProperty("value");
    expect(readings[1]).not.toHaveProperty("value");
  });

  it("returns values unformatted", () => {
    const diagnostics = new Diagnostics();
    diagnostics.registerWorld("pace", () => 74.75);
    diagnostics.registerWorld("drift", () => Number.NaN);

    expect(diagnostics.read()).toEqual([
      { name: "pace", value: 74.75 },
      { name: "drift", value: Number.NaN },
    ]);
  });

  it("reads the same with the overlay hidden, and leaves it as it found it", () => {
    const diagnostics = new Diagnostics();
    diagnostics.registerInstance("score", () => 5);

    expect(diagnostics.enabled()).toBe(false);
    expect(diagnostics.read()).toEqual([{ name: "score", value: 5 }]);
    expect(diagnostics.enabled()).toBe(false);

    diagnostics.setEnabled(true);
    expect(diagnostics.read()).toEqual([{ name: "score", value: 5 }]);
    expect(diagnostics.enabled()).toBe(true);
  });

  it("changes nothing the sources read, however often it is read", () => {
    const diagnostics = new Diagnostics();
    const world = { bricks: 12 };
    diagnostics.registerWorld("bricks", () => world.bricks);

    const first = diagnostics.read();
    const second = diagnostics.read();

    expect(second).toEqual(first);
    expect(world).toEqual({ bricks: 12 });
  });

  it("drops world sources when the world closes, keeping the instance's", () => {
    const diagnostics = new Diagnostics();
    diagnostics.registerInstance("build", () => "v1");
    diagnostics.registerWorld("bricks", () => 12);

    diagnostics.dropWorldSources();

    expect(diagnostics.read()).toEqual([{ name: "build", value: "v1" }]);
  });
});

describe("Diagnostics.metrics", () => {
  it("reports an empty window as zeros", () => {
    expect(new Diagnostics().metrics()).toEqual({
      samples: 0,
      meanMs: 0,
      p95Ms: 0,
      p99Ms: 0,
    });
  });

  it("reports a single sample as its own mean and percentiles", () => {
    const diagnostics = new Diagnostics();
    diagnostics.recordFrame(16, 3.5);

    expect(diagnostics.metrics()).toEqual({
      samples: 1,
      meanMs: 3.5,
      p95Ms: 3.5,
      p99Ms: 3.5,
    });
  });

  it("takes percentiles by nearest rank over the sorted window", () => {
    const diagnostics = new Diagnostics();
    // 1..20 in a shuffled arrival order; the sort is the window's business.
    for (const cost of [
      7, 1, 20, 3, 15, 9, 2, 18, 5, 11, 4, 13, 6, 17, 8, 19, 10, 14, 12, 16,
    ]) {
      diagnostics.recordFrame(0, cost);
    }

    const metrics = diagnostics.metrics();
    expect(metrics.samples).toBe(20);
    expect(metrics.meanMs).toBe(10.5);
    // ceil(0.95 * 20) - 1 = 18 → the 19th value ascending.
    expect(metrics.p95Ms).toBe(19);
    // ceil(0.99 * 20) - 1 = 19 → the largest.
    expect(metrics.p99Ms).toBe(20);
  });

  it("drops samples older than 10 seconds of simulated time", () => {
    const diagnostics = new Diagnostics();
    diagnostics.recordFrame(0, 5);
    diagnostics.recordFrame(10_000, 7);
    // Exactly ten seconds apart is still inside the window.
    expect(diagnostics.metrics().samples).toBe(2);

    diagnostics.recordFrame(10_001, 9);

    const metrics = diagnostics.metrics();
    expect(metrics.samples).toBe(2);
    expect(metrics.meanMs).toBe(8);
  });

  it("caps the window at 2048 samples, keeping the most recent", () => {
    const diagnostics = new Diagnostics();
    for (let i = 0; i < 2050; i++) diagnostics.recordFrame(0, i);

    const metrics = diagnostics.metrics();
    expect(metrics.samples).toBe(2048);
    // The two oldest (0 and 1) fell out: the mean is over 2..2049.
    expect(metrics.meanMs).toBe(1025.5);
  });
});

describe("Diagnostics.draw", () => {
  it("performs no drawing when the overlay is hidden", () => {
    const { diagnostics } = diagnosticsWith({
      level: "patrol",
      phase: "playing",
      actors: 6,
    });
    const { ctx, texts, rects, save } = stubContext();

    diagnostics.draw(ctx, 640, 360);

    expect(save).not.toHaveBeenCalled();
    expect(texts).toEqual([]);
    expect(rects).toEqual([]);
  });

  it("draws the documented column: world line, instance, world, metrics", () => {
    const { diagnostics } = diagnosticsWith({
      level: "patrol",
      phase: "playing",
      actors: 6,
    });
    diagnostics.registerWorld("wave", () => 3);
    diagnostics.registerInstance("build", () => "patrol 1.4.0");
    diagnostics.registerInstance("opens", () => 1);
    diagnostics.registerWorld("pace", () => 74.75);
    diagnostics.setEnabled(true);
    const { ctx, texts } = stubContext();

    diagnostics.draw(ctx, 640, 360);

    expect(texts).toEqual([
      "level: patrol  phase: playing  actors: 6",
      "build: patrol 1.4.0",
      "opens: 1",
      "wave: 3",
      "pace: 74.750",
      "frame: 0 / 0 / 0 ms",
    ]);
  });

  it("formats each value shape the documented way", () => {
    const { diagnostics } = diagnosticsWith();
    diagnostics.registerInstance("title", () => "vault");
    diagnostics.registerInstance("whole", () => 3);
    diagnostics.registerInstance("fraction", () => 217.375);
    diagnostics.registerInstance("lead", () => "217.4, 120.0");
    diagnostics.registerInstance("flag", () => true);
    diagnostics.registerInstance("cleared", () => false);
    diagnostics.registerInstance("drift", () => Number.NaN);
    diagnostics.registerInstance("ceiling", () => Number.POSITIVE_INFINITY);
    diagnostics.setEnabled(true);
    const { ctx, texts } = stubContext();

    diagnostics.draw(ctx, 640, 360);

    expect(texts).toEqual([
      "title: vault",
      "whole: 3",
      "fraction: 217.375",
      "lead: 217.4, 120.0",
      "flag: true",
      "cleared: false",
      "drift: NaN",
      "ceiling: Infinity",
      "frame: 0 / 0 / 0 ms",
    ]);
  });

  it("shows a throwing source's message in place of its value", () => {
    const { diagnostics } = diagnosticsWith();
    diagnostics.registerWorld("pawn", () => {
      throw new Error("no pawn possessed");
    });
    diagnostics.setEnabled(true);
    const { ctx, texts } = stubContext();

    diagnostics.draw(ctx, 640, 360);

    expect(texts).toContain("pawn: no pawn possessed");
  });

  it("formats the metrics line from the window's figures", () => {
    const { diagnostics } = diagnosticsWith();
    diagnostics.recordFrame(16, 3.417);
    diagnostics.setEnabled(true);
    const { ctx, texts } = stubContext();

    diagnostics.draw(ctx, 640, 360);

    expect(texts.at(-1)).toBe("frame: 3.417 / 3.417 / 3.417 ms");
  });

  it("skips the world line while no world is open", () => {
    const { diagnostics, world } = diagnosticsWith({
      level: "vault",
      phase: "waiting",
      actors: 0,
    });
    diagnostics.registerInstance("build", () => "v1");
    diagnostics.setEnabled(true);
    world.status = null;
    const { ctx, texts } = stubContext();

    diagnostics.draw(ctx, 640, 360);

    expect(texts[0]).toBe("build: v1");
  });

  it("saves and restores the context around its own work", () => {
    const { diagnostics } = diagnosticsWith();
    diagnostics.setEnabled(true);
    const { ctx, save, restore } = stubContext();

    diagnostics.draw(ctx, 640, 360);

    expect(save).toHaveBeenCalledTimes(1);
    expect(restore).toHaveBeenCalledTimes(1);
  });

  it("restores the context even when measuring throws", () => {
    const { diagnostics } = diagnosticsWith();
    diagnostics.setEnabled(true);
    const { ctx, restore } = stubContext({
      measureText: () => {
        throw new Error("lost context");
      },
    });

    expect(() => diagnostics.draw(ctx, 640, 360)).toThrow(/lost context/);
    expect(restore).toHaveBeenCalledTimes(1);
  });

  it("draws the frame-time graph beside the text once the window has samples", () => {
    const { diagnostics } = diagnosticsWith();
    diagnostics.registerInstance("score", () => 5);
    diagnostics.setEnabled(true);
    const bare = stubContext();
    diagnostics.draw(bare.ctx, 640, 360);
    // Panel alone: one rectangle, no graph.
    expect(bare.rects).toHaveLength(1);

    diagnostics.recordFrame(16, 4);
    diagnostics.recordFrame(32, 8);
    const { ctx, rects } = stubContext();
    diagnostics.draw(ctx, 640, 360);

    // Panel, the graph's plot area, and one column per sample.
    expect(rects).toHaveLength(4);
    const panel = rects[0];
    const plot = rects[1];
    expect(plot && panel && plot.x > panel.x).toBe(true);

    // The scale floors at 33.3 ms, so an even run reads flat rather than
    // amplified: the 8 ms column stands at 8 / 33.3 of the plot's height.
    const tall = rects[3];
    expect(plot && tall && tall.h / plot.h).toBeCloseTo(8 / 33.3, 5);
  });

  it("scales its type with the surface height, with a floor for legibility", () => {
    const { diagnostics } = diagnosticsWith();
    diagnostics.setEnabled(true);

    const small = stubContext();
    diagnostics.draw(small.ctx, 320, 180);
    expect(small.ctx.font).toContain("11px");

    const large = stubContext();
    diagnostics.draw(large.ctx, 1920, 1080);
    expect(large.ctx.font).toContain(`${Math.round(1080 * 0.02)}px`);
  });
});

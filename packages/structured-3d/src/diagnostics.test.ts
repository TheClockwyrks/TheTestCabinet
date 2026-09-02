import { describe, expect, it } from "vitest";
import type { DiagnosticValue } from "./contract";
import type { RendererCounts, WorldStatus } from "./diagnostics";
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
 * and see that the overlay set no transform of its own — which is the whole claim
 * behind "the overlay is chrome in device space".
 */
function overlay(): Context2dStub {
  return createContext2dStub(document.createElement("canvas"));
}

/** The text of every line the overlay drew, in the order it drew them. */
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

/** A renderer's counters for the frame it last drew. */
function counts(drawCalls: number, triangles: number): RendererCounts {
  return { drawCalls: () => drawCalls, triangles: () => triangles };
}

/** A diagnostics over a settable world line and a fixed renderer cost. */
function diagnosticsWith(
  status: WorldStatus | null = null,
  renderer: RendererCounts = counts(0, 0),
): {
  diagnostics: Diagnostics;
  world: { status: WorldStatus | null };
} {
  const world = { status };
  const diagnostics = new Diagnostics({
    world: () => world.status,
    counts: renderer,
  });
  return { diagnostics, world };
}

/** A visible overlay showing `values` from the world registry, with no world line. */
function withSources(values: Record<string, DiagnosticValue>): Diagnostics {
  const diagnostics = new Diagnostics();
  for (const [name, value] of Object.entries(values)) {
    diagnostics.registerWorld(name, () => value);
  }
  diagnostics.setEnabled(true);
  return diagnostics;
}

/** A visible overlay whose window already holds `series`, recorded at one instant. */
function withWindow(
  series: readonly number[],
  renderer: RendererCounts = counts(0, 0),
): Diagnostics {
  const diagnostics = new Diagnostics({ counts: renderer });
  for (const cost of series) diagnostics.recordFrame(0, cost);
  diagnostics.setEnabled(true);
  return diagnostics;
}

describe("Diagnostics visibility", () => {
  it("is hidden when the engine is created", () => {
    expect(new Diagnostics().enabled()).toBe(false);
  });

  it("shows, hides, and toggles in both directions", () => {
    const diagnostics = new Diagnostics();

    diagnostics.setEnabled(true);
    expect(diagnostics.enabled()).toBe(true);

    diagnostics.setEnabled(false);
    expect(diagnostics.enabled()).toBe(false);

    // What the engine's `Backquote` key calls.
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

  it("reads a source that closes over a framework object the world rebuilds", () => {
    // The usage page's idiom: a source closes over the object holding the value
    // rather than over a copy, and reduces it to one of the three types itself.
    const diagnostics = new Diagnostics();
    let ball: { position: { x: number; y: number; z: number } } | null = null;
    diagnostics.registerWorld("ball", () => {
      if (ball === null) return "none";
      const { x, y, z } = ball.position;
      return `${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}`;
    });

    // A source always returns a value; an absent subject reports the game's own
    // placeholder rather than an error the engine invented.
    expect(diagnostics.read()).toEqual([{ name: "ball", value: "none" }]);

    ball = { position: { x: -2.25, y: 0, z: 0 } };
    expect(diagnostics.read()).toEqual([
      { name: "ball", value: "-2.3, 0.0, 0.0" },
    ]);
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

  it("holds one reading per name however often a name is re-registered", () => {
    const diagnostics = new Diagnostics();
    for (let i = 0; i < 5000; i++) diagnostics.registerWorld("frames", () => i);

    expect(diagnostics.read().map((reading) => reading.name)).toEqual([
      "frames",
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
    // message the panel happens to draw in the value's place, so a check sees a
    // failed source as a failure rather than as a legitimate string reading.
    expect(readings[0]).not.toHaveProperty("value");
    expect(readings[1]).not.toHaveProperty("value");
    expect(readings[2]).not.toHaveProperty("error");
  });

  it("returns values unformatted", () => {
    const diagnostics = new Diagnostics();
    diagnostics.registerWorld("pace", () => 74.75);
    diagnostics.registerWorld("drift", () => Number.NaN);
    diagnostics.registerWorld("third", () => 1 / 3);

    expect(diagnostics.read()).toEqual([
      { name: "pace", value: 74.75 },
      { name: "drift", value: Number.NaN },
      { name: "third", value: 1 / 3 },
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

  it("does not advance the frame window or the overlay's visibility", () => {
    const diagnostics = new Diagnostics();
    diagnostics.recordFrame(16, 4);
    diagnostics.registerWorld("score", () => 1);

    const before = diagnostics.metrics();
    diagnostics.read();
    diagnostics.read();

    expect(diagnostics.metrics()).toEqual(before);
    expect(diagnostics.enabled()).toBe(false);
  });

  it("reads an empty pair of registries as no readings at all", () => {
    expect(new Diagnostics().read()).toEqual([]);
  });
});

describe("Diagnostics registry lifetimes", () => {
  it("drops world sources when the world closes, keeping the instance's", () => {
    const diagnostics = new Diagnostics();
    diagnostics.registerInstance("build", () => "v1");
    diagnostics.registerWorld("bricks", () => 12);

    diagnostics.dropWorldSources();

    expect(diagnostics.read()).toEqual([{ name: "build", value: "v1" }]);
  });

  it("keeps instance sources across level transitions, one registry per level", () => {
    // The instance registry survives every transition; the world registry is
    // rebuilt with the world, so the panel always describes the level on screen.
    const diagnostics = new Diagnostics();
    diagnostics.registerInstance("high-score", () => 400);
    diagnostics.registerWorld("bricks", () => 40);

    expect(diagnostics.read().map((r) => r.name)).toEqual([
      "high-score",
      "bricks",
    ]);

    diagnostics.dropWorldSources();
    diagnostics.registerWorld("drones", () => 6);

    expect(diagnostics.read()).toEqual([
      { name: "high-score", value: 400 },
      { name: "drones", value: 6 },
    ]);
  });

  it("drops a world name that shadowed an instance name, leaving the instance's", () => {
    const diagnostics = new Diagnostics();
    diagnostics.registerInstance("score", () => 1);
    diagnostics.registerWorld("score", () => 2);

    diagnostics.dropWorldSources();

    expect(diagnostics.read()).toEqual([{ name: "score", value: 1 }]);
  });

  it("drops an empty world registry without complaint", () => {
    const diagnostics = new Diagnostics();
    diagnostics.dropWorldSources();
    diagnostics.dropWorldSources();

    expect(diagnostics.read()).toEqual([]);
  });
});

describe("Diagnostics.metrics", () => {
  it("reports an empty window and no renderer cost before anything has run", () => {
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

  it("reports a single sample as its own mean and percentiles", () => {
    const diagnostics = new Diagnostics();
    diagnostics.recordFrame(16, 3.5);

    expect(diagnostics.metrics()).toMatchObject({
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

  it("reports a percentile that is a frame time which actually happened", () => {
    // Nearest rank rather than interpolation: every figure the panel shows is a
    // sample from the window, which is what a reader comparing it against a frame
    // they felt needs it to be.
    const diagnostics = new Diagnostics();
    for (const cost of [4, 4, 4, 4, 4, 4, 4, 4, 4, 90]) {
      diagnostics.recordFrame(0, cost);
    }

    const metrics = diagnostics.metrics();
    // ceil(0.95 * 10) - 1 = 9 → the spike itself, not a blend of 4 and 90.
    expect(metrics.p95Ms).toBe(90);
    expect(metrics.p99Ms).toBe(90);
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

  it("measures the window's age against simulated time, not wall time", () => {
    // A stepped run advances simulated time while no real time passes at all, so a
    // wall-clock window would report an entire scripted run as one instant.
    const diagnostics = new Diagnostics();
    for (let frame = 0; frame < 1200; frame++) {
      diagnostics.recordFrame(frame * 16.67, 4);
    }

    // 10_000 / 16.67 is 599.9 frames back, so the window holds the last 600.
    expect(diagnostics.metrics().samples).toBe(600);
  });

  it("caps the window at 2048 samples, keeping the most recent", () => {
    const diagnostics = new Diagnostics();
    for (let i = 0; i < 2050; i++) diagnostics.recordFrame(0, i);

    const metrics = diagnostics.metrics();
    expect(metrics.samples).toBe(2048);
    // The two oldest (0 and 1) fell out: the mean is over 2..2049.
    expect(metrics.meanMs).toBe(1025.5);
  });

  it("keeps the window bounded above 204 frames a second", () => {
    // Both rules bound it and neither replaces the other: at 500 frames a second
    // ten seconds of simulated time is 5000 frames, and capacity is what stops the
    // buffer growing to hold them.
    const diagnostics = new Diagnostics();
    for (let frame = 0; frame < 5000; frame++) {
      diagnostics.recordFrame(frame * 2, 1);
    }

    expect(diagnostics.metrics().samples).toBe(2048);
  });

  it("puts the window beside the renderer's counts for the last frame", () => {
    const diagnostics = new Diagnostics({ counts: counts(48, 12_744) });
    diagnostics.recordFrame(16, 16.5);

    expect(diagnostics.metrics()).toEqual({
      samples: 1,
      meanMs: 16.5,
      p95Ms: 16.5,
      p99Ms: 16.5,
      drawCalls: 48,
      triangles: 12_744,
    });
  });

  it("reads the renderer's seam again on every call", () => {
    let frame = 0;
    const diagnostics = new Diagnostics({
      counts: { drawCalls: () => ++frame, triangles: () => frame * 100 },
    });

    expect(diagnostics.metrics()).toMatchObject({
      drawCalls: 1,
      triangles: 100,
    });
    expect(diagnostics.metrics()).toMatchObject({
      drawCalls: 2,
      triangles: 200,
    });
  });

  it("follows a renderer seam wired after construction", () => {
    // The engine builds the overlay before the pipeline exists, then wires it in;
    // an overlay read in between reports the idle figures.
    const diagnostics = new Diagnostics();
    expect(diagnostics.metrics()).toMatchObject({ drawCalls: 0, triangles: 0 });

    diagnostics.counts = counts(5, 60);

    expect(diagnostics.metrics()).toMatchObject({
      drawCalls: 5,
      triangles: 60,
    });
  });

  it("does not average the counts over the window", () => {
    // The two counts describe the frame most recently rendered rather than the
    // window the timings summarize.
    const diagnostics = new Diagnostics({ counts: counts(6, 72) });
    for (let i = 0; i < 600; i++) diagnostics.recordFrame(i * 16, 16);

    expect(diagnostics.metrics()).toMatchObject({
      samples: 600,
      drawCalls: 6,
      triangles: 72,
    });
  });
});

describe("rendererCounts", () => {
  /** A stand-in for the render stage, whose `counts()` the engine wires in. */
  function stage(drawCalls: number, triangles: number) {
    const captured = { drawCalls, triangles };
    return {
      counts: () => captured,
      /** What a frame does: the stage recaptures the scene's counts as it draws. */
      drew(nextCalls: number, nextTriangles: number) {
        captured.drawCalls = nextCalls;
        captured.triangles = nextTriangles;
      },
    };
  }

  it("reads the stage's counts on every call rather than capturing them once", () => {
    const drawn = stage(4, 900);
    const seam = rendererCounts(drawn);

    expect(seam.drawCalls()).toBe(4);
    expect(seam.triangles()).toBe(900);

    drawn.drew(61, 128_400);

    expect(seam.drawCalls()).toBe(61);
    expect(seam.triangles()).toBe(128_400);
  });

  it("reports the scene's counts and not the composite's", () => {
    // The regression this whole seam exists for: three resets `renderer.info` at
    // the top of every `render` call and the engine makes a second one to
    // composite the screen layer, so an overlay reading the renderer live would
    // show one draw call and two triangles whatever the game submitted. The
    // stage's snapshot is taken between the two, and is what the panel reports.
    const drawn = stage(0, 0);
    const seam = rendererCounts(drawn);

    // The scene render, and the stage capturing what it cost.
    drawn.drew(48, 12_744);
    // The composite that follows resets three's own counters; the snapshot stands.

    expect(seam.drawCalls()).toBe(48);
    expect(seam.triangles()).toBe(12_744);
  });

  it("carries the stage's counts through to the metrics the overlay reports", () => {
    const diagnostics = new Diagnostics({
      counts: rendererCounts(stage(12, 3_600)),
    });
    diagnostics.recordFrame(16, 16);

    expect(diagnostics.metrics()).toMatchObject({
      drawCalls: 12,
      triangles: 3_600,
    });
  });
});

describe("Diagnostics.draw", () => {
  it("performs no drawing when the overlay is hidden", () => {
    const { diagnostics } = diagnosticsWith({
      level: "patrol",
      phase: "playing",
      actors: 6,
    });
    diagnostics.registerWorld("wave", () => 3);
    diagnostics.recordFrame(16, 4);
    const stub = overlay();

    diagnostics.draw(stub.ctx, 640, 360);

    expect(stub.ops).toEqual([]);
  });

  it("draws the documented column: world line, instance, world, metrics", () => {
    const { diagnostics } = diagnosticsWith(
      { level: "patrol", phase: "playing", actors: 7 },
      counts(6, 72),
    );
    diagnostics.registerInstance("build", () => "patrol 1.4.0");
    diagnostics.registerInstance("opens", () => 1);
    diagnostics.registerWorld("wave", () => 3);
    diagnostics.registerWorld("drones", () => 6);
    diagnostics.registerWorld("lead", () => "-2.3, 0.0, 0.0");
    diagnostics.registerWorld("pace", () => 2.05);
    diagnostics.setEnabled(true);

    // A window whose mean is 3.417 ms, whose 19th sample ascending (the 95th
    // percentile of twenty, by nearest rank) is 5.208, and whose largest (the
    // 99th) is 6.125 — the panel the examples page prints.
    for (let i = 0; i < 17; i++) diagnostics.recordFrame(0, 3.167);
    diagnostics.recordFrame(0, 3.168);
    diagnostics.recordFrame(0, 5.208);
    diagnostics.recordFrame(0, 6.125);

    const stub = overlay();
    diagnostics.draw(stub.ctx, 640, 360);

    expect(drawnLines(stub)).toEqual([
      "level: patrol  phase: playing  actors: 7",
      "build: patrol 1.4.0",
      "opens: 1",
      "wave: 3",
      "drones: 6",
      "lead: -2.3, 0.0, 0.0",
      "pace: 2.050",
      "frame: 3.417 / 5.208 / 6.125 ms · 6 draws · 72 tris",
    ]);
  });

  it("skips the world line while no world is open", () => {
    const { diagnostics, world } = diagnosticsWith({
      level: "vault",
      phase: "waiting",
      actors: 0,
    });
    diagnostics.registerInstance("build", () => "v1");
    diagnostics.setEnabled(true);
    // A transition's gap: the instance's sources still read, and the engine has no
    // world to describe.
    world.status = null;
    const stub = overlay();

    diagnostics.draw(stub.ctx, 640, 360);

    expect(drawnLines(stub)[0]).toBe("build: v1");
  });

  it("reads the world line at the instant it draws", () => {
    const { diagnostics, world } = diagnosticsWith({
      level: "vault",
      phase: "waiting",
      actors: 0,
    });
    diagnostics.setEnabled(true);

    const first = overlay();
    diagnostics.draw(first.ctx, 640, 360);
    expect(drawnLines(first)[0]).toBe(
      "level: vault  phase: waiting  actors: 0",
    );

    world.status = { level: "patrol", phase: "over", actors: 12 };
    const second = overlay();
    diagnostics.draw(second.ctx, 640, 360);
    expect(drawnLines(second)[0]).toBe(
      "level: patrol  phase: over  actors: 12",
    );
  });

  it("formats each value shape the documented way", () => {
    const diagnostics = withSources({
      title: "vault",
      whole: 3,
      fraction: 217.375,
      third: 1 / 3,
      negative: -0.5,
      lead: "217.4, 120.0",
      flag: true,
      cleared: false,
    });
    const stub = overlay();

    diagnostics.draw(stub.ctx, 640, 360);

    expect(drawnLines(stub).slice(0, 8)).toEqual([
      "title: vault",
      "whole: 3",
      "fraction: 217.375",
      "third: 0.333",
      "negative: -0.500",
      "lead: 217.4, 120.0",
      "flag: true",
      "cleared: false",
    ]);
  });

  it("shows a whole float without a fractional part as an integer", () => {
    const diagnostics = withSources({ speed: 12.0 });
    const stub = overlay();

    diagnostics.draw(stub.ctx, 640, 360);

    expect(drawnLines(stub)[0]).toBe("speed: 12");
  });

  it("draws a number that is not finite as itself", () => {
    const diagnostics = withSources({
      drift: Number.NaN,
      ceiling: Number.POSITIVE_INFINITY,
      floor: Number.NEGATIVE_INFINITY,
    });
    const stub = overlay();

    diagnostics.draw(stub.ctx, 640, 360);

    expect(drawnLines(stub).slice(0, 3)).toEqual([
      "drift: NaN",
      "ceiling: Infinity",
      "floor: -Infinity",
    ]);
  });

  it("shows a throwing source's message in place of its value, and keeps drawing", () => {
    const { diagnostics } = diagnosticsWith();
    diagnostics.registerWorld("pawn", () => {
      throw new Error("no pawn possessed");
    });
    diagnostics.registerWorld("score", () => 3);
    diagnostics.setEnabled(true);
    const stub = overlay();

    diagnostics.draw(stub.ctx, 640, 360);

    expect(drawnLines(stub).slice(0, 2)).toEqual([
      "pawn: no pawn possessed",
      "score: 3",
    ]);
    expect(stub.opsOf("restore")).toHaveLength(1);
  });

  it("draws lines in registration order, a re-registered name in its old place", () => {
    const { diagnostics } = diagnosticsWith();
    diagnostics.registerWorld("target", () => "none");
    diagnostics.registerWorld("placed", () => 2);
    diagnostics.registerWorld("target", () => "crate");
    diagnostics.setEnabled(true);
    const stub = overlay();

    diagnostics.draw(stub.ctx, 640, 360);

    expect(drawnLines(stub).slice(0, 2)).toEqual([
      "target: crate",
      "placed: 2",
    ]);
  });

  it("draws in a monospace face", () => {
    const diagnostics = withSources({ score: 3 });
    const stub = overlay();

    diagnostics.draw(stub.ctx, 640, 360);

    expect(stub.ctx.font).toContain("monospace");
  });

  it("sets no transform of its own, so it draws in the device space the engine reset to", () => {
    // The screen layer's transform is the identity when the engine calls this. The
    // overlay is chrome in the canvas's backing store rather than in the game's
    // letterboxed logical coordinates, so it must not scale or translate itself —
    // which is what keeps debug text the same physical size whatever the camera is
    // doing to the world, and what makes it track the device pixel ratio for free.
    const diagnostics = withWindow([16, 16]);
    diagnostics.registerWorld("score", () => 3);
    const stub = overlay();

    diagnostics.draw(stub.ctx, 640, 360);

    expect(stub.names()).not.toContain("setTransform");
    expect(stub.names()).not.toContain("resetTransform");
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

  it("restores the context even when drawing throws", () => {
    const diagnostics = withSources({ score: 3 });
    const stub = overlay();
    // A lost or fake context can fail at any call; the game's style must come back
    // or the panel would silently restyle the next frame's drawing.
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

  it("sits in the top-left corner", () => {
    const diagnostics = withSources({ score: 3 });
    const stub = overlay();

    diagnostics.draw(stub.ctx, 640, 360);

    const panel = rects(stub)[0];
    expect(panel?.x).toBeGreaterThan(0);
    expect(panel?.x).toBeLessThan(320);
    expect(panel?.y).toBeGreaterThan(0);
    expect(panel?.y).toBeLessThan(180);
  });

  it("draws the panel translucent, under the text", () => {
    const diagnostics = withSources({ score: 3 });
    const stub = overlay();

    diagnostics.draw(stub.ctx, 640, 360);

    // The panel is filled before any text is drawn, so the game reads underneath
    // it rather than through it.
    const panelAt = stub.names().indexOf("fillRect");
    const textAt = stub.names().indexOf("fillText");
    expect(panelAt).toBeGreaterThanOrEqual(0);
    expect(panelAt).toBeLessThan(textAt);
    expect(rects(stub)[0]?.fill).toContain("rgba");
  });

  it("sizes its type to the surface height, with a floor for legibility", () => {
    // The height is in device pixels, so this follows the device pixel ratio for
    // free: the same canvas at twice the ratio draws the overlay twice as large.
    const tall = overlay();
    withSources({ score: 3 }).draw(tall.ctx, 1920, 1080);
    expect(tall.ctx.font).toContain(`${Math.round(1080 * 0.02)}px`);

    const short = overlay();
    withSources({ score: 3 }).draw(short.ctx, 320, 180);
    expect(short.ctx.font).toContain("11px");
  });

  it("leaves the registries, the window and the visibility as it found them", () => {
    // The overlay observes and draws: a build behaves identically with the panel
    // up and with it down.
    const { diagnostics } = diagnosticsWith(
      { level: "vault", phase: "playing", actors: 3 },
      counts(2, 4),
    );
    diagnostics.registerWorld("score", () => 3);
    diagnostics.recordFrame(16, 16);
    diagnostics.setEnabled(true);
    const stub = overlay();

    const readings = diagnostics.read();
    const metrics = diagnostics.metrics();
    diagnostics.draw(stub.ctx, 640, 360);

    expect(diagnostics.read()).toEqual(readings);
    expect(diagnostics.metrics()).toEqual(metrics);
    expect(diagnostics.enabled()).toBe(true);
  });
});

describe("Diagnostics.draw frame metrics", () => {
  it("draws the metrics line with no source registered at all", () => {
    // A build reports metrics without registering anything.
    const diagnostics = withWindow([8, 9, 40], counts(3, 900));

    const stub = overlay();
    diagnostics.draw(stub.ctx, 640, 360);

    expect(drawnLines(stub)).toEqual([
      // mean 19, p95 and p99 both the largest of three.
      "frame: 19 / 40 / 40 ms · 3 draws · 900 tris",
    ]);
  });

  it("draws an empty window and an undrawn renderer as zeroes", () => {
    const diagnostics = new Diagnostics();
    diagnostics.registerWorld("score", () => 3);
    diagnostics.setEnabled(true);
    const stub = overlay();

    diagnostics.draw(stub.ctx, 640, 360);

    expect(drawnLines(stub)).toEqual([
      "score: 3",
      "frame: 0 / 0 / 0 ms · 0 draws · 0 tris",
    ]);
    // The panel alone: no plot area and no bars behind it.
    expect(rects(stub)).toHaveLength(1);
  });

  it("reports the counts of the frame it is drawn over, not the ones it was built with", () => {
    // A validator watching the panel across frames reads the renderer's cost for
    // the picture under it, so the counts are pulled on each draw.
    const frames = [
      { calls: 3, triangles: 90 },
      { calls: 41, triangles: 22_000 },
    ];
    let frame = 0;
    const diagnostics = withWindow([16], {
      drawCalls: () => frames[frame]?.calls ?? 0,
      triangles: () => frames[frame]?.triangles ?? 0,
    });

    const first = overlay();
    diagnostics.draw(first.ctx, 640, 360);
    expect(drawnLines(first)).toEqual([
      "frame: 16 / 16 / 16 ms · 3 draws · 90 tris",
    ]);

    frame = 1;
    const second = overlay();
    diagnostics.draw(second.ctx, 640, 360);
    expect(drawnLines(second)).toEqual([
      "frame: 16 / 16 / 16 ms · 41 draws · 22000 tris",
    ]);
  });

  it("plots one column per sample, oldest at the left", () => {
    const diagnostics = withWindow([4, 40, 4, 4]);
    const stub = overlay();

    diagnostics.draw(stub.ctx, 640, 360);

    const drawn = bars(stub);
    expect(drawn).toHaveLength(4);
    expect(drawn.map((bar) => bar.x)).toEqual(
      [...drawn.map((bar) => bar.x)].sort((a, b) => a - b),
    );
    // The spike is the second sample, so it is the second column and the tallest.
    const heights = drawn.map((bar) => bar.h);
    expect(heights[1]).toBeGreaterThan(heights[0] ?? 0);
    expect(heights[1]).toBe(Math.max(...heights));
  });

  it("stands the graph beside the text, to its right", () => {
    const diagnostics = withWindow([16, 16]);
    diagnostics.registerWorld("score", () => 3);
    const stub = overlay();

    diagnostics.draw(stub.ctx, 640, 360);

    const panel = rects(stub)[0];
    const plot = plotArea(stub);
    expect(plot).toBeDefined();
    expect(plot && panel && plot.x > panel.x).toBe(true);
    // Beside, not below: the text keeps its place at the top of the panel.
    expect(plot && panel && plot.y).toBeLessThan(
      (panel?.y ?? 0) + (panel?.h ?? 0),
    );
  });

  it("scales to the tallest sample, which fills the plot area", () => {
    const diagnostics = withWindow([30, 90]);
    const stub = overlay();

    diagnostics.draw(stub.ctx, 640, 360);

    const drawn = bars(stub);
    const tallest = drawn[1];
    expect(tallest?.h).toBeGreaterThan(0);
    // 30 ms against a 90 ms ceiling is a third of the tallest bar.
    expect(drawn[0]?.h).toBeCloseTo((tallest?.h ?? 0) / 3, 5);
  });

  it("keeps an even run flat rather than amplifying it to full height", () => {
    const diagnostics = withWindow(new Array<number>(120).fill(16.7));
    const stub = overlay();

    diagnostics.draw(stub.ctx, 640, 360);

    const drawn = bars(stub);
    const plot = plotArea(stub);
    expect(plot).toBeDefined();
    // Half the 33.3 ms floor: a steady sixty-a-second run reads as a low, flat
    // band rather than as a wall of amplified noise.
    expect(drawn[0]?.h ?? 0).toBeCloseTo((plot?.h ?? 0) * (16.7 / 33.3), 5);
  });

  it("keeps every bar inside the panel, however long the window", () => {
    const diagnostics = withWindow(
      Array.from({ length: 2048 }, (_, i) => (i % 97) + 1),
    );
    const stub = overlay();

    diagnostics.draw(stub.ctx, 640, 360);

    const drawn = bars(stub);
    expect(drawn).toHaveLength(2048);
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
    const diagnostics = withWindow([
      16,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      16,
    ]);
    const stub = overlay();

    expect(() => diagnostics.draw(stub.ctx, 640, 360)).not.toThrow();
    for (const bar of bars(stub)) expect(Number.isFinite(bar.h)).toBe(true);
  });

  it("plots the window as it stands, holding no copy between draws", () => {
    const diagnostics = withWindow([10, 20, 30, 40]);

    const first = overlay();
    diagnostics.draw(first.ctx, 640, 360);
    expect(bars(first)).toHaveLength(4);

    // Ten seconds of simulated time later, all four are out of the window and one
    // new frame stands alone.
    diagnostics.recordFrame(20_000, 10);
    const second = overlay();
    diagnostics.draw(second.ctx, 640, 360);
    expect(bars(second)).toHaveLength(1);
  });
});

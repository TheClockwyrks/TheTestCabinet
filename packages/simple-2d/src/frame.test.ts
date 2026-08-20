import { describe, expect, it } from "vitest";
import type { Clock } from "./contract";
import { FrameLoop, type FrameCallbacks } from "./frame";

/**
 * A `requestAnimationFrame` the test drives by hand.
 *
 * Frames are queued rather than run inline: the loop re-arms after each frame, so a
 * rAF that called back synchronously would recurse forever — which is exactly what
 * a real browser does not do, and what the injected seam exists to model.
 */
function fakeRaf(): {
  raf: (cb: (t: number) => void) => number;
  cancel: (h: number) => void;
  tick: (t: number) => void;
  pending: () => number;
  scheduled: () => number;
} {
  const queued = new Map<number, (t: number) => void>();
  let nextHandle = 1;
  let scheduled = 0;
  return {
    raf: (cb) => {
      const handle = nextHandle++;
      scheduled += 1;
      queued.set(handle, cb);
      return handle;
    },
    cancel: (handle) => {
      queued.delete(handle);
    },
    tick: (t) => {
      const due = [...queued.values()];
      queued.clear();
      for (const cb of due) cb(t);
    },
    pending: () => queued.size,
    scheduled: () => scheduled,
  };
}

/** A clock delivering `stepsMs` in order and then cycling, ignoring the stamp. */
function sequence(stepsMs: number[]): Clock {
  let index = 0;
  return {
    delta: (): number => stepsMs[index++ % stepsMs.length] ?? 0,
  };
}

/** A clock every frame of which is worth `stepMs`. */
function constant(stepMs: number): Clock {
  return { delta: (): number => stepMs };
}

/**
 * A clock walking a pattern of deltas and refusals, so a declined tick can be
 * asserted on without reaching for the pacing rules that produce one in practice.
 */
function pattern(steps: Array<number | null>): Clock {
  let index = 0;
  return {
    delta: (): number | null => steps[index++ % steps.length] ?? null,
  };
}

/** A clock that records the stamps it was asked about and answers with `stepMs`. */
function stamping(stamps: number[], stepMs = 10): Clock {
  return {
    delta: (nowMs: number): number => {
      stamps.push(nowMs);
      return stepMs;
    },
  };
}

/** Callbacks that record the deltas they were handed and the order of the frame. */
function recorder(): { deltas: number[]; order: string[]; callbacks: FrameCallbacks } {
  const deltas: number[] = [];
  const order: string[] = [];
  return {
    deltas,
    order,
    callbacks: {
      update(dt: number): void {
        deltas.push(dt);
        order.push("update");
      },
      render(): void {
        order.push("render");
      },
    },
  };
}

describe("FrameLoop under run", () => {
  it("starts idle, with an empty window", () => {
    const loop = new FrameLoop({ clock: constant(10) });

    expect(loop.info()).toEqual({ count: 0, timeMs: 0, lastDeltaMs: 0 });
    expect(loop.metrics()).toEqual({ samples: 0, meanMs: 0, p95Ms: 0, p99Ms: 0 });
  });

  it("runs one frame per host callback, stepped by exactly what the clock said", () => {
    const raf = fakeRaf();
    const game = recorder();
    const loop = new FrameLoop({
      clock: sequence([10, 20, 30]),
      callbacks: game.callbacks,
      raf: raf.raf,
      cancel: raf.cancel,
    });

    void loop.run();
    raf.tick(1000);
    raf.tick(1016);
    raf.tick(1041);

    expect(game.deltas).toEqual([0.01, 0.02, 0.03]);
    expect(loop.info()).toEqual({ count: 3, timeMs: 60, lastDeltaMs: 30 });
  });

  it("keeps exactly one frame armed at a time", () => {
    const raf = fakeRaf();
    const loop = new FrameLoop({ clock: constant(10), raf: raf.raf, cancel: raf.cancel });

    void loop.run();
    expect(raf.pending()).toBe(1);

    raf.tick(16);
    expect(raf.pending()).toBe(1);
    expect(raf.scheduled()).toBe(2);
  });

  it("hands the clock the host's timestamp, and the wall clock when there is none", () => {
    const raf = fakeRaf();
    const stamps: number[] = [];
    let wall = 500;
    const loop = new FrameLoop({
      clock: stamping(stamps),
      raf: raf.raf,
      cancel: raf.cancel,
      now: () => wall,
    });

    void loop.run();
    raf.tick(1000);
    wall = 520;
    raf.tick(Number.NaN);

    expect(stamps).toEqual([1000, 520]);
  });

  it("runs no frame and moves no counter when the clock declines a tick", () => {
    const raf = fakeRaf();
    const game = recorder();
    const loop = new FrameLoop({
      clock: pattern([null, 20, null, null, 40]),
      callbacks: game.callbacks,
      raf: raf.raf,
      cancel: raf.cancel,
    });

    void loop.run();
    for (let i = 0; i < 5; i++) raf.tick(i * 16);

    expect(game.deltas).toEqual([0.02, 0.04]);
    expect(loop.info()).toEqual({ count: 2, timeMs: 60, lastDeltaMs: 40 });
    // A declined tick still re-arms; a clock that paces must not stall the pump.
    expect(raf.pending()).toBe(1);
    expect(loop.metrics().samples).toBe(2);
  });

  it("resolves the promise when the signal aborts, and stops running frames", async () => {
    const raf = fakeRaf();
    const game = recorder();
    const controller = new AbortController();
    const loop = new FrameLoop({
      clock: constant(10),
      callbacks: game.callbacks,
      raf: raf.raf,
      cancel: raf.cancel,
    });

    const finished = loop.run({ signal: controller.signal });
    raf.tick(0);
    controller.abort();
    await expect(finished).resolves.toBeUndefined();

    expect(raf.pending()).toBe(0);
    raf.tick(16);
    expect(game.deltas).toEqual([0.01]);
  });

  it("resolves without running a frame when the signal has already aborted", async () => {
    const raf = fakeRaf();
    const game = recorder();
    const loop = new FrameLoop({
      clock: constant(10),
      callbacks: game.callbacks,
      raf: raf.raf,
      cancel: raf.cancel,
    });

    await loop.run({ signal: AbortSignal.abort() });

    expect(raf.pending()).toBe(0);
    raf.tick(16);
    expect(game.deltas).toEqual([]);
    expect(loop.info().count).toBe(0);
  });

  it("resolves a second run against the same halt rather than pumping twice", async () => {
    const raf = fakeRaf();
    const game = recorder();
    const controller = new AbortController();
    const loop = new FrameLoop({
      clock: constant(10),
      callbacks: game.callbacks,
      raf: raf.raf,
      cancel: raf.cancel,
    });

    const first = loop.run();
    const second = loop.run({ signal: controller.signal });
    expect(second).toBe(first);

    raf.tick(0);
    // One pump, so one frame — two would double every delta the game integrates.
    expect(game.deltas).toEqual([0.01]);
    expect(raf.pending()).toBe(1);

    controller.abort();
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
  });

  it("halt resolves a run started without a signal, and can be called again", async () => {
    const raf = fakeRaf();
    const loop = new FrameLoop({ clock: constant(10), raf: raf.raf, cancel: raf.cancel });

    const finished = loop.run();
    loop.halt();
    loop.halt();
    await expect(finished).resolves.toBeUndefined();

    expect(raf.pending()).toBe(0);
  });

  it("halts from inside the game's own update", () => {
    const raf = fakeRaf();
    let updates = 0;
    const loop = new FrameLoop({
      clock: constant(10),
      raf: raf.raf,
      cancel: raf.cancel,
      callbacks: {
        update(): void {
          updates += 1;
          loop.halt();
        },
        render(): void {},
      },
    });

    void loop.run();
    raf.tick(16);

    expect(updates).toBe(1);
    expect(raf.pending()).toBe(0);
  });

  it("keeps running after a frame throws, so one bad frame does not freeze the game", () => {
    const raf = fakeRaf();
    let updates = 0;
    const loop = new FrameLoop({
      clock: constant(10),
      raf: raf.raf,
      cancel: raf.cancel,
      callbacks: {
        update(): void {
          updates += 1;
          if (updates === 1) throw new Error("bad frame");
        },
        render(): void {},
      },
    });

    void loop.run();
    expect(() => raf.tick(0)).toThrow("bad frame");
    expect(raf.pending()).toBe(1);

    raf.tick(16);
    expect(updates).toBe(2);
    expect(loop.info().count).toBe(2);
  });

  it("takes the next frame's delta from a clock installed mid-run, keeping the counters", () => {
    const raf = fakeRaf();
    const game = recorder();
    const loop = new FrameLoop({
      clock: constant(10),
      callbacks: game.callbacks,
      raf: raf.raf,
      cancel: raf.cancel,
    });

    void loop.run();
    raf.tick(0);
    loop.setClock(constant(25));
    raf.tick(16);

    expect(game.deltas).toEqual([0.01, 0.025]);
    expect(loop.info()).toEqual({ count: 2, timeMs: 35, lastDeltaMs: 25 });
  });
});

describe("FrameLoop.advance", () => {
  it("runs exactly the frames the clock accepts, synchronously and off no host callback", () => {
    const raf = fakeRaf();
    const game = recorder();
    const loop = new FrameLoop({
      clock: sequence([10, 20, 30]),
      callbacks: game.callbacks,
      raf: raf.raf,
      cancel: raf.cancel,
    });

    loop.advance(5);

    expect(game.deltas.map((dt) => Math.round(dt * 1000))).toEqual([10, 20, 30, 10, 20]);
    expect(loop.info()).toEqual({ count: 5, timeMs: 90, lastDeltaMs: 20 });
    expect(raf.scheduled()).toBe(0);
  });

  it("turns a declined tick into no frame at all", () => {
    const game = recorder();
    const loop = new FrameLoop({
      clock: pattern([25, null]),
      callbacks: game.callbacks,
      raf: fakeRaf().raf,
    });

    loop.advance(6);

    expect(game.deltas).toEqual([0.025, 0.025, 0.025]);
    expect(loop.info()).toEqual({ count: 3, timeMs: 75, lastDeltaMs: 25 });
  });

  it("advance(0) is a legal no-op", () => {
    const game = recorder();
    const loop = new FrameLoop({
      clock: constant(10),
      callbacks: game.callbacks,
      raf: fakeRaf().raf,
    });

    loop.advance(0);

    expect(game.deltas).toEqual([]);
    expect(loop.info().count).toBe(0);
  });

  it("rejects a frame count that is not a whole non-negative number, naming it", () => {
    const loop = new FrameLoop({ clock: constant(10), raf: fakeRaf().raf });

    for (const frames of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, -0.5]) {
      expect(() => loop.advance(frames)).toThrow(RangeError);
      expect(() => loop.advance(frames)).toThrow(String(frames));
    }
    expect(loop.info().count).toBe(0);
  });

  it("propagates a throw and abandons the frames after it", () => {
    let updates = 0;
    const loop = new FrameLoop({
      clock: constant(10),
      raf: fakeRaf().raf,
      callbacks: {
        update(): void {
          updates += 1;
          if (updates === 2) throw new Error("bad frame");
        },
        render(): void {},
      },
    });

    expect(() => loop.advance(4)).toThrow("bad frame");
    expect(updates).toBe(2);
    // The failing frame counted — it stepped the clock before it ran — and the two
    // behind it did not, which is the whole reason a counted step propagates.
    expect(loop.info().count).toBe(2);
  });

  it("steps the clock and the hooks with no callbacks registered at all", () => {
    let hooks = 0;
    const loop = new FrameLoop({ clock: constant(10), raf: fakeRaf().raf });

    loop.onFrame(() => {
      hooks += 1;
    });
    loop.advance(3);

    expect(hooks).toBe(3);
    expect(loop.info()).toEqual({ count: 3, timeMs: 30, lastDeltaMs: 10 });
  });
});

describe("FrameLoop frame composition", () => {
  it("runs update, then render, then every hook in registration order", () => {
    const game = recorder();
    const loop = new FrameLoop({
      clock: constant(10),
      callbacks: game.callbacks,
      raf: fakeRaf().raf,
    });

    loop.onFrame(() => game.order.push("hook-a"));
    loop.onFrame(() => game.order.push("hook-b"));
    loop.advance(2);

    expect(game.order).toEqual([
      "update",
      "render",
      "hook-a",
      "hook-b",
      "update",
      "render",
      "hook-a",
      "hook-b",
    ]);
  });

  it("renders into the context the engine supplies", () => {
    const surface = { id: "engine-context" } as unknown as CanvasRenderingContext2D;
    const seen: CanvasRenderingContext2D[] = [];
    const loop = new FrameLoop({
      clock: constant(10),
      raf: fakeRaf().raf,
      context: () => surface,
      callbacks: {
        update(): void {},
        render(ctx: CanvasRenderingContext2D): void {
          seen.push(ctx);
        },
      },
    });

    loop.advance(2);

    expect(seen).toEqual([surface, surface]);
  });
});

describe("FrameLoop metrics", () => {
  /**
   * A loop whose frames cost exactly what the test says.
   *
   * The wall clock only moves inside `update`, so the figure the window records is
   * the frame's own cost and nothing else — which is what makes every percentile
   * below an exact number rather than a tolerance around the machine's mood.
   */
  function timed(costsMs: number[], stepMs = 10): { loop: FrameLoop; frames: () => number } {
    let wall = 0;
    let frames = 0;
    const loop = new FrameLoop({
      clock: constant(stepMs),
      raf: fakeRaf().raf,
      now: () => wall,
      callbacks: {
        update(): void {
          wall += costsMs[frames % costsMs.length] ?? 0;
          frames += 1;
        },
        render(): void {},
      },
    });
    return { loop, frames: () => frames };
  }

  it("reports the mean and nearest-rank percentiles over the window", () => {
    const costs = Array.from({ length: 20 }, (_, i) => i + 1);
    const { loop } = timed(costs);

    loop.advance(20);

    const metrics = loop.metrics();
    expect(metrics.samples).toBe(20);
    expect(metrics.meanMs).toBeCloseTo(10.5, 9);
    // Nearest rank over 20 ascending samples: ceil(0.95 * 20) - 1 = 18, and
    // ceil(0.99 * 20) - 1 = 19.
    expect(metrics.p95Ms).toBe(19);
    expect(metrics.p99Ms).toBe(20);
  });

  it("reports a single frame's cost as all three figures", () => {
    const { loop } = timed([7]);

    loop.advance(1);

    expect(loop.metrics()).toEqual({ samples: 1, meanMs: 7, p95Ms: 7, p99Ms: 7 });
  });

  it("evicts by age, holding the last ten seconds of simulated time", () => {
    const { loop } = timed([1], 1000);

    loop.advance(15);

    // Frames land one simulated second apart, so the newest is at 15 000 ms and the
    // window keeps everything back to 5 000 ms: eleven of the fifteen.
    expect(loop.info().timeMs).toBe(15_000);
    expect(loop.metrics().samples).toBe(11);
  });

  it("evicts a sample the moment it falls out of the window", () => {
    const { loop } = timed([1], 4000);

    loop.advance(3);
    expect(loop.metrics().samples).toBe(3);

    // The fourth frame puts simulated time at 16 000 ms, which is 12 000 ms past the
    // first — outside the window, and dropped as this frame arrives.
    loop.advance(1);
    expect(loop.metrics().samples).toBe(3);
  });

  it("stays bounded by its capacity through a very long run", () => {
    const { loop } = timed([1, 2, 3], 1);

    // Ten simulated seconds is 10 000 frames at this step, far more than the ring
    // holds: the capacity, not the age rule, is what bounds the memory here.
    loop.advance(60_000);

    const metrics = loop.metrics();
    expect(loop.info().count).toBe(60_000);
    expect(metrics.samples).toBe(2048);
    expect(metrics.meanMs).toBeGreaterThan(0);
    expect(metrics.p99Ms).toBeLessThanOrEqual(3);
  });

  it("keeps the window empty while every tick is declined", () => {
    const loop = new FrameLoop({ clock: pattern([null]), raf: fakeRaf().raf });

    loop.advance(50);

    expect(loop.metrics()).toEqual({ samples: 0, meanMs: 0, p95Ms: 0, p99Ms: 0 });
  });
});

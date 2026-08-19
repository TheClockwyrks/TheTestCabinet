import { describe, expect, it } from "vitest";
import type { FrameCallbacks } from "./contract";
import { FrameLoop } from "./frame";

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

describe("FrameLoop under the auto clock", () => {
  it("starts idle", () => {
    const loop = new FrameLoop();
    expect(loop.clock()).toBe("auto");
    expect(loop.info()).toEqual({ count: 0, timeMs: 0, lastDeltaMs: 0 });
    expect(loop.schedule()).toEqual({ kind: "fixed", stepMs: 1000 / 120 });
  });

  it("advances one frame per rAF callback, in seconds of real elapsed time", () => {
    const clock = fakeRaf();
    const loop = new FrameLoop({ raf: clock.raf, cancel: clock.cancel });
    const game = recorder();

    loop.run(game.callbacks);
    clock.tick(1000);
    clock.tick(1016);
    clock.tick(1041);

    // The first frame has no baseline to measure against, so it steps by zero.
    expect(game.deltas).toEqual([0, 0.016, 0.025]);
    expect(loop.info()).toEqual({ count: 3, timeMs: 41, lastDeltaMs: 25 });
  });

  it("keeps exactly one frame armed at a time", () => {
    const clock = fakeRaf();
    const loop = new FrameLoop({ raf: clock.raf, cancel: clock.cancel });

    loop.run(recorder().callbacks);
    expect(clock.pending()).toBe(1);

    clock.tick(16);
    expect(clock.pending()).toBe(1);
    expect(clock.scheduled()).toBe(2);
  });

  it("clamps a backgrounded-tab gap to the delta ceiling", () => {
    const clock = fakeRaf();
    const loop = new FrameLoop({ raf: clock.raf, cancel: clock.cancel });
    const game = recorder();

    loop.run(game.callbacks);
    clock.tick(0);
    clock.tick(30_000);

    expect(game.deltas).toEqual([0, 0.1]);
    expect(loop.info().timeMs).toBe(100);
  });

  it("honours a custom ceiling and never rewinds on a non-monotonic timestamp", () => {
    const clock = fakeRaf();
    const loop = new FrameLoop({ raf: clock.raf, cancel: clock.cancel, maxDeltaMs: 40 });
    const game = recorder();

    loop.run(game.callbacks);
    clock.tick(1000);
    clock.tick(5000);
    clock.tick(4000);

    expect(game.deltas).toEqual([0, 0.04, 0]);
  });

  it("reads the clock directly when the host passes no timestamp", () => {
    const clock = fakeRaf();
    let wall = 500;
    const loop = new FrameLoop({ raf: clock.raf, cancel: clock.cancel, now: () => wall });
    const game = recorder();

    loop.run(game.callbacks);
    clock.tick(Number.NaN);
    wall = 520;
    clock.tick(Number.NaN);

    expect(game.deltas).toEqual([0, 0.02]);
  });

  it("stop halts the loop and cancels the armed frame", () => {
    const clock = fakeRaf();
    const loop = new FrameLoop({ raf: clock.raf, cancel: clock.cancel });
    const game = recorder();

    loop.run(game.callbacks);
    clock.tick(16);
    loop.stop();

    expect(clock.pending()).toBe(0);
    clock.tick(32);
    expect(loop.info().count).toBe(1);
    expect(game.deltas).toHaveLength(1);
  });

  it("stops when the game stops from inside its own update", () => {
    const clock = fakeRaf();
    const loop = new FrameLoop({ raf: clock.raf, cancel: clock.cancel });
    let updates = 0;

    loop.run({
      update(): void {
        updates += 1;
        loop.stop();
      },
      render(): void {},
    });
    clock.tick(16);

    expect(updates).toBe(1);
    expect(clock.pending()).toBe(0);
  });

  it("keeps running after a frame throws, so one bad frame does not freeze the game", () => {
    const clock = fakeRaf();
    const loop = new FrameLoop({ raf: clock.raf, cancel: clock.cancel });
    let updates = 0;

    loop.run({
      update(): void {
        updates += 1;
        if (updates === 1) throw new Error("bad frame");
      },
      render(): void {},
    });

    expect(() => clock.tick(0)).toThrow("bad frame");
    expect(clock.pending()).toBe(1);
    clock.tick(16);
    expect(updates).toBe(2);
  });

  it("refuses advance, because it would race the wall clock", () => {
    const loop = new FrameLoop({ raf: fakeRaf().raf });
    expect(() => loop.advance(1)).toThrow(/manual clock/);
    expect(loop.info().count).toBe(0);
  });
});

describe("FrameLoop under the manual clock", () => {
  it("never touches rAF", () => {
    const clock = fakeRaf();
    const loop = new FrameLoop({ raf: clock.raf, cancel: clock.cancel });

    loop.setClock("manual");
    loop.run(recorder().callbacks);
    loop.advance(4);

    expect(clock.scheduled()).toBe(0);
    expect(loop.clock()).toBe("manual");
    expect(loop.info().count).toBe(4);
  });

  it("runs exactly N frames synchronously off a fixed schedule", () => {
    const loop = new FrameLoop({ raf: fakeRaf().raf });
    const game = recorder();

    loop.setClock("manual");
    loop.setSchedule({ kind: "fixed", stepMs: 10 });
    loop.run(game.callbacks);
    loop.advance(3);

    expect(game.deltas).toEqual([0.01, 0.01, 0.01]);
    expect(loop.info()).toEqual({ count: 3, timeMs: 30, lastDeltaMs: 10 });
  });

  it("walks and then cycles a sequence schedule", () => {
    const loop = new FrameLoop({ raf: fakeRaf().raf });
    const game = recorder();

    loop.setClock("manual");
    loop.setSchedule({ kind: "sequence", stepsMs: [10, 20, 30] });
    loop.run(game.callbacks);
    loop.advance(5);

    expect(game.deltas.map((dt) => Math.round(dt * 1000))).toEqual([10, 20, 30, 10, 20]);
    expect(loop.info().timeMs).toBeCloseTo(90, 9);
  });

  it("restarts the pattern when a schedule is installed", () => {
    const loop = new FrameLoop({ raf: fakeRaf().raf });
    const game = recorder();

    loop.setClock("manual");
    loop.setSchedule({ kind: "sequence", stepsMs: [10, 20] });
    loop.run(game.callbacks);
    loop.advance(1);
    loop.setSchedule({ kind: "sequence", stepsMs: [10, 20] });
    loop.advance(1);

    expect(game.deltas).toEqual([0.01, 0.01]);
  });

  it("does not clamp a deliberately long scheduled step", () => {
    const loop = new FrameLoop({ raf: fakeRaf().raf, maxDeltaMs: 50 });
    const game = recorder();

    loop.setClock("manual");
    loop.setSchedule({ kind: "fixed", stepMs: 500 });
    loop.run(game.callbacks);
    loop.advance(1);

    expect(game.deltas).toEqual([0.5]);
  });

  it("replays a seeded jitter schedule exactly, inside its bounds", () => {
    const play = (seed: number): number[] => {
      const loop = new FrameLoop({ raf: fakeRaf().raf });
      const game = recorder();
      loop.setClock("manual");
      loop.setSchedule({ kind: "jitter", minMs: 5, maxMs: 25, seed });
      loop.run(game.callbacks);
      loop.advance(12);
      return game.deltas;
    };

    const first = play(7);
    expect(play(7)).toEqual(first);
    for (const dt of first) {
      expect(dt).toBeGreaterThanOrEqual(0.005);
      expect(dt).toBeLessThan(0.025);
    }
    // A jittered clock that produced one repeated value would not be jitter at all.
    expect(new Set(first).size).toBeGreaterThan(1);
    expect(play(8)).not.toEqual(first);
  });

  it("advance(0) is a legal no-op", () => {
    const loop = new FrameLoop({ raf: fakeRaf().raf });
    const game = recorder();

    loop.setClock("manual");
    loop.run(game.callbacks);
    loop.advance(0);

    expect(game.deltas).toEqual([]);
    expect(loop.info().count).toBe(0);
  });

  it("rejects a step count that is not a whole non-negative number", () => {
    const loop = new FrameLoop({ raf: fakeRaf().raf });
    loop.setClock("manual");
    loop.run(recorder().callbacks);

    for (const steps of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => loop.advance(steps)).toThrow(RangeError);
    }
    expect(loop.info().count).toBe(0);
  });

  it("rejects a schedule that cannot produce a step", () => {
    const loop = new FrameLoop({ raf: fakeRaf().raf });

    expect(() => loop.setSchedule({ kind: "sequence", stepsMs: [] })).toThrow(RangeError);
    expect(() => loop.setSchedule({ kind: "jitter", minMs: 20, maxMs: 5, seed: 1 })).toThrow(
      RangeError,
    );
    expect(loop.schedule()).toEqual({ kind: "fixed", stepMs: 1000 / 120 });
  });

  it("hands back a copy of the schedule, so a driver cannot mutate the live one", () => {
    const loop = new FrameLoop({ raf: fakeRaf().raf });
    const game = recorder();

    loop.setClock("manual");
    loop.setSchedule({ kind: "sequence", stepsMs: [10, 20] });
    const read = loop.schedule();
    if (read.kind === "sequence") read.stepsMs[0] = 999;
    loop.run(game.callbacks);
    loop.advance(1);

    expect(game.deltas).toEqual([0.01]);
  });
});

describe("FrameLoop clock switching", () => {
  it("keeps the frame count monotonic across a switch, losing no frame", () => {
    const clock = fakeRaf();
    const loop = new FrameLoop({ raf: clock.raf, cancel: clock.cancel });
    const game = recorder();

    loop.run(game.callbacks);
    clock.tick(0);
    clock.tick(16);
    expect(loop.info().count).toBe(2);

    loop.setClock("manual");
    expect(clock.pending()).toBe(0);
    loop.setSchedule({ kind: "fixed", stepMs: 8 });
    loop.advance(2);
    expect(loop.info().count).toBe(4);

    loop.setClock("auto");
    expect(clock.pending()).toBe(1);
    clock.tick(60_000);
    expect(loop.info().count).toBe(5);
  });

  it("does not charge the game for wall time that passed under the manual clock", () => {
    const clock = fakeRaf();
    const loop = new FrameLoop({ raf: clock.raf, cancel: clock.cancel });
    const game = recorder();

    loop.run(game.callbacks);
    clock.tick(1000);
    loop.setClock("manual");
    loop.setSchedule({ kind: "fixed", stepMs: 8 });
    loop.advance(1);
    loop.setClock("auto");
    // A minute of wall time elapsed while the driver stepped; the first auto frame
    // back re-baselines instead of replaying it (even clamped, it would be a jump).
    clock.tick(61_000);
    clock.tick(61_016);

    expect(game.deltas).toEqual([0, 0.008, 0, 0.016]);
  });

  it("does not arm a frame when switching to auto before the game has run", () => {
    const clock = fakeRaf();
    const loop = new FrameLoop({ raf: clock.raf, cancel: clock.cancel });

    loop.setClock("manual");
    loop.setClock("auto");

    expect(clock.scheduled()).toBe(0);
  });
});

describe("FrameLoop frame composition", () => {
  it("runs update, then render, then every hook in registration order", () => {
    const loop = new FrameLoop({ raf: fakeRaf().raf });
    const game = recorder();

    loop.onFrame(() => game.order.push("hook-a"));
    loop.onFrame(() => game.order.push("hook-b"));
    loop.setClock("manual");
    loop.run(game.callbacks);
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
    const loop = new FrameLoop({ raf: fakeRaf().raf, context: () => surface });

    loop.setClock("manual");
    loop.run({
      update(): void {},
      render(ctx: CanvasRenderingContext2D): void {
        seen.push(ctx);
      },
    });
    loop.advance(2);

    expect(seen).toEqual([surface, surface]);
  });

  it("steps the clock and the hooks even before the game has registered callbacks", () => {
    const loop = new FrameLoop({ raf: fakeRaf().raf });
    let hooks = 0;

    loop.onFrame(() => {
      hooks += 1;
    });
    loop.setClock("manual");
    loop.setSchedule({ kind: "fixed", stepMs: 10 });
    loop.advance(3);

    expect(hooks).toBe(3);
    expect(loop.info()).toEqual({ count: 3, timeMs: 30, lastDeltaMs: 10 });
  });

  it("swaps callbacks on a second run without arming a second frame", () => {
    const clock = fakeRaf();
    const loop = new FrameLoop({ raf: clock.raf, cancel: clock.cancel });
    const first = recorder();
    const second = recorder();

    loop.run(first.callbacks);
    clock.tick(0);
    loop.run(second.callbacks);
    clock.tick(16);

    expect(clock.pending()).toBe(1);
    expect(first.deltas).toEqual([0]);
    expect(second.deltas).toEqual([0.016]);
  });
});

import { describe, expect, it, vi } from "vitest";
import { ConstantClock, SequenceClock } from "./clocks";
import type { Clock } from "./contract";
import type { FrameCallbacks, FrameLoopOptions } from "./frame";
import { FrameLoop } from "./frame";

/**
 * Unit tests over the loop alone, with no engine, no canvas and no game behind it.
 *
 * What the loop decides is small and entirely testable in isolation: when a tick
 * becomes a frame, what the counters do on either answer, the order the two
 * callbacks and the after-frame hooks run in, how a run halts and what that resolves,
 * and the window it summarizes its own frame times over. Everything else a frame does
 * belongs to the engine's wiring and is asserted there, against a real engine —
 * `engine.test.ts` is where "the recorder captures before the overlay draws" lives,
 * because that is a fact about the wiring rather than about the loop.
 *
 * The host is supplied rather than stubbed globally: `raf`, `cancel`, and `now` are
 * all injectable, so a test drives the pump by hand and reads frame *costs* off a
 * clock it moves itself. Nothing here waits for real time to pass.
 */

/** A host whose frame callbacks queue until a test releases them. */
function fakeHost(): {
  raf: (cb: (t: number) => void) => number;
  cancel: (h: number) => void;
  tick: (t: number) => void;
  pending: () => number;
  cancelled: () => number;
} {
  const queued = new Map<number, (t: number) => void>();
  let next = 1;
  let cancelled = 0;
  return {
    raf: (cb) => {
      const handle = next++;
      queued.set(handle, cb);
      return handle;
    },
    cancel: (handle) => {
      cancelled += 1;
      queued.delete(handle);
    },
    tick: (t) => {
      const due = [...queued.values()];
      queued.clear();
      for (const cb of due) cb(t);
    },
    pending: () => queued.size,
    cancelled: () => cancelled,
  };
}

/** A wall clock a test moves by hand, for reading frame costs off. */
function fakeNow(): { now: () => number; advance: (ms: number) => void } {
  let at = 0;
  return {
    now: () => at,
    advance: (ms) => {
      at += ms;
    },
  };
}

/** A loop with a log of everything it drove, and the host it was driven through. */
function build(
  options: Partial<FrameLoopOptions> = {},
): {
  loop: FrameLoop;
  log: string[];
  host: ReturnType<typeof fakeHost>;
  clock: { now: () => number; advance: (ms: number) => void };
} {
  const host = fakeHost();
  const clock = fakeNow();
  const log: string[] = [];
  const callbacks: FrameCallbacks = {
    update: (dt) => log.push(`update:${dt}`),
    render: () => log.push("render"),
  };
  const loop = new FrameLoop({
    clock: options.clock ?? new ConstantClock(1000 / 60),
    callbacks: options.callbacks ?? callbacks,
    raf: options.raf ?? host.raf,
    cancel: options.cancel ?? host.cancel,
    now: options.now ?? clock.now,
  });
  return { loop, log, host, clock };
}

describe("advance", () => {
  it("runs update then render once per tick, with the delta in seconds", () => {
    const { loop, log } = build({ clock: new ConstantClock(20) });

    loop.advance(2);

    expect(log).toEqual(["update:0.02", "render", "update:0.02", "render"]);
    expect(loop.info()).toEqual({ count: 2, timeMs: 40, lastDeltaMs: 20 });
  });

  it("runs nothing for a count of zero", () => {
    const { loop, log } = build();

    loop.advance(0);

    expect(log).toEqual([]);
    expect(loop.info().count).toBe(0);
  });

  it("needs no host callback between frames, so nothing is scheduled", () => {
    const { loop, host } = build();

    loop.advance(10);

    expect(loop.info().count).toBe(10);
    expect(host.pending()).toBe(0);
  });

  it("refuses a count that is not a whole, non-negative number, naming it", () => {
    const { loop } = build();

    for (const frames of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => loop.advance(frames)).toThrow(RangeError);
      expect(() => loop.advance(frames)).toThrow(new RegExp(String(frames)));
    }
    expect(loop.info().count).toBe(0);
  });

  it("lets a throw out, abandoning the frames after it", () => {
    const cause = new Error("bad frame");
    const { loop } = build({
      callbacks: {
        update: (): void => {
          if (loop.info().count === 2) throw cause;
        },
        render: (): void => {},
      },
    });

    expect(() => loop.advance(5)).toThrow(cause);

    // The failing frame counted — it happened — and the three after it did not run.
    expect(loop.info().count).toBe(2);
  });

  it("takes each frame's delta from the clock in force", () => {
    const { loop } = build({ clock: new SequenceClock([8, 32]) });

    loop.advance(3);
    expect(loop.info().timeMs).toBe(48);

    // Replaced in place: the counters carry over, and the next frame takes the new
    // clock's delta.
    loop.setClock(new ConstantClock(100));
    loop.advance(1);

    expect(loop.info()).toEqual({ count: 4, timeMs: 148, lastDeltaMs: 100 });
  });
});

describe("a declined tick", () => {
  /** A clock that accepts every other tick, as a paced one does under a fast host. */
  function everyOther(stepMs: number): Clock {
    let ticks = 0;
    return {
      delta: (): number | null => (ticks++ % 2 === 0 ? stepMs : null),
    };
  }

  it("is not a frame: nothing runs and no counter moves", () => {
    const { loop, log } = build({ clock: everyOther(16) });

    loop.advance(4);

    expect(log).toEqual([
      "update:0.016",
      "render",
      "update:0.016",
      "render",
    ]);
    expect(loop.info()).toEqual({ count: 2, timeMs: 32, lastDeltaMs: 16 });
  });

  it("records no sample, so the window describes frames rather than ticks", () => {
    const { loop } = build({ clock: everyOther(16) });

    loop.advance(6);

    expect(loop.metrics().samples).toBe(3);
  });

  it("still re-arms the pump, so pacing catches up on a later tick", () => {
    const { loop, host } = build({ clock: everyOther(16) });
    void loop.run();

    host.tick(16);
    expect(loop.info().count).toBe(1);
    host.tick(32);
    expect(loop.info().count).toBe(1);
    host.tick(48);

    expect(loop.info().count).toBe(2);
    loop.halt();
  });
});

describe("run", () => {
  it("drives one frame per host callback", () => {
    const { loop, host } = build({ clock: new ConstantClock(16) });

    void loop.run();
    host.tick(16);
    host.tick(32);

    expect(loop.info().count).toBe(2);
    loop.halt();
  });

  it("resolves when the signal aborts, and schedules nothing after", async () => {
    const { loop, host } = build();
    const controller = new AbortController();

    const running = loop.run({ signal: controller.signal });
    host.tick(16);
    controller.abort();

    await expect(running).resolves.toBeUndefined();
    expect(host.pending()).toBe(0);
    host.tick(32);
    expect(loop.info().count).toBe(1);
  });

  it("resolves immediately for a signal that has already aborted", async () => {
    const { loop, host } = build();

    await expect(
      loop.run({ signal: AbortSignal.abort() }),
    ).resolves.toBeUndefined();

    // Watched after arming, so the pump the run started is halted rather than left
    // running behind a resolved promise.
    expect(host.pending()).toBe(0);
    expect(loop.info().count).toBe(0);
  });

  it("hands a second caller the same halt rather than starting a second pump", async () => {
    const { loop, host } = build();

    const first = loop.run();
    const second = loop.run();
    host.tick(16);

    // One pump, one frame: two pumps over one clock would double every frame.
    expect(loop.info().count).toBe(1);
    expect(first).toBe(second);

    loop.halt();
    await expect(Promise.all([first, second])).resolves.toEqual([
      undefined,
      undefined,
    ]);
  });

  it("halts on any waiting caller's signal", async () => {
    const { loop } = build();
    const controller = new AbortController();

    const first = loop.run();
    const second = loop.run({ signal: controller.signal });
    controller.abort();

    await expect(Promise.all([first, second])).resolves.toEqual([
      undefined,
      undefined,
    ]);
  });

  it("drops the listener it armed, so an abort after a halt costs nothing", async () => {
    const { loop } = build();
    const controller = new AbortController();
    const removed = vi.spyOn(controller.signal, "removeEventListener");

    const running = loop.run({ signal: controller.signal });
    loop.halt();
    await running;

    expect(removed).toHaveBeenCalledWith("abort", expect.any(Function));
    controller.abort();
    expect(loop.info().count).toBe(0);
  });

  it("cancels the frame it had scheduled when it halts", () => {
    const { loop, host } = build();

    void loop.run();
    expect(host.pending()).toBe(1);
    loop.halt();

    expect(host.cancelled()).toBe(1);
    expect(host.pending()).toBe(0);
  });

  it("is idempotent to halt, because teardown races the signal it is racing", async () => {
    const { loop } = build();
    const running = loop.run();

    loop.halt();
    expect(() => {
      loop.halt();
      loop.halt();
    }).not.toThrow();
    await expect(running).resolves.toBeUndefined();
  });

  it("keeps pumping after a frame throws, so one bad frame is not fatal", () => {
    const { loop, host } = build({
      callbacks: {
        update: (): void => {
          if (loop.info().count === 1) throw new Error("one bad frame");
        },
        render: (): void => {},
      },
    });
    void loop.run();

    expect(() => host.tick(16)).toThrow(/one bad frame/);
    // Re-armed in a `finally`, so the throw surfaces where it is visible without
    // freezing the game on the frame that produced it.
    expect(host.pending()).toBe(1);
    host.tick(32);
    expect(loop.info().count).toBe(2);
    loop.halt();
  });

  it("stops on a halt performed from inside a frame", () => {
    const { loop, host } = build();
    loop.onFrame(() => {
      if (loop.info().count === 2) loop.halt();
    });

    void loop.run();
    host.tick(16);
    host.tick(32);

    expect(host.pending()).toBe(0);
    host.tick(48);
    expect(loop.info().count).toBe(2);
  });

  it("prefers the host's frame timestamp, falling back when it passes none", () => {
    const stamps: number[] = [];
    const recording: Clock = {
      delta: (nowMs: number): number => {
        stamps.push(nowMs);
        return 16;
      },
    };
    const { loop, host, clock } = build({ clock: recording });
    clock.advance(500);

    void loop.run();
    host.tick(1234);
    host.tick(Number.NaN);

    // The host's stamp is the time the frame is *for*; a host that passes nothing
    // usable leaves the loop reading its own clock.
    expect(stamps).toEqual([1234, 500]);
    loop.halt();
  });
});

describe("the after-frame hooks", () => {
  it("run in registration order, after render", () => {
    const { loop, log } = build({ clock: new ConstantClock(16) });
    loop.onFrame(() => log.push("hook:first"));
    loop.onFrame(() => log.push("hook:second"));

    loop.advance(1);

    expect(log).toEqual([
      "update:0.016",
      "render",
      "hook:first",
      "hook:second",
    ]);
  });

  it("run on a frame with no callbacks at all", () => {
    const host = fakeHost();
    const loop = new FrameLoop({
      clock: new ConstantClock(16),
      raf: host.raf,
      cancel: host.cancel,
      now: () => 0,
    });
    let hooks = 0;
    loop.onFrame(() => {
      hooks += 1;
    });

    loop.advance(3);

    // A loop with no game still steps the clock and moves the counters, which is
    // what lets it be exercised with no drawing surface behind it.
    expect(hooks).toBe(3);
    expect(loop.info().count).toBe(3);
  });

  it("do not run for a frame whose update threw", () => {
    const { loop } = build({
      callbacks: {
        update: (): void => {
          throw new Error("bad frame");
        },
        render: (): void => {},
      },
    });
    let hooks = 0;
    loop.onFrame(() => {
      hooks += 1;
    });

    expect(() => loop.advance(1)).toThrow(/bad frame/);

    expect(hooks).toBe(0);
  });
});

describe("frame timing", () => {
  it("reports an empty window before anything has run", () => {
    const { loop } = build();

    expect(loop.metrics()).toEqual({
      samples: 0,
      meanMs: 0,
      p95Ms: 0,
      p99Ms: 0,
    });
    expect(loop.series()).toEqual([]);
  });

  it("times the whole frame, callbacks and hooks alike", () => {
    const clock = fakeNow();
    const loop = new FrameLoop({
      clock: new ConstantClock(16),
      callbacks: {
        update: (): void => clock.advance(3),
        render: (): void => clock.advance(4),
      },
      now: clock.now,
    });
    loop.onFrame(() => clock.advance(2));

    loop.advance(1);

    // The overlay reports what a frame cost, and a frame costs the update, the
    // render, and everything the engine does after them — which for an engine is
    // the scene render, the recorder, and the overlay itself.
    expect(loop.metrics().meanMs).toBe(9);
    expect([...loop.series()]).toEqual([9]);
  });

  it("records the cost of a frame that threw", () => {
    const clock = fakeNow();
    const loop = new FrameLoop({
      clock: new ConstantClock(16),
      callbacks: {
        update: (): void => {
          clock.advance(7);
          throw new Error("bad frame");
        },
        render: (): void => {},
      },
      now: clock.now,
    });

    expect(() => loop.advance(1)).toThrow(/bad frame/);

    // A build failing every frame is exactly the one whose frame times a reader
    // wants; dropping the sample would report an empty window instead.
    expect(loop.metrics()).toMatchObject({ samples: 1, meanMs: 7 });
  });

  it("takes percentiles by nearest rank, so every figure is a frame that happened", () => {
    const clock = fakeNow();
    let cost = 1;
    const loop = new FrameLoop({
      clock: new ConstantClock(1),
      callbacks: {
        update: (): void => clock.advance(cost++),
        render: (): void => {},
      },
      now: clock.now,
    });

    loop.advance(100);

    const metrics = loop.metrics();
    expect(metrics.samples).toBe(100);
    expect(metrics.meanMs).toBe(50.5);
    // `ceil(0.95 * 100) - 1` is index 94 of the ascending costs 1..100.
    expect(metrics.p95Ms).toBe(95);
    expect(metrics.p99Ms).toBe(99);
  });

  it("drops samples older than the window, measured in simulated time", () => {
    const clock = fakeNow();
    const loop = new FrameLoop({
      clock: new ConstantClock(1000),
      callbacks: {
        update: (): void => clock.advance(1),
        render: (): void => {},
      },
      now: clock.now,
    });

    // A second of simulated time per frame: after fifteen frames the window's ten
    // seconds hold only the most recent eleven.
    loop.advance(15);

    expect(loop.info().timeMs).toBe(15_000);
    expect(loop.metrics().samples).toBe(11);
  });

  it("holds a fixed number of samples however many frames run", () => {
    const clock = fakeNow();
    const loop = new FrameLoop({
      // A twentieth of a millisecond per frame, so nothing ages out of a ten-second
      // window and the capacity is the only rule left standing.
      clock: new ConstantClock(0.05),
      callbacks: {
        update: (): void => clock.advance(1),
        render: (): void => {},
      },
      now: clock.now,
    });

    loop.advance(3000);

    // Capacity is what makes the memory flat: a build running fast for a long time
    // costs exactly what a slow short one does.
    expect(loop.info().count).toBe(3000);
    expect(loop.metrics().samples).toBe(2048);
    expect(loop.series()).toHaveLength(2048);
  });

  it("hands back the window's own buffer, oldest first, refilled on each call", () => {
    const clock = fakeNow();
    let cost = 1;
    const loop = new FrameLoop({
      clock: new ConstantClock(1),
      callbacks: {
        update: (): void => clock.advance(cost++),
        render: (): void => {},
      },
      now: clock.now,
    });

    loop.advance(3);
    const first = loop.series();
    expect([...first]).toEqual([1, 2, 3]);

    loop.advance(1);

    // The same array, refilled — the picture is redrawn from the live window every
    // frame it is visible, so a caller that means to keep a sample copies it out.
    expect(loop.series()).toBe(first);
    expect([...loop.series()]).toEqual([1, 2, 3, 4]);
  });
});

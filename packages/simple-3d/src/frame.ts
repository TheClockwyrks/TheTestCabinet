/**
 * The frame loop: what turns a clock's ticks into the game's frames.
 *
 * The loop itself decides almost nothing. It does not accumulate, does not fix
 * the step, and does not decide how much time a frame is worth — that is entirely
 * the {@link Clock}'s answer, and the loop's job is to ask once per tick and then
 * carry out whatever it is told. A game that wants a fixed timestep builds one on
 * top of the delta it is handed, and one that integrates directly against `dt` is
 * equally welcome.
 *
 * Two entry points drive it, and the difference between them is *where the ticks
 * come from*, never what a tick means:
 *
 * - {@link FrameLoop.run} pumps off the host's frame callback, one tick per
 *   callback, until the caller's signal aborts or the loop is halted.
 * - {@link FrameLoop.advance} ticks the clock a counted number of times back to
 *   back, with no host callback in between.
 *
 * Because a clock that ignores `nowMs` produces the same deltas either way, the
 * sequence a validator steps through synchronously is the sequence a reviewer
 * watches play. That is the whole reason the clock is a seam rather than a
 * `requestAnimationFrame` timestamp subtraction inlined here: `advance(120)` is
 * 120 frames with 120 chosen deltas, whatever the host machine's frame rate, so a
 * check counting ticks never has to sleep, poll, or tolerate a slow CI runner.
 *
 * A tick may be *declined*. A clock returning `null` says "this tick is not a
 * frame", and the loop then does nothing at all — no update, no render, no
 * counter movement — beyond re-arming. That is how a paced clock runs below the
 * rate its ticks arrive at without the loop knowing anything about pacing.
 *
 * The loop also measures itself, and it does so within a fixed memory budget: the
 * frame-time window is the diagnostics module's {@link SampleWindow}, a ring
 * evicted by age as well as by capacity, so a run of any length at any frame rate
 * holds the same number of bytes. Nothing else here grows with the length of a run.
 *
 * That window is borrowed rather than re-implemented here. Its ten-second span, its
 * 2048-sample ceiling, and its nearest-rank percentiles are fixed by
 * `apis/diagnostics.md` — they are the overlay's specification rather than the
 * loop's — so the class lives beside that page's other rules and the loop only
 * records into it. It also leaves the package with exactly one
 * {@link FrameMetrics}, which is the type the root exports.
 */

import type { Clock } from "./clocks";
import type { FrameMetrics } from "./diagnostics";
import { SampleWindow } from "./diagnostics";

/**
 * Where the loop has got to: the frame counter, the accumulated simulated time,
 * and the most recent delta — the value `engine.frame()` and `api.frame()` hand
 * a caller.
 *
 * Defined beside the loop that owns the figures rather than in `contract.ts`,
 * because that module is the shared recording-format contract carried
 * byte-identical across the engine packages; a `RecordedFrame` carries these
 * same figures, but as its own fields, not as this type.
 */
export interface FrameInfo {
  /** Frames run since the loop started. */
  count: number;
  /** Accumulated simulated time: the sum of the deltas delivered, in milliseconds. */
  timeMs: number;
  /** What the most recent frame was worth, in milliseconds. */
  lastDeltaMs: number;
}

/** How a `run` is halted from outside: abort the signal, and the loop resolves. */
export interface RunOptions {
  /** Aborting this signal halts the loop and resolves every waiting `run`. */
  signal?: AbortSignal;
}

/**
 * The two functions the loop drives, as the engine wires them up.
 *
 * `render` takes nothing, where the 2D engines hand theirs a drawing context:
 * a 3D frame draws through the engine-owned scene context, whose identity is
 * stable for the engine's whole life, so the engine's wrapper closes over it
 * and the loop stays ignorant of what a frame draws with.
 */
export interface FrameCallbacks {
  /** Advance the simulation by `dt` seconds. */
  update(dt: number): void;
  /** Draw the state the update left behind, through the engine's scene context. */
  render(): void;
}

/** How the loop is wired to its host — every part injectable, so it is testable. */
export interface FrameLoopOptions {
  /**
   * The clock every tick's delta comes from.
   *
   * Required, and deliberately so: the loop has no opinion about what a frame is
   * worth, and inventing a default here would put a second answer to that question
   * in the package next to the engine's own documented default.
   */
  clock: Clock;
  /**
   * The game's update and render, as the engine wraps them.
   *
   * Optional because a loop with none still runs: it steps the clock, moves the
   * counters, and runs the engine's own per-frame hooks. That is what lets the
   * loop be exercised with no game and no drawing surface behind it.
   */
  callbacks?: FrameCallbacks;
  /** Schedules the next frame; defaults to `requestAnimationFrame`. */
  raf?: (cb: (t: number) => void) => number;
  /** Cancels a scheduled frame; defaults to `cancelAnimationFrame`. */
  cancel?: (h: number) => void;
  /** Reads the wall clock, for the tick stamp and for frame timing. */
  now?: () => number;
}

/** `true` for a whole, non-negative, finite count of frames. */
function isFrameCount(frames: number): boolean {
  return Number.isInteger(frames) && frames >= 0;
}

/** Whether this host has a real `requestAnimationFrame` to pump against. */
function hasRaf(): boolean {
  return typeof globalThis.requestAnimationFrame === "function";
}

/** The engine's frame loop: the host pump, the stepper, and the bookkeeping. */
export class FrameLoop {
  private readonly rafFn: (cb: (t: number) => void) => number;
  private readonly cancelFn: (h: number) => void;
  private readonly nowFn: () => number;
  private readonly callbacks: FrameCallbacks | null;
  private readonly hooks: Array<() => void> = [];
  private readonly samples = new SampleWindow();

  private currentClock: Clock;

  private running = false;
  private handle: number | null = null;

  /**
   * The promise every live `run` call shares, and the function that settles it.
   *
   * One promise rather than one per call: a second `run` while the loop is already
   * running is a caller asking to wait for the halt, not to start a second pump,
   * and two pumps over one clock would double every frame.
   */
  private pendingRun: Promise<void> | null = null;
  private settleRun: (() => void) | null = null;

  /**
   * How each watched signal is unwatched again.
   *
   * Held so a halt drops every listener it armed. The set is emptied on every halt,
   * so it is bounded by the callers currently waiting on a run rather than by
   * anything the run itself produces.
   */
  private readonly unwatch = new Set<() => void>();

  private frameCount = 0;
  private accumulatedMs = 0;
  private lastDeltaMs = 0;

  constructor(options: FrameLoopOptions) {
    this.currentClock = options.clock;
    this.callbacks = options.callbacks ?? null;
    this.nowFn = options.now ?? ((): number => performance.now());
    // Defaults are captured once, but chosen so a host with no rAF (a plain Node
    // process running the validator suite over a headless canvas) still runs
    // rather than crashing.
    this.rafFn =
      options.raf ??
      ((cb) =>
        hasRaf()
          ? globalThis.requestAnimationFrame(cb)
          : (setTimeout(() => cb(this.nowFn()), 16) as unknown as number));
    this.cancelFn =
      options.cancel ??
      ((h) => {
        if (hasRaf()) globalThis.cancelAnimationFrame(h);
        else clearTimeout(h);
      });
  }

  /**
   * Replace the clock in place. The next tick takes its delta from the new one.
   *
   * The counters carry over deliberately: the frame count and the accumulated time
   * describe the run, not the clock, and resetting them on a swap would make "how
   * far has this game got" depend on how many times the driver changed its mind.
   */
  setClock(clock: Clock): void {
    this.currentClock = clock;
  }

  /**
   * Pump frames off the host's frame callback until the loop halts.
   *
   * The returned promise resolves when `options.signal` aborts or when
   * {@link halt} is called, which is what lets a game end itself: it aborts a
   * controller it built in its own `initialize`, and the caller awaiting `run`
   * proceeds. Calling `run` while the loop is already running hands back the same
   * promise — every caller waits on the same halt, and every signal any of them
   * supplied can cause it.
   */
  run(options: RunOptions = {}): Promise<void> {
    const promise =
      this.pendingRun ??
      new Promise<void>((resolve) => {
        this.settleRun = resolve;
      });
    this.pendingRun = promise;

    if (!this.running) {
      this.running = true;
      this.armFrame();
    }

    // Watched *after* arming, so a signal that has already aborted halts the loop it
    // just started rather than leaving a pump running behind a resolved promise.
    if (options.signal) this.watch(options.signal);

    return promise;
  }

  /**
   * Halt the loop, drop any frame already scheduled, and resolve every waiting
   * `run`. Idempotent, because teardown races with the signal it is racing.
   */
  halt(): void {
    this.running = false;
    this.cancelPending();

    for (const remove of this.unwatch) remove();
    this.unwatch.clear();

    const settle = this.settleRun;
    this.settleRun = null;
    this.pendingRun = null;
    settle?.();
  }

  /**
   * Tick the clock `frames` times, back to back, running a frame for each tick the
   * clock accepts.
   *
   * No host callback runs in between, so the elapsed real time has no effect on the
   * result and there is nothing to wait for or poll. A tick the clock declines runs
   * no frame, which is what makes `advance(n)` exactly `n` frames under a clock
   * that supplies its own deltas and fewer than `n` under one that paces.
   *
   * A throw out of the game propagates out of here rather than being swallowed the
   * way the pump's does: a caller stepping an exact count is asking what those
   * frames do, and it needs the failure — not the frames after it.
   */
  advance(frames: number): void {
    if (!isFrameCount(frames)) {
      throw new RangeError(
        `advance() needs a whole, non-negative frame count, got ${frames}`,
      );
    }
    for (let i = 0; i < frames; i++) this.tick(this.nowFn());
  }

  /** Where the loop has got to: the tick count, simulated time, and the last step. */
  info(): FrameInfo {
    return {
      count: this.frameCount,
      timeMs: this.accumulatedMs,
      lastDeltaMs: this.lastDeltaMs,
    };
  }

  /** Frame timing over the last ten seconds of simulated time. */
  metrics(): FrameMetrics {
    return this.samples.metrics();
  }

  /**
   * The window's individual frame times in milliseconds, oldest first — what the
   * overlay's graph plots.
   *
   * The loop keeps ownership: the array is the window's own, refilled on each call,
   * so a caller that means to keep a sample copies it out. Nothing in the engine
   * does, and nothing should — the picture is redrawn from the live window every
   * frame it is visible.
   */
  series(): readonly number[] {
    return this.samples.series();
  }

  /**
   * Add a hook to run at the end of every frame, after `render`.
   *
   * The engine uses this for the work that must happen once the game has finished
   * with the frame — closing the input frame so edge-triggered actions are consumed
   * exactly once, and redrawing the diagnostics overlay on its own surface above
   * the picture the frame just rendered.
   */
  onFrame(hook: () => void): void {
    this.hooks.push(hook);
  }

  /** Halt when `signal` aborts, or immediately if it already has. */
  private watch(signal: AbortSignal): void {
    if (signal.aborted) {
      this.halt();
      return;
    }
    const onAbort = (): void => this.halt();
    signal.addEventListener("abort", onAbort, { once: true });
    this.unwatch.add(() => signal.removeEventListener("abort", onAbort));
  }

  /** The pump: one host callback, one tick, then re-arm. */
  private readonly pump = (t: number): void => {
    this.handle = null;
    if (!this.running) return;

    // Prefer the host's frame timestamp — it is the time the frame is *for*, and it
    // shares a time base with `performance.now`. Not every host passes one, hence
    // the fall back to reading the clock directly.
    const stamp = Number.isFinite(t) ? t : this.nowFn();

    try {
      this.tick(stamp);
    } finally {
      // Re-arm in `finally` so a throw out of the game's own update surfaces (to
      // `window.onerror`, uncaught, where it is visible) without freezing the game
      // forever on one bad frame. The guards re-check state the frame may have
      // changed — a game may halt the loop from inside its update.
      if (this.running && this.handle === null) this.armFrame();
    }
  };

  /** Ask the clock what this tick is worth, and run a frame if it is worth one. */
  private tick(nowMs: number): void {
    const deltaMs = this.currentClock.delta(nowMs);
    // A declined tick is not a frame: the simulation, the counters and the metric
    // window are all left exactly as they were.
    if (deltaMs === null) return;
    this.runFrame(deltaMs);
  }

  private armFrame(): void {
    this.handle = this.rafFn(this.pump);
  }

  private cancelPending(): void {
    if (this.handle === null) return;
    this.cancelFn(this.handle);
    this.handle = null;
  }

  /** One frame: bookkeeping, then update, render, and the engine's hooks in order. */
  private runFrame(deltaMs: number): void {
    this.frameCount += 1;
    this.accumulatedMs += deltaMs;
    this.lastDeltaMs = deltaMs;

    const startedMs = this.nowFn();
    try {
      const callbacks = this.callbacks;
      if (callbacks) {
        // Seconds for the game: every physical quantity a 3D game writes down
        // (world units per second, radians per second, gravity) is per-second, and
        // milliseconds invite a factor-of-1000 bug in every one of them.
        callbacks.update(deltaMs / 1000);
        callbacks.render();
      }
      for (const hook of this.hooks) hook();
    } finally {
      // Sampled in `finally` so a frame that threw still contributes what it cost.
      // A build failing every frame is exactly the one whose frame times a reader
      // wants, and dropping the sample would report an empty window instead.
      this.samples.record(this.accumulatedMs, this.nowFn() - startedMs);
    }
  }
}

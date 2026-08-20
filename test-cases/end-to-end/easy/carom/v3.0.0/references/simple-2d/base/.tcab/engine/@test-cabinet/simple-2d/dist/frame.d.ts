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
 * frame-time window is a ring buffer of {@link SAMPLE_CAPACITY} samples evicted by
 * age as well as by capacity, so a run of any length at any frame rate holds the
 * same number of bytes. Nothing else here grows with the length of a run.
 */
import type { Clock, FrameInfo, FrameMetrics, RunOptions } from "./contract";
/** The two functions the loop drives, as the engine wires them up. */
export interface FrameCallbacks {
    /** Advance the simulation by `dt` seconds. */
    update(dt: number): void;
    /** Draw the state the update left behind, into the prepared context. */
    render(ctx: CanvasRenderingContext2D): void;
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
    /**
     * The destination `render` draws into.
     *
     * The loop owns *when* a frame happens, never *what* it draws on: the canvas, its
     * letterboxing and its device-pixel-ratio scaling belong to the engine, which
     * supplies the prepared context through here.
     */
    context?: () => CanvasRenderingContext2D;
}
/** The engine's frame loop: the host pump, the stepper, and the bookkeeping. */
export declare class FrameLoop {
    private readonly rafFn;
    private readonly cancelFn;
    private readonly nowFn;
    private readonly context;
    private readonly callbacks;
    private readonly hooks;
    private readonly samples;
    private currentClock;
    private running;
    private handle;
    /**
     * The promise every live `run` call shares, and the function that settles it.
     *
     * One promise rather than one per call: a second `run` while the loop is already
     * running is a caller asking to wait for the halt, not to start a second pump,
     * and two pumps over one clock would double every frame.
     */
    private pendingRun;
    private settleRun;
    /**
     * How each watched signal is unwatched again.
     *
     * Held so a halt drops every listener it armed. The set is emptied on every halt,
     * so it is bounded by the callers currently waiting on a run rather than by
     * anything the run itself produces.
     */
    private readonly unwatch;
    private frameCount;
    private accumulatedMs;
    private lastDeltaMs;
    constructor(options: FrameLoopOptions);
    /**
     * Replace the clock in place. The next tick takes its delta from the new one.
     *
     * The counters carry over deliberately: the frame count and the accumulated time
     * describe the run, not the clock, and resetting them on a swap would make "how
     * far has this game got" depend on how many times the driver changed its mind.
     */
    setClock(clock: Clock): void;
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
    run(options?: RunOptions): Promise<void>;
    /**
     * Halt the loop, drop any frame already scheduled, and resolve every waiting
     * `run`. Idempotent, because teardown races with the signal it is racing.
     */
    halt(): void;
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
    advance(frames: number): void;
    /** Where the loop has got to: the tick count, simulated time, and the last step. */
    info(): FrameInfo;
    /** Frame timing over the last ten seconds of simulated time. */
    metrics(): FrameMetrics;
    /**
     * The window's individual frame times in milliseconds, oldest first — what the
     * overlay's graph plots.
     *
     * The loop keeps ownership: the array is the window's own, refilled on each call,
     * so a caller that means to keep a sample copies it out. Nothing in the engine
     * does, and nothing should — the picture is redrawn from the live window every
     * frame it is visible.
     */
    series(): readonly number[];
    /**
     * Add a hook to run at the end of every frame, after `render`.
     *
     * The engine uses this for the work that must happen once the game has finished
     * with the frame — closing the input frame so edge-triggered actions are consumed
     * exactly once, and redrawing the diagnostics overlay on top of what was just
     * drawn.
     */
    onFrame(hook: () => void): void;
    /** Halt when `signal` aborts, or immediately if it already has. */
    private watch;
    /** The pump: one host callback, one tick, then re-arm. */
    private readonly pump;
    /** Ask the clock what this tick is worth, and run a frame if it is worth one. */
    private tick;
    private armFrame;
    private cancelPending;
    /** One frame: bookkeeping, then update, render, and the engine's hooks in order. */
    private runFrame;
}
//# sourceMappingURL=frame.d.ts.map
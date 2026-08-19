/**
 * The frame loop, and the clock behind it.
 *
 * The engine's frame model is deliberately thin: it hands the game the *real*
 * elapsed time for the frame and gets out of the way. It does not accumulate, does
 * not fix the step, and does not decide how many simulation steps a long frame is
 * worth — a game that wants a fixed timestep can build one on top of the delta it
 * is given, and one that integrates directly against `dt` is equally welcome. The
 * only thing the loop insists on is a *ceiling*: a backgrounded tab can hand
 * `requestAnimationFrame` a multi-second gap, and a game asked to integrate half a
 * minute in one step tunnels through its own walls. Clamping is the difference
 * between "the game paused while you were away" and "the game broke".
 *
 * The clock is replaceable, and that is the whole reason this module exists as a
 * separate seam rather than a `requestAnimationFrame` call inside the engine. Under
 * {@link FrameLoop.setClock | `"manual"`} the loop stops listening to the wall
 * clock entirely and runs frames only when {@link FrameLoop.advance | `advance`}
 * says so, each taking its delta from a {@link Schedule}. Two things fall out of
 * that:
 *
 * - A driver reads an *exact* state. `advance(120)` is 120 frames, synchronously,
 *   whatever the host machine's frame rate — so a validation script counting ticks
 *   never has to sleep, poll, or tolerate a slow CI runner.
 * - Delta-time independence becomes directly checkable. Running the same scenario
 *   under a fixed schedule, an uneven sequence, and a seeded jitter should reach
 *   the same outcome; if it does not, the game is coupled to frame rate, and that
 *   is a real defect the engine can now surface instead of hiding.
 *
 * `advance` is refused under the auto clock, because it would interleave with rAF
 * frames the driver did not ask for and the "exactly N frames" guarantee — the
 * entire point of the manual clock — would quietly stop holding.
 */
import type { ClockMode, FrameCallbacks, FrameInfo, Schedule } from "./contract";
/** How the loop is wired to its host — every part injectable, so it is testable. */
export interface FrameLoopOptions {
    /** Schedules the next auto frame; defaults to `requestAnimationFrame`. */
    raf?: (cb: (t: number) => void) => number;
    /** Cancels a scheduled auto frame; defaults to `cancelAnimationFrame`. */
    cancel?: (h: number) => void;
    /** Reads the wall clock, used when the host's frame callback carries no timestamp. */
    now?: () => number;
    /** The auto clock's step ceiling in milliseconds; defaults to 100. */
    maxDeltaMs?: number;
    /**
     * The destination `render` draws into.
     *
     * The loop owns *when* a frame happens, never *what* it draws on: the canvas, its
     * letterboxing and its device-pixel-ratio scaling belong to the engine, which
     * supplies the prepared context through here. A loop built without one still runs
     * `render` — a frame is not complete without it — which is what lets the loop be
     * stepped headlessly.
     */
    context?: () => CanvasRenderingContext2D;
}
/**
 * The engine's frame loop: the auto clock's rAF pump, the manual clock's stepper,
 * and the frame bookkeeping the host interface reports.
 */
export declare class FrameLoop {
    private readonly rafFn;
    private readonly cancelFn;
    private readonly nowFn;
    private readonly maxDeltaMs;
    private readonly context;
    private callbacks;
    private readonly hooks;
    private mode;
    private currentSchedule;
    /** The manual clock's position in its schedule; reset whenever one is installed. */
    private scheduleIndex;
    private running;
    private handle;
    /**
     * The timestamp the previous auto frame ran at, or `null` when there is no
     * baseline — before the first frame, and after a clock switch. A `null` baseline
     * yields a zero delta rather than a guess, because no time has elapsed *for the
     * game* since it started or since the manual clock handed control back.
     */
    private lastStampMs;
    private frameCount;
    private accumulatedMs;
    private lastDeltaMs;
    constructor(options?: FrameLoopOptions);
    /**
     * Start driving `callbacks`. Under the auto clock this schedules the first frame;
     * under the manual clock it only records them, since nothing runs until a driver
     * calls {@link advance}. Calling `run` again swaps the callbacks without
     * scheduling a second pump.
     */
    run(callbacks: FrameCallbacks): void;
    /** Halt the loop and drop any frame already scheduled. */
    stop(): void;
    /**
     * Switch clocks. Safe at any point, including from inside a frame.
     *
     * Switching to manual cancels the pending rAF frame — one that had not run yet,
     * so nothing is lost. Switching back to auto drops the timestamp baseline: the
     * wall clock kept running while the manual clock stepped, and charging the game
     * for that gap would replay time it never lived through.
     */
    setClock(mode: ClockMode): void;
    /** The clock currently in force. */
    clock(): ClockMode;
    /**
     * Install the delta pattern the manual clock steps on, restarting it at the
     * pattern's first step so a schedule means the same thing however many frames
     * preceded it.
     */
    setSchedule(schedule: Schedule): void;
    /** The manual clock's current schedule, as a copy. */
    schedule(): Schedule;
    /**
     * Run exactly `steps` frames, synchronously, each stepped by the schedule.
     *
     * Manual steps are never clamped the way auto frames are: a schedule is a
     * deliberate instruction, and a driver asking what a 500 ms frame does to the
     * simulation is entitled to a 500 ms frame.
     *
     * This works whether or not the game has called {@link run}: the manual clock
     * belongs to the driver, and `running` describes only the rAF pump, which is
     * irrelevant here. A frame with no callbacks registered still counts — it steps
     * the clock and runs the engine's own per-frame hooks.
     */
    advance(steps: number): void;
    /** Where the loop has got to: the tick count, simulated time, and the last step. */
    info(): FrameInfo;
    /**
     * Add a hook to run at the end of every frame, after `render`.
     *
     * The engine uses this for the work that must happen once the game has finished
     * with the frame — closing the input frame so edge-triggered actions are consumed
     * exactly once, and redrawing the diagnostics overlay on top of what was just
     * drawn.
     */
    onFrame(hook: () => void): void;
    /**
     * The delta, in milliseconds, the schedule gives to the frame at `index`.
     *
     * Delegated to {@link scheduleStep} rather than re-derived here, and that is not
     * mere tidiness. A jittered schedule's whole value is that a driver can replay a
     * failing run exactly, which requires that "the step for frame `i` under seed `s`"
     * have exactly *one* answer in this package. A second hash living in the loop
     * meant the pure module described a run the loop never actually performed.
     */
    private stepFor;
    /** The auto clock's pump: one rAF frame, then re-arm. */
    private readonly pump;
    private armFrame;
    private cancelPending;
    /** One frame: bookkeeping, then update, render, and the engine's hooks in order. */
    private runFrame;
}

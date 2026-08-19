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
import { DEFAULT_SCHEDULE, scheduleStep } from "./schedule";
/**
 * The longest step a frame may report under the auto clock, in milliseconds. 100 ms
 * is a tenth of a second: slow enough that no real frame is ever clamped, short
 * enough that the worst step a game can be handed stays survivable.
 */
const DEFAULT_MAX_DELTA_MS = 100;
/** `true` for a whole, non-negative, finite count of frames. */
function isStepCount(steps) {
    return Number.isInteger(steps) && steps >= 0;
}
/** A copy, so neither the caller nor a driver can mutate the loop's live schedule. */
function cloneSchedule(schedule) {
    return schedule.kind === "sequence"
        ? { kind: "sequence", stepsMs: [...schedule.stepsMs] }
        : { ...schedule };
}
/** Whether this host has a real `requestAnimationFrame` to drive the auto clock. */
function hasRaf() {
    return typeof globalThis.requestAnimationFrame === "function";
}
/**
 * The engine's frame loop: the auto clock's rAF pump, the manual clock's stepper,
 * and the frame bookkeeping the host interface reports.
 */
export class FrameLoop {
    rafFn;
    cancelFn;
    nowFn;
    maxDeltaMs;
    context;
    callbacks = null;
    hooks = [];
    mode = "auto";
    currentSchedule = cloneSchedule(DEFAULT_SCHEDULE);
    /** The manual clock's position in its schedule; reset whenever one is installed. */
    scheduleIndex = 0;
    running = false;
    handle = null;
    /**
     * The timestamp the previous auto frame ran at, or `null` when there is no
     * baseline — before the first frame, and after a clock switch. A `null` baseline
     * yields a zero delta rather than a guess, because no time has elapsed *for the
     * game* since it started or since the manual clock handed control back.
     */
    lastStampMs = null;
    frameCount = 0;
    accumulatedMs = 0;
    lastDeltaMs = 0;
    constructor(options = {}) {
        // Defaults are captured once, but chosen so a host with no rAF (a plain Node
        // process, a jsdom without a visual pretence) still runs rather than crashing.
        this.rafFn =
            options.raf ??
                ((cb) => hasRaf()
                    ? globalThis.requestAnimationFrame(cb)
                    : setTimeout(() => cb(this.nowFn()), 16));
        this.cancelFn =
            options.cancel ??
                ((h) => {
                    if (hasRaf())
                        globalThis.cancelAnimationFrame(h);
                    else
                        clearTimeout(h);
                });
        this.nowFn = options.now ?? (() => performance.now());
        this.maxDeltaMs = options.maxDeltaMs ?? DEFAULT_MAX_DELTA_MS;
        this.context = options.context;
    }
    /**
     * Start driving `callbacks`. Under the auto clock this schedules the first frame;
     * under the manual clock it only records them, since nothing runs until a driver
     * calls {@link advance}. Calling `run` again swaps the callbacks without
     * scheduling a second pump.
     */
    run(callbacks) {
        this.callbacks = callbacks;
        if (this.running)
            return;
        this.running = true;
        this.lastStampMs = null;
        if (this.mode === "auto")
            this.armFrame();
    }
    /** Halt the loop and drop any frame already scheduled. */
    stop() {
        this.running = false;
        this.cancelPending();
        this.lastStampMs = null;
    }
    /**
     * Switch clocks. Safe at any point, including from inside a frame.
     *
     * Switching to manual cancels the pending rAF frame — one that had not run yet,
     * so nothing is lost. Switching back to auto drops the timestamp baseline: the
     * wall clock kept running while the manual clock stepped, and charging the game
     * for that gap would replay time it never lived through.
     */
    setClock(mode) {
        if (mode === this.mode)
            return;
        this.mode = mode;
        if (mode === "manual") {
            this.cancelPending();
            return;
        }
        this.lastStampMs = null;
        if (this.running)
            this.armFrame();
    }
    /** The clock currently in force. */
    clock() {
        return this.mode;
    }
    /**
     * Install the delta pattern the manual clock steps on, restarting it at the
     * pattern's first step so a schedule means the same thing however many frames
     * preceded it.
     */
    setSchedule(schedule) {
        if (schedule.kind === "sequence" && schedule.stepsMs.length === 0) {
            throw new RangeError("a sequence schedule needs at least one step");
        }
        if (schedule.kind === "jitter" && schedule.maxMs < schedule.minMs) {
            throw new RangeError(`a jitter schedule needs maxMs >= minMs, got ${schedule.minMs}..${schedule.maxMs}`);
        }
        this.currentSchedule = cloneSchedule(schedule);
        this.scheduleIndex = 0;
    }
    /** The manual clock's current schedule, as a copy. */
    schedule() {
        return cloneSchedule(this.currentSchedule);
    }
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
    advance(steps) {
        if (this.mode !== "manual") {
            throw new Error("advance() requires the manual clock; call setClock(\"manual\") first");
        }
        if (!isStepCount(steps)) {
            throw new RangeError(`advance() needs a whole, non-negative step count, got ${steps}`);
        }
        for (let i = 0; i < steps; i++) {
            this.runFrame(this.stepFor(this.scheduleIndex++));
        }
    }
    /** Where the loop has got to: the tick count, simulated time, and the last step. */
    info() {
        return {
            count: this.frameCount,
            timeMs: this.accumulatedMs,
            lastDeltaMs: this.lastDeltaMs,
        };
    }
    /**
     * Add a hook to run at the end of every frame, after `render`.
     *
     * The engine uses this for the work that must happen once the game has finished
     * with the frame — closing the input frame so edge-triggered actions are consumed
     * exactly once, and redrawing the diagnostics overlay on top of what was just
     * drawn.
     */
    onFrame(hook) {
        this.hooks.push(hook);
    }
    /**
     * The delta, in milliseconds, the schedule gives to the frame at `index`.
     *
     * Delegated to {@link scheduleStep} rather than re-derived here, and that is not
     * mere tidiness. A jittered schedule's whole value is that a driver can replay a
     * failing run exactly, which requires that "the step for frame `i` under seed `s`"
     * have exactly *one* answer in this package. A second hash living in the loop
     * meant the pure module described a run the loop never actually performed.
     */
    stepFor(index) {
        return scheduleStep(this.currentSchedule, index);
    }
    /** The auto clock's pump: one rAF frame, then re-arm. */
    pump = (t) => {
        this.handle = null;
        if (!this.running || this.mode !== "auto")
            return;
        // Prefer the host's frame timestamp — it is the time the frame is *for*, and it
        // shares a time base with `performance.now`. Not every host passes one, hence
        // the fall back to reading the clock directly.
        const stamp = Number.isFinite(t) ? t : this.nowFn();
        const elapsed = this.lastStampMs === null ? 0 : stamp - this.lastStampMs;
        this.lastStampMs = stamp;
        // Clamped below by zero as well: a non-monotonic timestamp must not rewind the
        // simulation, which is a far worse failure than a dropped millisecond.
        const delta = Math.min(Math.max(elapsed, 0), this.maxDeltaMs);
        try {
            this.runFrame(delta);
        }
        finally {
            // Re-arm in `finally` so a throw out of the game's own update surfaces (to
            // `window.onerror`, uncaught, where it is visible) without freezing the game
            // forever on one bad frame. The guards re-check state the frame may have
            // changed — a game may stop, or switch clocks, from inside update.
            if (this.running && this.mode === "auto" && this.handle === null)
                this.armFrame();
        }
    };
    armFrame() {
        this.handle = this.rafFn(this.pump);
    }
    cancelPending() {
        if (this.handle === null)
            return;
        this.cancelFn(this.handle);
        this.handle = null;
    }
    /** One frame: bookkeeping, then update, render, and the engine's hooks in order. */
    runFrame(deltaMs) {
        this.frameCount += 1;
        this.accumulatedMs += deltaMs;
        this.lastDeltaMs = deltaMs;
        const callbacks = this.callbacks;
        if (callbacks) {
            // Seconds for the game: every physical quantity a 2D game writes down (pixels
            // per second, gravity) is per-second, and milliseconds invite a factor-of-1000
            // bug in every one of them.
            callbacks.update(deltaMs / 1000);
            callbacks.render(this.context?.());
        }
        for (const hook of this.hooks)
            hook();
    }
}

/**
 * The delta-time schedule a manual clock walks.
 *
 * Under `"auto"` the frame loop's step is whatever the wall clock and
 * `requestAnimationFrame` produced. Under `"manual"` a driver supplies a
 * {@link Schedule} instead, and every frame's delta comes from here — which is what
 * makes a validation script's tick counts mean something: one `advance` step is one
 * scheduled frame, no real time passes, and nothing has to be waited for.
 *
 * The module is deliberately pure: a schedule plus a frame index is enough to say
 * what that frame's step is, with no state carried between calls. That is not a
 * stylistic preference — a delta-time-independence check runs the *same* scenario
 * under several schedules and compares the outcomes, so a failure has to be
 * replayable exactly. Statelessness also means the jitter kind cannot drift out of
 * step with the frame counter if a frame is ever run twice or skipped.
 */
import type { Schedule, ScheduleFixed } from "./contract";
/**
 * The step a manual clock uses until a driver sets one: 120 Hz.
 *
 * It matches the tick rate cases already instrument at, so moving a case onto the
 * engine leaves its existing tick-counted assertions meaning the same thing.
 */
export declare const DEFAULT_SCHEDULE: ScheduleFixed;
/**
 * The step, in milliseconds, for the `index`-th frame of `schedule`.
 *
 * `index` is the frame counter, so a sequence cycles and jitter is reproducible for
 * a given `(seed, index)`. A non-integer or negative index is folded into range
 * rather than rejected, because this is called once per frame on a hot path and a
 * schedule is validated once, by {@link validateSchedule}, when it is installed.
 */
export declare function scheduleStep(schedule: Schedule, index: number): number;
/**
 * Reject a schedule a frame loop cannot run, at the point it is installed.
 *
 * Failing here — loudly, with the offending value in the message — rather than at
 * the first frame is the difference between a driver seeing "jitter schedule needs
 * maxMs >= minMs, got minMs 20 and maxMs 5" and seeing a build that advances but
 * never moves. A zero or negative step is the same class of mistake: the loop would
 * run frames that simulate no time, and a tick-counted assertion would hang rather
 * than fail.
 *
 * An *empty* sequence is not an error *here*: {@link scheduleStep} falls back to
 * the default step for it, so evaluating one is always well defined. Installing one
 * is a separate question, and `FrameLoop.setSchedule` does reject it — a driver that
 * asked for a pattern and supplied none has almost certainly computed its steps
 * wrong, and a clock that silently ran at some other rate would be far harder to
 * notice than a `RangeError`.
 */
export declare function validateSchedule(schedule: Schedule): void;
//# sourceMappingURL=schedule.d.ts.map
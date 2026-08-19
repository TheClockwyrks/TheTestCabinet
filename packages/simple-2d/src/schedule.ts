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
export const DEFAULT_SCHEDULE: ScheduleFixed = {
  kind: "fixed",
  stepMs: 1000 / 120,
};

/**
 * A 32-bit integer hash of `(seed, index)`.
 *
 * A hash rather than a stateful PRNG because the jitter kind is indexed, not
 * streamed: frame 900's delta must be the same whether it was reached by running
 * 900 frames or asked for directly. The avalanche steps (the shift-xor / multiply
 * rounds, in the murmur3 finalizer family) are what stop neighbouring indices —
 * which is all a frame counter ever produces — from yielding neighbouring outputs,
 * i.e. a slow ramp instead of jitter.
 */
function hash32(seed: number, index: number): number {
  let h =
    (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(index | 0, 0x85ebca6b)) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  h = Math.imul(h, 0x21f0aaad) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h, 0x735a2d97) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  return h >>> 0;
}

/** The hash as a uniform `[0, 1)` float. */
function unit(seed: number, index: number): number {
  return hash32(seed, index) / 0x1_0000_0000;
}

/**
 * The step, in milliseconds, for the `index`-th frame of `schedule`.
 *
 * `index` is the frame counter, so a sequence cycles and jitter is reproducible for
 * a given `(seed, index)`. A non-integer or negative index is folded into range
 * rather than rejected, because this is called once per frame on a hot path and a
 * schedule is validated once, by {@link validateSchedule}, when it is installed.
 */
export function scheduleStep(schedule: Schedule, index: number): number {
  const i = Number.isFinite(index) ? Math.trunc(index) : 0;
  switch (schedule.kind) {
    case "fixed":
      return schedule.stepMs;
    case "sequence": {
      const steps = schedule.stepsMs;
      if (steps.length === 0) return DEFAULT_SCHEDULE.stepMs;
      // The double modulo folds a negative index back into range; the `??` is for
      // `noUncheckedIndexedAccess` and is unreachable given the length check.
      const at = ((i % steps.length) + steps.length) % steps.length;
      return steps[at] ?? DEFAULT_SCHEDULE.stepMs;
    }
    case "jitter":
      return schedule.minMs + unit(schedule.seed, i) * (schedule.maxMs - schedule.minMs);
  }
}

/** A step that a frame loop can actually advance by. */
function isPositiveStep(step: number): boolean {
  return Number.isFinite(step) && step > 0;
}

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
export function validateSchedule(schedule: Schedule): void {
  switch (schedule.kind) {
    case "fixed":
      if (!isPositiveStep(schedule.stepMs)) {
        throw new Error(
          `fixed schedule needs a positive stepMs, got ${schedule.stepMs}`,
        );
      }
      return;
    case "sequence": {
      const bad = schedule.stepsMs.findIndex((step) => !isPositiveStep(step));
      if (bad !== -1) {
        throw new Error(
          `sequence schedule needs positive steps, got ${schedule.stepsMs[bad]} at index ${bad}`,
        );
      }
      return;
    }
    case "jitter": {
      if (!isPositiveStep(schedule.minMs) || !isPositiveStep(schedule.maxMs)) {
        throw new Error(
          `jitter schedule needs positive bounds, got minMs ${schedule.minMs} and maxMs ${schedule.maxMs}`,
        );
      }
      if (schedule.maxMs < schedule.minMs) {
        throw new Error(
          `jitter schedule needs maxMs >= minMs, got minMs ${schedule.minMs} and maxMs ${schedule.maxMs}`,
        );
      }
      if (!Number.isFinite(schedule.seed)) {
        throw new Error(
          `jitter schedule needs a finite seed, got ${schedule.seed}`,
        );
      }
      return;
    }
    default: {
      // Reachable despite the exhaustive union: a schedule arrives from a driver as
      // untyped JSON across the `window` boundary, so the type is a claim, not a
      // guarantee, and a typo in `kind` deserves a real message.
      const kind = (schedule as { kind?: unknown }).kind;
      throw new Error(`unknown schedule kind ${JSON.stringify(kind)}`);
    }
  }
}

import type { BufferTarget } from "@clockwyrks/run-record/coverage";

// The review-buffer target as the console handles it: the tagged shape the backend
// stores and reports, plus the few readings every surface that shows one needs — is
// it full, what does it say, how does it print beside an occupancy. One home so the
// plan dashboard, the ladder dashboard, the two editors, and the Reviewing settings
// tab all describe the same target the same way.

/** The largest bound the backend stores; a bigger one is clamped on save. */
export const BUFFER_TARGET_CEILING = 500;

/** The bound the backend applies to an account that has never chosen one. */
export const DEFAULT_BUFFER_TARGET: BufferTarget = {
  kind: "bounded",
  runs: 10,
};

/** No bound at all: a top-up runs through every missing cell. */
export const UNBOUNDED_BUFFER: BufferTarget = { kind: "unbounded" };

/** A bound of `runs` outstanding runs, kept within what the backend stores. */
export function boundedBuffer(runs: number): BufferTarget {
  const whole = Math.floor(runs);
  return {
    kind: "bounded",
    runs: Number.isFinite(whole)
      ? Math.min(Math.max(whole, 0), BUFFER_TARGET_CEILING)
      : 0,
  };
}

/** The bound a target carries, or null when it has none. */
export function bufferBound(target: BufferTarget): number | null {
  return target.kind === "bounded" ? target.runs : null;
}

/**
 * Whether `outstanding` runs already fill the buffer, so a top-up stops before it
 * emits another cell. The same rule the backend's scheduler applies: an unbounded
 * buffer is never full.
 */
export function bufferIsFull(
  target: BufferTarget,
  outstanding: number,
): boolean {
  return target.kind === "bounded" && outstanding >= target.runs;
}

export function sameBufferTarget(
  a: BufferTarget | null,
  b: BufferTarget | null,
): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind !== b.kind) return false;
  return a.kind === "unbounded" || b.kind === "unbounded" || a.runs === b.runs;
}

/**
 * The target as the figure beside an occupancy: `12/∞ buffered` for an unbounded
 * buffer, `4/10 buffered` for a bound.
 */
export function formatBufferTarget(target: BufferTarget): string {
  return target.kind === "bounded" ? String(target.runs) : "∞";
}

/** The target as a phrase: "10 outstanding runs", "1 outstanding run", "no limit". */
export function describeBufferTarget(target: BufferTarget): string {
  if (target.kind === "unbounded") return "no limit";
  return `${target.runs} outstanding run${target.runs === 1 ? "" : "s"}`;
}

/**
 * The tooltip over a dashboard's `outstanding/target buffered` figure, which has to
 * say what the target does to the top-up for the shape it has.
 */
export function bufferedStatTitle(target: BufferTarget): string {
  const occupancy =
    "Runs waiting on you or on the queue: in flight (queued, pending, or executing) plus finished but unreviewed by you.";
  return target.kind === "bounded"
    ? `${occupancy} A top-up stops once this reaches the buffer target.`
    : `${occupancy} This buffer has no limit, so a top-up never stops on it.`;
}

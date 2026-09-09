// A bound on the recorder's draw log, for a case whose SWEEPS outrun its
// readings. 2D ONLY, because the log is the 2D recorder's.
//
// WHY A BOUND EXISTS AT ALL. `./canvas`'s recorder keeps every call and property
// set the render made, and a check that reads a picture reads ONE frame: the
// idiom everywhere in the tree is empty the log, run one frame, read what that
// frame drew. But the log is recorded whether a check reads it or not, and a case
// whose longest scenario runs for thousands of frames — Cascade's victory
// cascade is fifty-two cards in the air for twelve and a half seconds of game
// time, measured at eleven hundred calls a frame — accumulates millions of
// entries in a suite that never looks at one. That is a gigabyte of a worker's
// heap spent on a reading nobody takes.
//
// WHY IT IS NOT A RECORDER OPTION. The bound is not a property of recording; it
// is a property of a case's LONGEST SWEEP, which is why the four harnesses that
// carried one disagreed about the figure (`100_000` and `200_000`) and the other
// thirteen carried none. A default would be a threshold this package invented,
// and an unbounded log is the honest reading for a case that never runs long
// enough to notice.
//
// WHY IT PATCHES THE ARRAY RATHER THAN THE RECORDER. The recorder appends through
// the log's own `push`, so an own property on the array is where a bound can
// stand without the recorder knowing there is one — and `EngineHarness.calls` is
// that same array, so a case binds it once, after its harness is built, and every
// later append is bounded. Nothing else about the log changes: it is the same
// array, holding the same entries, in the same order.
//
// WHAT IT COSTS A READING, WHICH IS NOTHING A CASE MEANS TO READ. Past the cap
// the OLDEST HALF is dropped, so what survives is always at least `max / 2`
// entries of the most recent drawing — orders of magnitude past the one frame any
// reading here is taken over. A case that holds the log across a sweep longer than
// its own cap is reading something this cannot serve, and should not bind it.

import type { DrawCall } from "../draw-calls";

/**
 * Bound `calls` in place: once it holds `max` entries, appending drops the
 * oldest half first.
 *
 * Called on `EngineHarness.calls` right after `createHarness`, by a case whose
 * sweeps run far past what its readings look at:
 *
 * ```ts
 * export async function createHarness(options: HarnessOptions = {}) {
 *   const h = await kit.createHarness(options);
 *   boundDrawLog(h.calls, MAX_RECORDED_CALLS);
 *   return h;
 * }
 * ```
 *
 * IDEMPOTENT PER ARRAY: binding one twice leaves one bound at the LOWER of the
 * two caps, rather than nesting a second one inside the first, so two harnesses
 * built from one config cannot compound the drop. Binding a log that is already
 * over the new cap trims it at the next append rather than now, because nothing
 * here should decide that a reading a check is holding is stale.
 */
export function boundDrawLog(calls: DrawCall[], max: number): void {
  if (!Number.isFinite(max) || max < 2) {
    throw new RangeError(
      `max must be a finite number of at least 2, got ${max}`,
    );
  }
  const bound = BOUNDS.get(calls);
  if (bound !== undefined) {
    bound.max = Math.min(bound.max, max);
    return;
  }
  const state = { max };
  BOUNDS.set(calls, state);
  const append = Array.prototype.push.bind(calls) as (
    ...items: DrawCall[]
  ) => number;
  Object.defineProperty(calls, "push", {
    value: (...items: DrawCall[]): number => {
      if (calls.length >= state.max) {
        calls.splice(0, Math.floor(state.max / 2));
      }
      return append(...items);
    },
    // Writable and configurable, so a `calls.length = 0` and every other ordinary
    // use of the array is untouched and a later binding can still replace this.
    writable: true,
    configurable: true,
    enumerable: false,
  });
}

/** The cap each bounded log stands at, so a second binding tightens rather than nests. */
const BOUNDS = new WeakMap<DrawCall[], { max: number }>();

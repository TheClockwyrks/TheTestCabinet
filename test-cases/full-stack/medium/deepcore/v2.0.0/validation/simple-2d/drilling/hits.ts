// drilling — counting the hits a held cut lands, exactly.
//
// Not a suite: a helper several of them share. `specs/character.md` has the drill
// land a hit every `DRILL_HIT_INTERVAL` and remove the drill tier's damage from
// the target cell's health, and the cell break when its health reaches `0`. So
// the hits a cut landed are the number of times the cell's health FELL, plus the
// one that took it to `0` and turned it to tunnel.
//
// Counting the falls rather than the frames is what makes the count exact.
// `specs/character.md` does not say whether the first hit of a cut lands as the
// key goes down or one interval later, and both are cuts landing a hit every
// interval — so a count read off the elapsed time is a count with a hit of slack
// in it, and a check that needs the number rather than the rate cannot afford
// that. Health is unambiguous: it falls once per hit whenever the hit landed.

import { DRILL_HIT_INTERVAL } from "../constants";
import type { Harness } from "../harness";
import { TICK_HZ } from "../harness";

/**
 * Frames between two samples of the target cell, for a cut driven at the
 * harness clock's own step.
 *
 * A third of a hit interval, so no sample window can hold two hits and no fall
 * in health can be missed. Sampling every frame would read the same number three
 * times over, at three times the cost.
 */
export const SAMPLE_FRAMES = Math.max(
  1,
  Math.floor((DRILL_HIT_INTERVAL * TICK_HZ) / 3),
);

/**
 * The game time one frame of a COUNTED cut is worth: half a hit interval.
 *
 * `specs/instrumentation.md` fixes `advance(seconds, frames)` as `frames` whole
 * frames covering `seconds` of game time, each worth `seconds / frames`, and
 * states that a span reaches the same outcome however it is divided. So a cut
 * counted hit by hit does not have to be walked at the harness clock's step. What
 * the step has to hold onto is ONE HIT TO A FRAME: a frame holding two hits shows
 * the one fall in health this counts, and the cut comes out a hit short.
 *
 * Half an interval is the coarsest step that holds it. Two hits are an interval
 * apart, so a frame shorter than an interval spans at most one of them whatever
 * phase the build's hit timer is in — including a build whose first hit lands as
 * the key goes down, which `specs/character.md` leaves open and this file counts
 * for. A frame exactly one interval long is the boundary case rather than the
 * safe one: it collapses that build's first two hits into its first frame.
 *
 * The same margin is what keeps a fall a reading of a hit. At this step a cut
 * that bled its cell's health smoothly instead of landing hits falls twice per
 * interval and counts double, where a frame-per-hit step reads it as a clean
 * sixteen and cannot tell the two apart.
 *
 * At `TICK_HZ` a cut spends most of its frames waiting for the next hit; at this
 * step it spends two frames per hit, over the same span of game time.
 */
export const HIT_STEP_SECONDS = DRILL_HIT_INTERVAL / 2;

/**
 * The game time a counted cut is given to break its cell.
 *
 * Eighty hit intervals — five times over the sixteen hits the deepest band takes
 * at the weakest drill, which is the longest cut `specs/world.md` and
 * `specs/upgrades.md` describe between them. A cut still cutting at the end of it
 * is reported as one that did not break.
 */
export const CUT_BUDGET_SECONDS = 80 * DRILL_HIT_INTERVAL;

/** What a counted cut did. */
export interface HitCount {
  /** Whether the cell broke inside the budget. */
  broke: boolean;
  /** Hits landed: the falls in health, plus the one that broke the cell. */
  hits: number;
  /** Game seconds the key was held. */
  seconds: number;
}

/**
 * Hold `code` until the cell at `(col, row)` breaks, and report the hits it took.
 *
 * The key goes down through the engine's own input and the game's update lands
 * the hits at its own interval; nothing here poses a hit. The key is released
 * before this returns.
 */
export async function countHits(
  h: Harness,
  code: string,
  col: number,
  row: number,
  budgetSeconds = CUT_BUDGET_SECONDS,
): Promise<HitCount> {
  const opening = h.tileAt(col, row);
  let health = opening.health ?? 0;
  let hits = 0;
  let seconds = 0;
  h.hold(code);
  try {
    while (seconds < budgetSeconds) {
      await h.advanceSeconds(HIT_STEP_SECONDS, 1);
      seconds += HIT_STEP_SECONDS;
      const tile = h.tileAt(col, row);
      if (tile.kind === "tunnel")
        return { broke: true, hits: hits + 1, seconds };
      const now = tile.health ?? 0;
      if (now < health) {
        hits += 1;
        health = now;
      }
    }
    return { broke: false, hits, seconds };
  } finally {
    h.release(code);
  }
}

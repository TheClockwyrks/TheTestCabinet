// drilling — counting the hits a held cut lands, exactly.
//
// Not a suite: a helper two of them share. `specs/character.md` has the drill
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

import type { Harness } from "../harness";
import { TICK_HZ } from "../harness";
import { DRILL_HIT_INTERVAL } from "../constants";

/**
 * Frames between two samples of the target cell.
 *
 * A third of a hit interval, so no sample window can hold two hits and no fall
 * in health can be missed. Sampling every frame would read the same number three
 * times over, at three times the cost.
 */
export const SAMPLE_FRAMES = Math.max(
  1,
  Math.floor((DRILL_HIT_INTERVAL * TICK_HZ) / 3),
);

/** What a counted cut did. */
export interface HitCount {
  /** Whether the cell broke inside the budget. */
  broke: boolean;
  /** Hits landed: the falls in health, plus the one that broke the cell. */
  hits: number;
  /** Frames advanced while the key was held. */
  frames: number;
}

/**
 * Hold `code` until the cell at `(col, row)` breaks, and report the hits it took.
 *
 * The key goes down through the surface's own input and the game's update lands
 * the hits at its own interval; nothing here poses a hit. The key is released
 * before this returns.
 */
export async function countHits(
  h: Harness,
  code: string,
  col: number,
  row: number,
  maxFrames = 1200,
): Promise<HitCount> {
  const opening = await h.tileAt(col, row);
  let health = opening.health ?? 0;
  let hits = 0;
  let frames = 0;
  await h.hold(code);
  try {
    while (frames < maxFrames) {
      const step = Math.min(SAMPLE_FRAMES, maxFrames - frames);
      await h.advance(step);
      frames += step;
      const tile = await h.tileAt(col, row);
      if (tile.kind === "tunnel")
        return { broke: true, hits: hits + 1, frames };
      const now = tile.health ?? 0;
      if (now < health) {
        hits += 1;
        health = now;
      }
    }
    return { broke: false, hits, frames };
  } finally {
    await h.release(code);
  }
}

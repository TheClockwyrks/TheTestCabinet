// Shatter — the sixteen arrivals the two entry-row checks read. CASE-PROVIDED.
//
// `specs/saucer.md` has a saucer enter "at a `y` drawn uniformly from `SAUCER_R` to
// `FIELD_H - SAUCER_R`", and that one sentence carries two separable properties: a
// row lies INSIDE the range, and rows drawn over and over SPREAD across it. Each is
// an item of its own, because a build that always enters dead centre and a build
// that enters half a craft off the top are different faults and must grade
// differently. What both share is the GATHER — four games opened at four seeds,
// four consecutive arrivals read from each — so it is run once, here, and each
// check reads its own thing off it.
//
// IT LIVES IN THE GROUP because nothing outside `saucer` reads an entry row, and it
// sits beside `cadence.ts` rather than inside it because `cadence.ts` is the routes
// every `saucer` check shares and this is one scenario two of them share.
//
// NOT ONE FIGURE BELOW IS A BOUND. The seeds, the sample size and the stride are
// the scenario and its cost; every tolerance stays in the check that asserts it,
// derived there from the figure `specs/saucer.md` fixes for it.

import { TICK_HZ } from "../constants";
import { captureStill, type Harness } from "../harness";
import { nextArrival, openSaucerGame } from "./cadence";

/** The four games the arrivals are read from. */
export const SEEDS = [1, 2, 3, 4] as const;

/** How many consecutive visits are read from each of them. Four each, sixteen in all. */
export const ARRIVALS_PER_SEED = 4;

/**
 * Half a `SAUCER_WEAVE_INTERVAL`, the stride the arrivals are caught with.
 *
 * NOT A TOLERANCE. `specs/saucer.md` has the saucer enter "with no vertical
 * component" and reroll its weave "every `SAUCER_WEAVE_INTERVAL`, STARTING ONE FULL
 * INTERVAL after it enters", so the row a saucer entered on is still the row it is
 * on for a whole second afterwards — and this stride is half of that second at its
 * widest, so a sample inside it reads the entry row exactly.
 */
export const STRIDE = TICK_HZ / 2;

/** One arrival's entry row, with the game and the visit it was read from. */
export interface EntryRow {
  seed: number;
  id: number;
  y: number;
}

/**
 * Open four games and read four consecutive arrivals from each, sixteen in all.
 *
 * FOUR SEEDS AND FOUR VISITS APIECE, so the reading covers LATER arrivals as well
 * as first ones rather than four copies of one game's opening draw. The draw is the
 * game's own, so each game is really opened and left to run: `openSaucerGame`
 * resets at the seed, empties the field and turns the arrival gate back on, and
 * nothing else can put a saucer up.
 *
 * The first arrival is drawn once into `still`, for the picture each item carries.
 */
export async function readEntryRows(
  h: Harness,
  still: string,
): Promise<EntryRow[]> {
  const rows: EntryRow[] = [];

  for (const seed of SEEDS) {
    await openSaucerGame(h, seed);
    let previous: number | null = null;
    for (let visit = 0; visit < ARRIVALS_PER_SEED; visit += 1) {
      const arrival = await nextArrival(h, previous, { stride: STRIDE });
      if (rows.length === 0) await captureStill(h, still);
      rows.push({ seed, id: arrival.saucer.id, y: arrival.saucer.y });
      previous = arrival.saucer.id;
    }
  }

  return rows;
}

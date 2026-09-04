// Shatter — the sixteen arrivals the two entry-row checks read. CASE-PROVIDED.
//
// `specs/saucer.md` has a saucer enter "at a `y` drawn uniformly from `SAUCER_R` to
// `FIELD_H - SAUCER_R`", and that one sentence carries two separable properties: a
// row lies INSIDE the range, and rows drawn over and over SPREAD across it. Each is
// an item of its own, because a build that always enters dead centre and a build
// that enters half a craft off the top are different faults and must grade
// differently. What both share is the GATHER — four games opened at four seeds,
// four consecutive arrivals watched out of each — so it is run once, here, and each
// check reads its own thing off it.
//
// IT LIVES IN THE GROUP because nothing outside `saucer` reads an entry row, and it
// sits beside `visits.ts` rather than inside it because `visits.ts` is the marching
// route every `saucer` check shares and this is one scenario two of them share.
//
// NOT ONE FIGURE BELOW IS A BOUND. The seeds, the sample size and the watch length
// are the scenario and its cost; every tolerance stays in the check that asserts
// it, derived there from the figure `specs/saucer.md` fixes for it.

import { captureStill, type Harness } from "../harness";
import {
  createMarchHarness,
  marchFrames,
  openQuietGame,
  watchVisits,
} from "./visits";

/** The four games the arrivals are read from. */
export const SEEDS = [1, 2, 3, 4] as const;

/** How many arrivals each seed contributes. */
export const ARRIVALS_PER_SEED = 4;

/** The sixteen arrivals both points are decided on. */
export const ARRIVALS = SEEDS.length * ARRIVALS_PER_SEED;

/**
 * How long each seed's game is watched, in seconds of game time.
 *
 * Four arrivals at their slowest legal cadence is `18 + 3 x (12 + 35)` = `159` s;
 * `170` leaves margin, so a build that never produces four is reported as that
 * rather than as a bad row.
 */
export const WATCH_SECONDS = 170;

/** One arrival's entry row, with the game and the visit it was read from. */
export interface EntryRow {
  seed: number;
  id: number;
  y: number;
}

/**
 * Open four games and watch four consecutive arrivals out of each, sixteen in all.
 *
 * FOUR SEEDS AND FOUR VISITS APIECE, so the reading covers LATER arrivals as well
 * as first ones rather than four copies of one game's opening draw. The draw is the
 * game's own, so each game is really opened and left to run: `openQuietGame` resets
 * at the seed, empties the field and leaves the arrival gate running, and nothing
 * else can put a saucer up.
 *
 * Each seed wants its own engine, so every harness this makes is pushed onto
 * `harnesses` for the caller's `afterEach` to dispose. The first arrival is drawn
 * once into `still`, for the picture each item carries.
 */
export async function readEntryRows(
  harnesses: Harness[],
  still: string,
): Promise<EntryRow[]> {
  const rows: EntryRow[] = [];
  let filmed = false;

  for (const seed of SEEDS) {
    const h = await createMarchHarness();
    harnesses.push(h);
    const opened = await openQuietGame(h, seed);

    const watch = await watchVisits(h, marchFrames(WATCH_SECONDS) - opened, {
      done: (visits) => visits.length >= ARRIVALS_PER_SEED,
      onArrival: async () => {
        if (filmed) return;
        filmed = true;
        // One of the sixteen arrivals the rows were read from. The watch runs
        // undrawn, so one frame is drawn for this picture.
        await h.paint();
        captureStill(h, still);
      },
    });
    for (const visit of watch.visits) {
      rows.push({ seed, id: visit.id, y: visit.y });
    }
  }

  return rows;
}

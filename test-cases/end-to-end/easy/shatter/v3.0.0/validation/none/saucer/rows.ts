// Shatter — the handful of arrivals the two entry-row checks read. CASE-PROVIDED.
//
// `specs/saucer.md` has a saucer enter "at a `y` drawn uniformly from `SAUCER_R` to
// `FIELD_H - SAUCER_R`", and that one sentence carries two separable properties: a
// row lies INSIDE the range, and rows drawn over and over VARY across it. Each is
// an item of its own, because a build that always enters dead centre and a build
// that enters half a craft off the top are different faults and must grade
// differently. What both share is the GATHER — two games opened, three consecutive
// arrivals read from each — so it is run once, here, and each check reads its own
// thing off it.
//
// THE ROW IS THE GAME'S OWN DRAW. Nothing here poses a row: `setNextSaucerRow` is
// how a check that wants a particular row gets one, and these two checks want the
// build's draw. What IS posed is the cadence's due, through `setSaucerDue`, so an
// arrival follows the one before it within a quarter of a second rather than
// after a visit of twelve seconds and a gap of twenty-five to thirty-five; the
// draw of the row is the same draw either way. Each visit is taken off through
// `removeSaucer` once its row is read, and `specs/instrumentation.md` has the
// cadence run from there exactly as it does after a visit that ran out.
//
// IT LIVES IN THE GROUP because nothing outside `saucer` reads an entry row, and it
// sits beside `cadence.ts` rather than inside it because `cadence.ts` is the routes
// every `saucer` check shares and this is one scenario two of them share.
//
// A HANDFUL, NOT A SAMPLE. Six arrivals are enough for each check to read what it
// reads — every row inside the stated range, and more than one row among them —
// and neither check reads a statistic off them. A draw's spread and shape are the
// reviewer's to judge from the picture, not a figure a sample decides.
//
// NOT ONE FIGURE BELOW IS A BOUND. The game count and the arrival count are the
// scenario and its cost; every tolerance stays in the check that asserts it,
// derived there from the figure `specs/saucer.md` fixes for it.

import { captureStill, type Harness } from "../harness";
import { closeUpArrival, openSaucerGame } from "./cadence";

/** How many games the arrivals are read from. */
export const GAMES = 2;

/** How many consecutive visits are read from each of them. Three each, six in all. */
export const ARRIVALS_PER_GAME = 3;

/** One arrival's entry row, with the game and the visit it was read from. */
export interface EntryRow {
  game: number;
  id: number;
  y: number;
}

/**
 * Open two games and read three consecutive arrivals from each, six in all.
 *
 * TWO GAMES AND THREE VISITS APIECE, so the reading covers LATER arrivals as well
 * as first ones rather than copies of one game's opening draw. The draw is the
 * game's own, so each game is really opened and left to run: `openSaucerGame`
 * resets, empties the field and turns the arrival gate back on, and nothing else
 * can put a saucer up. Each visit is taken off the field once its row is read,
 * and the next is brought on with a posed due.
 *
 * The first arrival is drawn once into `still`, for the picture each item carries.
 */
export async function readEntryRows(
  h: Harness,
  still: string,
): Promise<EntryRow[]> {
  const rows: EntryRow[] = [];

  for (let game = 0; game < GAMES; game += 1) {
    await openSaucerGame(h);
    let previous: number | null = null;
    for (let visit = 0; visit < ARRIVALS_PER_GAME; visit += 1) {
      if (previous !== null) await h.debug.removeSaucer();
      const arrival = await closeUpArrival(h, previous);
      if (rows.length === 0) await captureStill(h, still);
      rows.push({ game, id: arrival.saucer.id, y: arrival.saucer.y });
      previous = arrival.saucer.id;
    }
  }

  return rows;
}

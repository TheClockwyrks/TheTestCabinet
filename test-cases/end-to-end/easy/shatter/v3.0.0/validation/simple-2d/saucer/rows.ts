// Shatter — the forty arrivals the two entry-row checks read. CASE-PROVIDED.
//
// `specs/saucer.md` has a saucer enter "at a `y` drawn uniformly from `SAUCER_R` to
// `FIELD_H - SAUCER_R`", and that one sentence carries two separable properties: a
// row lies INSIDE the range, and rows drawn over and over SPREAD across it. Each is
// an item of its own, because a build that always enters dead centre and a build
// that enters half a craft off the top are different faults and must grade
// differently. What both share is the GATHER — four games opened, ten consecutive
// arrivals read from each — so it is run once, here, and each check reads its own
// thing off it.
//
// THE ROW IS THE GAME'S OWN DRAW. Nothing here poses a row: `setNextSaucerRow` is
// how a check that wants a particular row gets one, and these two checks want the
// build's draw. What IS posed is the cadence's due, through `setSaucerDue`, so an
// arrival follows the departure before it within a quarter of a second rather
// than after a gap of twenty-five to thirty-five; the draw of the row is the same
// draw either way.
//
// NOT ONE FIGURE BELOW IS A BOUND. The game count, the sample size and the stride
// are the scenario and its cost; every tolerance stays in the check that asserts
// it, derived there from the figure `specs/saucer.md` fixes for it.

import { TICK_HZ } from "../constants";
import { captureStill, type Harness } from "../harness";
import { awaitDeparture, closeUpArrival, openSaucerGame } from "./cadence";

/** How many games the arrivals are read from. */
export const GAMES = 4;

/** How many consecutive visits are read from each of them. Ten each, forty in all. */
export const ARRIVALS_PER_GAME = 10;

/**
 * Half a `SAUCER_WEAVE_INTERVAL`, the stride a departure is watched for with.
 *
 * NOT A TOLERANCE. A departure is watched for, not read: the row is read on the
 * tick the arrival is caught, and {@link closeUpArrival} catches it tick by tick.
 */
export const STRIDE = TICK_HZ / 2;

/** One arrival's entry row, with the game and the visit it was read from. */
export interface EntryRow {
  game: number;
  id: number;
  y: number;
}

/**
 * Open four games and read ten consecutive arrivals from each, forty in all.
 *
 * FOUR GAMES AND TEN VISITS APIECE, so the reading covers LATER arrivals as well
 * as first ones rather than copies of one game's opening draw. The draw is the
 * game's own, so each game is really opened and left to run: `openSaucerGame`
 * resets, empties the field and turns the arrival gate back on, and nothing else
 * can put a saucer up. Each visit runs out on its own clock before the next is
 * brought on, and the whole gather runs undrawn but for the one still.
 */
export async function readEntryRows(
  h: Harness,
  still: string,
): Promise<EntryRow[]> {
  const rows: EntryRow[] = [];

  for (let game = 0; game < GAMES; game += 1) {
    openSaucerGame(h);
    let previous: number | null = null;
    for (let visit = 0; visit < ARRIVALS_PER_GAME; visit += 1) {
      if (previous !== null) {
        await h.quiet(async () => {
          await awaitDeparture(h, previous as number, STRIDE);
        });
      }
      const arrival = await closeUpArrival(h, previous);
      if (rows.length === 0) captureStill(h, still);
      rows.push({ game, id: arrival.saucer.id, y: arrival.saucer.y });
      previous = arrival.saucer.id;
    }
  }

  return rows;
}

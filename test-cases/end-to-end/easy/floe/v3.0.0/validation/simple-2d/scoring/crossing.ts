// scoring — the one arrangement every award in this group is read off.
//
// Five of the ten points here read what a COMPLETING HOP paid, and a completing
// hop is a hop up from row `2` into an open bay: specs/bays.md has "a crossing
// ends on the hop that lands the critter in an open bay, which is a hop up from
// row `2`". Row `2` is the top row of the WATER band (specs/strait.md) and a
// critter whose center no floe covers falls in on that very tick
// (specs/water.md), so the critter cannot simply be posed at a bay's mouth: it
// has to be standing on a floe there, and that floe is part of the situation the
// award is paid in rather than a bystander parked nearby.
//
// It is the SMALLEST floe the game has, a one-tile `pan`, laid by `poseLane`,
// which stops the lane before it adds anything, so the floe covers exactly the
// tile the critter stands on and holds still for as long as a check runs.
// Nothing else is put on the strait.
//
// Local to this group rather than on the shared harness because what these
// checks want from a completing hop is what it PAID, which is nobody else's
// reading. The bays group poses its own mouth for its own reason — whether the
// bay fills — and reads no score off it; this one carries the payment with it.

import { BAYS, WATER_TOP } from "../constants";
import { keyFor, poseLane, type FloeSnapshot, type Harness } from "../harness";

/**
 * The column a bay is entered from: its left column.
 *
 * Either of a bay's two columns would do — specs/strait.md gives each bay two
 * and specs/hopping.md accepts a hop onto either — and the checks here name one
 * so the tile they pose is the tile they read.
 */
export function bayColumn(bay: number): number {
  return BAYS[bay][0];
}

/** What one completing hop did: the score before it, after it, and the state it left. */
export interface CompletingHop {
  /** The score standing before the hop. */
  before: number;
  /** The score standing on the frame the hop landed. */
  after: number;
  /** What that hop paid: `after - before`. */
  paid: number;
  /** The state on the frame the hop landed, before anything ran on. */
  landed: FloeSnapshot;
}

/**
 * Stand the critter at the mouth of `bay` and take the hop that ends the
 * crossing there, reporting what that hop paid.
 *
 * The critter is put down with `addCritter`, which takes `bestRow` to the row it
 * lands on (specs/instrumentation.md), so the bay row is exactly one row above
 * every row the crossing has reached and the hop's own row award is the single
 * `SCORE_ROW` specs/scoring.md states — not a run of rows a pose skipped over.
 *
 * A REAL PRESS rather than a pose: the awards are consequences of the game's own
 * hop (specs/scoring.md), and posing the critter into a bay would pay none of
 * them. The reading is taken on the frame the hop landed, before anything runs
 * on, because the crossing timer goes back to `timerMax` when the next crossing
 * begins and a later reading would be of a different crossing.
 *
 * It poses nothing else. The level, the timer, the filled bays and the bonus
 * catch are the caller's, posed before it is called.
 */
export async function completingHop(
  h: Harness,
  bay: number,
): Promise<CompletingHop> {
  const col = bayColumn(bay);
  poseLane(h, WATER_TOP, "pan", [col]);
  h.debug.addCritter(col, WATER_TOP);

  const before = h.snapshot().score;
  await h.tap(keyFor("up"));
  const landed = h.snapshot();
  return { before, after: landed.score, paid: landed.score - before, landed };
}

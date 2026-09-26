// presentation/rank-drawn — a face-up card shows its rank.
//
// THE RULE. `specs/overview.md`'s legibility table, the row "A card face": "A
// face-up card's rank and its suit are drawn on it and legible at the logical
// stage size." So a player looking at a face-up card can see which rank it is.
//
// WHAT IT DECIDES, AND WHAT IT LEAVES ALONE. That the rank reaches the card's
// face. The SUIT is `presentation/suit-drawn`, that the card is drawn at all is
// `presentation/card-face-drawn`, and how legibly either is drawn is the
// reviewer's.
//
// HOW THE RANK IS READ, AND WHY NOT AS A GLYPH. The specification fixes no
// notation for a rank: `specs/deal.md` gives a rank as a whole number from
// `RANK_MIN` (`1`, the Ace) to `RANK_MAX` (`13`, the King) and names no label,
// and `specs/overview.md` leaves "the palette, the type, and every other aspect
// of the look" to the build. A build is free to write a seven as the numeral
// `7`, as seven pips, or as both, and a check that demanded the numeral would
// fail a card face drawn exactly as a real deck draws one. So what is read is
// the DIFFERENCE two cards make: the same suit is posed at two ranks, one after
// the other, at the same anchor, and the two frames are compared cell for cell
// over the card. Everything about the two frames is identical but the rank, so a
// build that paints its cards differently for the two has drawn the rank, in
// whatever notation it chose, and a build that paints them identically has not
// drawn it at all.
//
// THE TWO RANKS ARE ADJACENT, `7` and `8`, which is the hardest honest pair:
// they differ by one pip under a pip notation and by one glyph under a numeral,
// so a build that separates them separates every pair. A distant pair such as an
// Ace and a King would be passed by a build that drew a court card and nothing
// else.
//
// WHAT THE READING MEASURES: NOTHING BEYOND THE DIFFERENCE. The two frames pose
// the same card but for the one field under test, at the same anchor, and the
// same operations produce the same buffer, so a build that drew the two alike differs at NO
// cell at all and a build that drew them apart differs at exactly the cells the
// mark covers. Any difference is therefore the mark, and no threshold is needed
// or stated. How large the mark is, how much of the card it covers and how far it
// reads from the face behind it are appearance, which the reviewer judges.
//
// THE FACE IS READ AT UNIT PITCH rather than on a coarser grid, because a mark a
// build draws in thin strokes is a mark a coarse grid can step over entirely,
// reporting a hairline glyph exactly as it reports no glyph at all.
//
// THE WORLD IT POSES. `openTable` empties all thirteen piles, and one card at a
// time is put on foundation `0`, which is squared, so the card's top-left is the
// anchor and nothing about the column fan enters the reading.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import { FOUNDATION_X, TOP_ROW_Y } from "../constants";
import {
  captureStill,
  card,
  createHarness,
  openTable,
  type CardSpec,
  type Harness,
} from "../harness";
import {
  cardInterior,
  differingCells,
  sampleUnitGrid,
  unitGrid,
} from "./reading";

/** The two cards posed: one suit, two adjacent ranks. */
const LOWER = card("7S");
const HIGHER = card("8S");

/** The pile they are posed on, and the anchor specs/table.md fixes for it. */
const FOUNDATION = 0;
const ANCHOR_X = FOUNDATION_X[FOUNDATION];
const ANCHOR_Y = TOP_ROW_Y;

/**
 * The card's face, sampled to the unit.
 *
 * What this point looks for is a MARK — the part of the face two ranks are drawn
 * differently over — and a mark a build draws in thin strokes is a mark a coarser
 * grid resolves badly and can step over; `presentation/reading.ts` sets that out
 * at length under {@link unitGrid}.
 */
const FACE = unitGrid(cardInterior(ANCHOR_X, ANCHOR_Y));

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("draws a face-up card's rank on it", async () => {
  await openTable(h);

  const drawnAs = async (spec: CardSpec) => {
    await h.debug.clearPile("foundation", FOUNDATION);
    await h.debug.addCard("foundation", FOUNDATION, spec.suit, spec.rank, true);
    await h.advance(1);
    return sampleUnitGrid(h, FACE);
  };

  const lower = await drawnAs(LOWER);
  const higher = await drawnAs(HIGHER);
  await captureStill(h, "rank");

  const marked = differingCells(lower, higher).length;
  assertGreaterThan(
    marked,
    0,
    "the seven and the eight of spades drawn differently somewhere on the " +
      "card's face (specs/overview.md: a face-up card's rank is drawn on it " +
      "and legible at the logical stage size) — the two were drawn " +
      `differently at ${String(marked)} of ${String(FACE.cells)} sampled ` +
      "points",
  );
});

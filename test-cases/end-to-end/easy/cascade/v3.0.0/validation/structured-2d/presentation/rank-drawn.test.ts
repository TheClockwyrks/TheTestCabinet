// presentation/rank-drawn — a face-up card shows its rank.
//
// THE RULE. specs/overview.md's legibility table, the row "A card face": "A
// face-up card's rank and its suit are drawn on it and legible at the logical
// stage size." So a player looking at a face-up card can see which rank it is.
//
// WHAT IT DECIDES, AND WHAT IT LEAVES ALONE. That the rank reaches the card's
// face. The SUIT is `presentation/suit-drawn`, the colour the two suit colours
// are told apart by is `presentation/red-black-distinct`, and that the card is
// drawn at all is `presentation/card-face-drawn`.
//
// HOW THE RANK IS READ, AND WHY NOT AS A GLYPH. The specification fixes no
// notation for a rank: specs/deal.md gives a rank as a whole number from
// `RANK_MIN` (`1`, the Ace) to `RANK_MAX` (`13`, the King) and names no label,
// and specs/overview.md leaves the palette, the type and every other aspect of
// the look to the build. A build is free to write a seven as the numeral `7`, as
// seven pips, or as both, and a check that demanded the numeral would fail a
// card face drawn exactly as a real deck draws one. So what is read is the
// DIFFERENCE two cards make: the same suit is posed at two ranks, one after the
// other, at the same anchor, and the two frames are compared cell for cell over
// the card. Everything about the two frames is identical but the rank, so a
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
// THE WORLD IT POSES. `openTable` empties all thirteen piles, and one card at a
// time is put on foundation `0`, which is squared, so the card's top-left is the
// anchor and nothing about the column fan enters the reading.

import { afterEach, beforeEach, it } from "vitest";
import { FOUNDATION_X, TOP_ROW_Y } from "../../src/constants";
import { assertGreaterThanOrEqual } from "../assert";
import {
  captureStill,
  card,
  createHarness,
  EIGHT,
  openTable,
  poseCard,
  SEVEN,
  type CardSpec,
  type Harness,
} from "../harness";
import { CARD_COLS, CARD_ROWS, cardSamples, differingCells } from "./reading";

/** The two cards posed: one suit, two adjacent ranks. */
const LOWER = card("spades", SEVEN, true);
const HIGHER = card("spades", EIGHT, true);

/** The pile they are posed on, and the anchor specs/table.md fixes for it. */
const FOUNDATION = 0;
const ANCHOR_X = FOUNDATION_X[FOUNDATION];
const ANCHOR_Y = TOP_ROW_Y;

/**
 * How far apart two samples of the same point must be painted before the point
 * counts as drawn differently, in RGB distance out of `441`.
 *
 * `30` is under a fifteenth of the scale: far enough to be a mark rather than
 * the anti-aliased edge of one, and far below anything a rank drawn "legible at
 * the logical stage size" (specs/overview.md) is drawn at against its own card.
 */
const MARK_INK = 30;

/**
 * How much of a card's interior the two ranks must be drawn differently over, as
 * a share of it.
 *
 * specs/overview.md requires the rank to be "legible at the logical stage size",
 * and gives no size for it. `1%` of the `84 x 124` interior is about `104`
 * square units — a mark some `10 x 10` units across on a `1280 x 720` stage,
 * which is the floor below which nothing is legible at all. It is a floor and
 * not a target: a corner index alone runs to several times it.
 */
const MARK_SHARE = 0.01;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws a face-up card's rank on it", async () => {
  openTable(h);

  const drawnAs = async (spec: CardSpec) => {
    h.debug.clearPile("foundation", FOUNDATION);
    poseCard(h, "foundation", FOUNDATION, spec);
    await h.drawFrame();
    return cardSamples(h, ANCHOR_X, ANCHOR_Y);
  };

  const lower = await drawnAs(LOWER);
  const higher = await drawnAs(HIGHER);
  captureStill(h, "rank");

  const marked = differingCells(lower, higher, MARK_INK).length;
  assertGreaterThanOrEqual(
    marked / (CARD_COLS * CARD_ROWS),
    MARK_SHARE,
    `the share of the card's face the ${String(LOWER.rank)} and the ` +
      `${String(HIGHER.rank)} of spades are drawn differently over, at ` +
      `${String(MARK_INK)} of 441 or more (specs/overview.md: a face-up ` +
      "card's rank is drawn on it and legible at the logical stage size) — " +
      `the two were drawn differently at ${String(marked)} of ` +
      `${String(CARD_COLS * CARD_ROWS)} sampled points`,
  );
});

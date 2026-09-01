// presentation/suit-drawn — a face-up card shows its suit.
//
// THE RULE. specs/overview.md's legibility table, the row "A card face": "A
// face-up card's rank and its suit are drawn on it and legible at the logical
// stage size." So a player looking at a face-up card can see which suit it is.
//
// WHAT IT DECIDES, AND WHAT IT LEAVES ALONE. That the suit reaches the card's
// face. The RANK is `presentation/rank-drawn`, and whether the two suit COLOURS
// can be told apart is `presentation/red-black-distinct`.
//
// THE TWO SUITS ARE OF ONE COLOUR, spades and clubs, and that is the whole
// design of this point. specs/deal.md makes hearts and diamonds red and spades
// and clubs black, so a build that draws nothing but the colour of a suit —
// every black card identical, every red card identical — draws a spade and a
// club the same way and fails here, while it passes `red-black-distinct`
// honestly. Posing a heart against a spade would have let the colour alone
// answer both points, and one defect would have been docked twice.
//
// HOW THE SUIT IS READ, AND WHY NOT AS A GLYPH. The specification fixes no
// notation for a suit: specs/deal.md names the four suits and specs/overview.md
// leaves the palette, the type and every other aspect of the look to the build,
// so a spade may be a character, a drawn path, or a pip repeated down the card.
// What is read is therefore the DIFFERENCE the two suits make: the same rank is
// posed as each of them, one after the other, at the same anchor, and the two
// frames are compared cell for cell over the card. Everything about the two
// frames is identical but the suit.
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
  openTable,
  poseCard,
  SEVEN,
  type CardSpec,
  type Harness,
} from "../harness";
import { FACE, cardFaceSamples, differingCells } from "./reading";

/** The two cards posed: one rank, two suits of the same colour. */
const SPADE = card("spades", SEVEN, true);
const CLUB = card("clubs", SEVEN, true);

/** The pile they are posed on, and the anchor specs/table.md fixes for it. */
const FOUNDATION = 0;
const ANCHOR_X = FOUNDATION_X[FOUNDATION];
const ANCHOR_Y = TOP_ROW_Y;

/**
 * How far apart two samples of the same point must be painted before the point
 * counts as drawn differently, in RGB distance out of `441`.
 *
 * `30` is under a fifteenth of the scale: far enough to be a mark rather than
 * the anti-aliased edge of one, and far below anything a suit drawn "legible at
 * the logical stage size" (specs/overview.md) is drawn at against its own card.
 */
const MARK_INK = 30;

/**
 * How much of a card's interior the two suits must be drawn differently over, as
 * a share of it.
 *
 * WHAT THIS FLOOR IS FOR, AND WHY IT IS NOT A GLYPH'S OWN SIZE. The two frames
 * pose the same rank at the same anchor and differ in nothing but the suit, and
 * the rendering is deterministic, so a build that drew the two suits alike
 * differs at NO cell at all. This floor is therefore not holding off noise —
 * there is none — it is deciding how small a difference stops counting as a mark
 * a player could read.
 *
 * What is measured is the difference between two suits rather than the size of
 * either, and that difference is a fraction of a symbol: a spade and a club set
 * some twenty units tall overlap over much of their outlines and part company over
 * a few tens of square units, and a build that draws its pip in one corner rather
 * than in two draws that difference once. `0.25%` of the `84 x 124` interior, read at
 * unit pitch, is about `26` square units — a mark some `5 x 5` units across —
 * which sits under that and far above nothing: a suit whose difference falls
 * through this floor is drawn too small to read at the logical stage size, which
 * is what specs/overview.md asks for. A floor set instead from a GLYPH's own area
 * would fail a build whose suits are perfectly legible and merely differ over less
 * of the card than another build's do. The `none` suite holds this item to the
 * same figure over the same lattice.
 */
const MARK_SHARE = 0.0025;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws a face-up card's suit on it", async () => {
  openTable(h);

  const drawnAs = async (spec: CardSpec) => {
    h.debug.clearPile("foundation", FOUNDATION);
    poseCard(h, "foundation", FOUNDATION, spec);
    await h.drawFrame();
    return cardFaceSamples(h, ANCHOR_X, ANCHOR_Y);
  };

  const spade = await drawnAs(SPADE);
  const club = await drawnAs(CLUB);
  captureStill(h, "suit");

  const marked = differingCells(spade, club, MARK_INK).length;
  assertGreaterThanOrEqual(
    marked / FACE.cells,
    MARK_SHARE,
    "the share of the card's face the seven of spades and the seven of clubs " +
      `are drawn differently over, at ${String(MARK_INK)} of 441 or more ` +
      "(specs/overview.md: a face-up card's suit is drawn on it and legible " +
      "at the logical stage size; the two suits are both black, so the colour " +
      `alone cannot answer this) — the two were drawn differently at ` +
      `${String(marked)} of ${String(FACE.cells)} sampled points`,
  );
});

// presentation/suit-drawn — a face-up card shows its suit.
//
// THE RULE. specs/overview.md's legibility table, the row "A card face": "A
// face-up card's rank and its suit are drawn on it and legible at the logical
// stage size." So a player looking at a face-up card can see which suit it is.
//
// WHAT IT DECIDES, AND WHAT IT LEAVES ALONE. That the suit reaches the card's
// face. The RANK is `presentation/rank-drawn`, and how the two suit COLOURS read
// against each other is the reviewer's.
//
// THE TWO SUITS ARE OF ONE COLOUR, spades and clubs, and that is the whole design
// of this point. specs/deal.md makes "Hearts and diamonds are red; spades and
// clubs are black", so a build that draws nothing but the colour of a suit —
// every black card identical, every red card identical — draws a spade and a club
// the same way and fails here. Posing a heart against a spade would have let the
// colour alone answer this, and the SYMBOL is what the row asks for.
//
// HOW THE SUIT IS READ, AND WHY NOT AS A GLYPH. The specification fixes no
// notation for a suit: specs/deal.md names the four suits and specs/overview.md
// leaves "the palette, the type, and every other aspect of the look" to the
// build, so a spade may be the character `♠`, a drawn path, or a pip repeated
// down the card. What is read is therefore the DIFFERENCE the two suits make: the
// same rank is posed as each of them, one after the other, at the same anchor,
// and the two frames are compared cell for cell over the card. Everything about
// the two frames is identical but the suit.
//
// WHAT THE READING MEASURES: NOTHING BEYOND THE DIFFERENCE. The two frames pose
// the same card but for the one field under test, at the same anchor, and the
// rendering is deterministic, so a build that drew the two alike differs at NO
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
  createHarness,
  drawFrame,
  openTable,
  posePile,
  type Harness,
} from "../harness";
import { FACE, cardFaceSamples, differingCells } from "./reading";

/** The two cards posed: one rank, two suits of the same colour. */
const SPADE = "7S";
const CLUB = "7C";

/** The pile they are posed on, and the anchor specs/table.md fixes for it. */
const FOUNDATION = 0;
const ANCHOR_X = FOUNDATION_X[FOUNDATION];
const ANCHOR_Y = TOP_ROW_Y;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws a face-up card's suit on it", async () => {
  openTable(h);

  const drawnAs = async (spec: string) => {
    h.debug.clearPile("foundation", FOUNDATION);
    posePile(h, "foundation", FOUNDATION, [spec]);
    await drawFrame(h);
    return cardFaceSamples(h, ANCHOR_X, ANCHOR_Y);
  };

  const spade = await drawnAs(SPADE);
  const club = await drawnAs(CLUB);
  captureStill(h, "suit");

  const marked = differingCells(spade, club).length;
  assertGreaterThan(
    marked,
    0,
    `the ${SPADE} and the ${CLUB} drawn differently somewhere on the card's ` +
      "face (specs/overview.md: a face-up card's suit is drawn on it and " +
      "legible at the logical stage size; the two suits are both black, so " +
      "the colour alone cannot answer this) — the two were drawn differently " +
      `at ${String(marked)} of ${String(FACE.cells)} sampled points`,
  );
});

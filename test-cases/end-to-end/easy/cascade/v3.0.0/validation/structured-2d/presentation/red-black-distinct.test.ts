// presentation/red-black-distinct — the red suits read apart from the black ones.
//
// THE RULE. specs/overview.md's legibility table, the row "Suit colour": "Hearts
// and diamonds are drawn in one colour and spades and clubs in another, and the
// two are told apart at a glance." A Klondike is played on colour — a column
// builds down in rank and alternates in colour (specs/tableau.md) — so a player
// who cannot see which colour a card is cannot see which moves are legal.
//
// WHAT IT DECIDES, AND WHAT IT LEAVES ALONE. The distance between the two
// colours. Whether the suit is drawn at all is `presentation/suit-drawn`, which
// poses two suits of the SAME colour so that neither point can answer the other.
//
// THE PALETTE IS THE BUILD'S. specs/overview.md fixes no colour and says so:
// the palette, the type and every other aspect of the look are the build's. So
// nothing here knows a hex value. What is measured is the distance between the
// colour a heart was drawn in and the colour a spade was drawn in, on the
// `0`–`441` RGB scale.
//
// HOW EACH SUIT'S COLOUR IS FOUND. The two cards are posed one after the other
// at the same anchor and the same rank, so the two frames are identical but for
// the suit. The cells where they were painted differently are the marks the suit
// itself made; on each side, the one of those cells furthest from the colour the
// card is mostly painted in is that side's INK. A cell where the heart carries
// ink and the spade carries its plain face holds the plain face on the spade's
// side, which is the colour the search moves away from, so what comes back from
// each side is the mark it really drew.
//
// A BUILD THAT DREW THE TWO SUITS IN ONE COLOUR reads a distance near zero here,
// whatever else it drew differently: the two inks it is holding against each
// other are then the same colour twice. That is the wrong model this point
// exists to name.
//
// THE WORLD IT POSES. `openTable` empties all thirteen piles, and one card at a
// time is put on foundation `0`, which is squared, so the card's top-left is the
// anchor and nothing about the column fan enters the reading.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, fail } from "../assert";
import { FOUNDATION_X, TOP_ROW_Y } from "../constants";
import {
  captureStill,
  card,
  colorDistance,
  createHarness,
  openTable,
  poseCard,
  SEVEN,
  type CardSpec,
  type Harness,
} from "../harness";
import {
  cardSamples,
  differingCells,
  furthestFrom,
  meanColor,
  showColor,
} from "./reading";

/** The two cards posed: one rank, one red suit and one black one. */
const RED = card("hearts", SEVEN, true);
const BLACK = card("spades", SEVEN, true);

/** The pile they are posed on, and the anchor specs/table.md fixes for it. */
const FOUNDATION = 0;
const ANCHOR_X = FOUNDATION_X[FOUNDATION];
const ANCHOR_Y = TOP_ROW_Y;

/** Where the evidence still puts the second card, beside the first. */
const BESIDE = 1;

/**
 * How far apart two samples of the same point must be painted before the point
 * counts as one the suit itself marked, in RGB distance out of `441`.
 *
 * `30` is under a fifteenth of the scale: far enough to be a mark rather than
 * the anti-aliased edge of one. It only decides WHICH cells the two inks are
 * looked for in; the bound this point asserts is stated below.
 */
const MARK_INK = 30;

/**
 * How far apart the two suit colours must read, in RGB distance out of `441`.
 *
 * The review item's own figure. specs/overview.md requires the two to be "told
 * apart at a glance" and fixes no colour, so the bar is what a measurement can
 * honestly call two colours rather than two shades of one: `90` is a fifth of
 * the scale, about the distance from a mid grey to a black, and comfortably
 * inside what any pair of colours a person would call red and black manages.
 * The `none` and `simple-2d` suites hold the same requirement to the same
 * figure.
 */
const APART_MIN = 90;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws a red suit and a black suit in colours a player tells apart", async () => {
  openTable(h);

  const drawnAs = async (spec: CardSpec) => {
    h.debug.clearPile("foundation", FOUNDATION);
    poseCard(h, "foundation", FOUNDATION, spec);
    await h.drawFrame();
    return cardSamples(h, ANCHOR_X, ANCHOR_Y);
  };

  const red = await drawnAs(RED);
  const black = await drawnAs(BLACK);

  // The colour a card is mostly painted in, taken over both frames, which is
  // what each side's ink is the furthest cell from.
  const face = meanColor([...red, ...black]);
  const marked = differingCells(red, black, MARK_INK);
  if (marked.length === 0) {
    fail(
      "the seven of hearts and the seven of spades to be drawn differently " +
        "somewhere on their face, so the colour each suit is drawn in can be " +
        "read at all (specs/overview.md: hearts and diamonds are drawn in one " +
        "colour and spades and clubs in another)",
      "the two cards were painted identically at every sampled point",
    );
  }

  const redInk = furthestFrom(red, marked, face);
  const blackInk = furthestFrom(black, marked, face);

  // The evidence, and nothing the readings above depend on: the two cards side
  // by side, which is the picture the review item asks for.
  h.debug.clearPile("foundation", FOUNDATION);
  poseCard(h, "foundation", FOUNDATION, RED);
  poseCard(h, "foundation", BESIDE, BLACK);
  await h.drawFrame();
  captureStill(h, "suits");

  assertGreaterThanOrEqual(
    colorDistance(redInk, blackInk),
    APART_MIN,
    "the distance between the colour the seven of hearts was drawn in, " +
      `${showColor(redInk)}, and the colour the seven of spades was drawn in, ` +
      `${showColor(blackInk)}, out of 441 (specs/overview.md: the two are ` +
      "told apart at a glance)",
  );
});

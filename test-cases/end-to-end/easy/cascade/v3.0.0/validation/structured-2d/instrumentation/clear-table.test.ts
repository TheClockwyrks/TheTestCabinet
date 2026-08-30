// instrumentation/clear-table — every pile and the waste's memory go; the
// flyers and the gates stay.
//
// THE RULE. specs/instrumentation.md, under The cards: "`clearTable()` empties
// all thirteen piles and the waste's set memory, and it leaves the flyers, the
// painted layer, and every gate alone." It is the ground almost every
// mechanical scenario in this suite stands on — a table cleared, then exactly
// the cards the scenario is about posed back — so both halves matter: a build
// that leaves a card behind puts a bystander in every one of those scenarios,
// and a build that resets the gates while it is at it silently turns a faculty
// back on under a check that had turned it off.
//
// THE GATES ARE POSED TO A MIXED PATTERN, two off and two on, before the call.
// All four are on by default (specs/instrumentation.md), so a build that
// restored the defaults, or that set all four to one value, reads a different
// tuple; a pattern of all-off could not tell "left alone" from "turned off".
//
// THE FLYERS ARE READ BY IDENTITY AND POSITION, with no frame advanced between
// the call and the reading, so a build that emptied the flight — or rebuilt it —
// fails, and nothing the game's own cascade does can be mistaken for it.
//
// THE WASTE'S MEMORY IS READ SEPARATELY FROM THE WASTE'S CARDS, because they
// are two different things (specs/stock.md): a build that empties the pile and
// leaves a set behind reports a waste that shows cards it does not hold.
//
// THE PAINTED LAYER IS READ HERE TOO, because it is the third thing the rule's
// own sentence says the call leaves alone. So the flyers are flown for a moment
// with `trailPainting` on before the call, and the stamp count is read as
// non-zero going in and unchanged coming out: a layer with nothing on it would
// survive the call whatever the call did to it.
//
// EVERY PILE IS READ AS LOADED BEFORE THE CALL. A pile that was already empty is
// emptied by a call that does nothing, so a board that failed to pose would pass
// all thirteen readings; the same is true of a flight holding no cards and a set
// memory holding no sets. Each is therefore read going in as well as coming out.
//
// WHAT IT DOES NOT DECIDE. That ONE pile can be emptied on its own is
// `instrumentation/clear-pile`.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertLength,
} from "../assert";
import {
  ACE,
  COLUMNS,
  EIGHT,
  FIVE,
  FOUNDATIONS,
  FOUR,
  JACK,
  KING,
  NINE,
  QUEEN,
  SEVEN,
  SIX,
  TEN,
  THREE,
  TWO,
  captureStill,
  card,
  createHarness,
  framesFor,
  openTable,
  pileOf,
  poseColumn,
  poseFlyer,
  poseFoundation,
  poseStock,
  poseWaste,
  type Harness,
  type PileKind,
} from "../harness";

/** The three cards the waste holds, under two sets. */
const WASTE_CARDS = [
  card("hearts", TWO),
  card("clubs", FOUR),
  card("spades", SIX),
];
const WASTE_SETS = [1, 2];

/** The two cards the stock holds. */
const STOCK_CARDS = [card("diamonds", THREE), card("clubs", FIVE)];

/** A card for each of the seven columns. */
const COLUMN_CARDS = [
  card("spades", SEVEN),
  card("hearts", EIGHT),
  card("clubs", NINE),
  card("diamonds", TEN),
  card("spades", JACK),
  card("hearts", QUEEN),
  card("clubs", THREE),
];

/** The two cards in flight, which the call must leave alone. */
const FLYERS = [
  { spec: card("diamonds", KING), x: 320, y: 380, vx: 150, vy: -70 },
  { spec: card("clubs", QUEEN), x: 780, y: 440, vx: -130, vy: 40 },
];

/** The gates, posed to a mixed pattern so "left alone" reads apart from a reset. */
const POSED_GATES = {
  autoFlip: false,
  winDetect: true,
  launching: false,
  trailPainting: true,
} as const;

/**
 * How long the two cards are flown before the call, in frames.
 *
 * Long enough that a build painting its trail has put stamps on the layer, and
 * short enough that neither card has left the table. A tenth of a second carries
 * a card of this flight fifteen units.
 */
const PAINT_FRAMES = framesFor(0.1);

/** Every pile and index the board carries, so the reading walks all thirteen. */
const PILES: readonly { pile: PileKind; index: number }[] = [
  { pile: "stock", index: 0 },
  { pile: "waste", index: 0 },
  ...FOUNDATIONS.map((index) => ({ pile: "foundation" as PileKind, index })),
  ...COLUMNS.map((index) => ({ pile: "tableau" as PileKind, index })),
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("empties all thirteen piles and the set memory, and leaves the flyers and the gates", async () => {
  openTable(h);
  poseStock(h, STOCK_CARDS);
  poseWaste(h, WASTE_CARDS, WASTE_SETS);
  poseFoundation(h, 0, "spades", ACE);
  poseFoundation(h, 1, "hearts", ACE);
  poseFoundation(h, 2, "diamonds", ACE);
  poseFoundation(h, 3, "clubs", ACE);
  for (const column of COLUMNS) poseColumn(h, column, [COLUMN_CARDS[column]]);

  for (const flyer of FLYERS) {
    poseFlyer(h, flyer.spec, flyer.x, flyer.y, flyer.vx, flyer.vy);
  }
  h.debug.setAutoFlip(POSED_GATES.autoFlip);
  h.debug.setWinDetect(POSED_GATES.winDetect);
  h.debug.setLaunching(POSED_GATES.launching);
  h.debug.setTrailPainting(POSED_GATES.trailPainting);

  // The flight is run for a moment with `trailPainting` on, so the layer the
  // call must leave alone has something on it to leave.
  h.debug.setScreen("won");
  await h.advance(PAINT_FRAMES);

  const before = h.snapshot();

  for (const { pile, index } of PILES) {
    assertGreaterThan(
      pileOf(before, pile, index).length,
      0,
      `cards posed on the ${pile} pile ${index} before clearTable: a pile ` +
        "already empty is emptied by a call that does nothing",
    );
  }
  assertLength(
    before.wasteSets,
    WASTE_SETS.length,
    "the sets posed on the waste before clearTable, which the call has to " +
      "empty (specs/instrumentation.md)",
  );
  assertLength(
    before.flyers,
    FLYERS.length,
    "the cards posed in flight before clearTable, which the call has to " +
      "leave alone (specs/instrumentation.md)",
  );
  assertGreaterThan(
    before.trailStamps,
    0,
    "stamps the flight put on the painted layer before clearTable, which the " +
      "call has to leave alone (specs/instrumentation.md)",
  );

  h.debug.clearTable();
  const after = h.snapshot();

  await h.advance(1);
  captureStill(h, "cleared");

  for (const { pile, index } of PILES) {
    assertLength(
      pileOf(after, pile, index),
      0,
      `cards left on the ${pile} pile ${index} after clearTable: it empties ` +
        "all thirteen piles (specs/instrumentation.md)",
    );
  }
  assertLength(
    after.wasteSets,
    0,
    "entries left in the waste's set memory after clearTable, which empties " +
      "it with the piles (specs/instrumentation.md)",
  );

  assertDeepEqual(
    after.flyers,
    before.flyers,
    "the cards in flight after clearTable, which leaves the flyers alone " +
      "(specs/instrumentation.md)",
  );
  assertEqual(
    after.trailStamps,
    before.trailStamps,
    "stamps on the painted layer after clearTable, which leaves the painted " +
      "layer alone (specs/instrumentation.md)",
  );
  assertDeepEqual(
    {
      autoFlip: after.autoFlip,
      winDetect: after.winDetect,
      launching: after.launching,
      trailPainting: after.trailPainting,
    },
    POSED_GATES,
    "the four gates after clearTable, which leaves every gate alone " +
      "(specs/instrumentation.md)",
  );
});

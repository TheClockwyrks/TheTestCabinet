// instrumentation/snapshot-shape — `snapshot` reports every field the documented
// shape lists, with the documented type.
//
// specs/instrumentation.md "Snapshot shape" fixes the object `snapshot` returns
// exactly, and the reason it does is stated beside it: every field an operation can
// set is present, so every operation is verifiable by setting a value and reading
// it back. A field that is missing, or that reports a value of another type, takes
// the point the operation behind it would have decided with it.
//
// A SHAPE READ OFF A FULL BOARD, NOT AN EMPTY ONE. Nine of the fields are rosters
// or objects that are empty or null on a table nothing has happened to, and an
// empty roster says nothing about the shape of the entries it would hold. So the
// board this reads from carries cards in all four kinds of pile, a waste that
// remembers two sets, a run in hand held over a column that accepts it, a pointer
// that has pressed, and two cards in flight.
//
// WHAT IT DOES NOT DECIDE. Only the presence and the type of each field. Whether a
// value is the RIGHT one is the point of whichever item owns the rule behind it, so
// nothing here asserts a count, a position, a velocity or a set. The enumerations
// are held to their stated sets, `screen` and a pile's kind in
// specs/instrumentation.md and a suit and a color in specs/deal.md, because "a
// string" is not the documented type of any of them.
//
// NO FRAME RUNS BEFORE THE READING. Every one of the nine is posed, and a frame run
// between the pose and the read would let the cascade advance the flyers and the
// launch clock before the shape was taken. The one frame the still needs is run
// after the reading.

import { afterEach, beforeEach, it } from "vitest";
import { SUITS } from "../../src/constants";
import {
  assertContains,
  assertEqual,
  assertGreaterThan,
  assertHasProperty,
  assertLength,
  assertNotNull,
} from "../assert";
import {
  captureStill,
  cardCenter,
  cardTopLeft,
  createHarness,
  openTable,
  poseColumn,
  poseFoundation,
  posePile,
  poseWaste,
  pressPoint,
  type CardSnapshot,
  type Harness,
} from "../harness";

/** The four screens and the two colors specs/instrumentation.md enumerates. */
const SCREENS = ["title", "howto", "playing", "won"] as const;
const COLORS = ["red", "black"] as const;

/** The piles a run can be lifted from and dropped onto (specs/instrumentation.md). */
const SOURCE_PILES = ["waste", "foundation", "tableau"] as const;
const TARGET_PILES = ["foundation", "tableau"] as const;

/** The stock and the foundation posed, so both roster kinds carry entries. */
const STOCK = ["#2C", "#3C"];
const FOUNDATION_UP_TO = 3;

/** The waste posed, and the two sets it remembers: five cards, three showing. */
const WASTE = ["4H", "5H", "6H", "7H", "8H"];
const WASTE_SETS = [2, 3];

/**
 * The two columns the held run is arranged out of.
 *
 * specs/tableau.md: a column whose lowest card is a black King accepts a run led by
 * a red Queen, so a Queen of hearts carried over the King of clubs' column has a
 * drop target and `dropTarget` is not null.
 */
const TARGET_COLUMN = 0;
const TARGET_CARD = "KC";
const SOURCE_COLUMN = 1;
const SOURCE_CARD = "QH";

/** The two cards in flight, posed apart so neither is the other. */
const FLYERS = [
  { suit: "spades", rank: 13, x: 120, y: 240, vx: 30, vy: -60 },
  { suit: "diamonds", rank: 7, x: 900, y: 300, vx: -40, vy: -90 },
] as const;

/** Every field a card carries, held to its documented type. */
function assertCardShape(card: CardSnapshot, where: string): void {
  assertEqual(typeof card.id, "number", `${where}: id`);
  assertContains(SUITS, card.suit, `${where}: suit`);
  assertEqual(typeof card.rank, "number", `${where}: rank`);
  assertContains(COLORS, card.color, `${where}: color`);
  assertEqual(typeof card.faceUp, "boolean", `${where}: faceUp`);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports every documented field, with its documented type", async () => {
  openTable(h);

  // Cards in all four kinds of pile, and a waste that remembers two sets.
  posePile(h, "stock", 0, STOCK);
  poseWaste(h, WASTE, WASTE_SETS);
  poseFoundation(h, 0, "spades", FOUNDATION_UP_TO);
  poseColumn(h, TARGET_COLUMN, [TARGET_CARD]);
  poseColumn(h, SOURCE_COLUMN, [SOURCE_CARD]);

  // Two cards in flight, so `flyers` is not the empty array.
  for (const flyer of FLYERS) {
    h.debug.addFlyer(
      flyer.suit,
      flyer.rank,
      flyer.x,
      flyer.y,
      flyer.vx,
      flyer.vy,
    );
  }

  // A run in hand, held over the column that accepts it, so `drag`, `dropTarget`,
  // `pointer` and `lastPress` all carry something. The press is on the Queen's own
  // card and the pointer is then carried to the King's, which is the gesture
  // specs/controls.md describes.
  const grab = pressPoint(h.snapshot(), "tableau", SOURCE_COLUMN, 0);
  h.debug.pointerDown(grab.x, grab.y);
  const over = cardTopLeft(h.snapshot(), "tableau", TARGET_COLUMN, 0);
  const carry = cardCenter(over.x, over.y);
  h.debug.pointerMove(carry.x, carry.y);

  const s = h.snapshot();

  // The board every reported field was read from.
  await h.advance(1);
  captureStill(h, "posed");

  // ---- The scalars ------------------------------------------------------

  assertEqual(typeof s.version, "number", "version");
  assertContains(SCREENS, s.screen, "screen");
  assertEqual(typeof s.dealMode, "string", "dealMode");
  assertEqual(typeof s.turnCount, "number", "turnCount");
  assertEqual(typeof s.dealModeLabel, "string", "dealModeLabel");
  assertEqual(typeof s.muted, "boolean", "muted");

  assertEqual(typeof s.autoFlip, "boolean", "autoFlip");
  assertEqual(typeof s.winDetect, "boolean", "winDetect");
  assertEqual(typeof s.launching, "boolean", "launching");
  assertEqual(typeof s.trailPainting, "boolean", "trailPainting");

  assertEqual(typeof s.launchClock, "number", "launchClock");
  assertEqual(typeof s.launched, "number", "launched");
  assertEqual(typeof s.cascadeDone, "boolean", "cascadeDone");
  assertEqual(typeof s.trailStamps, "number", "trailStamps");
  assertEqual(typeof s.simTime, "number", "simTime");

  // ---- The thirteen piles -----------------------------------------------

  assertGreaterThan(s.stock.length, 0, "stock, on a board carrying cards");
  assertGreaterThan(s.waste.length, 0, "waste, on a board carrying cards");
  assertLength(s.foundations, 4, "foundations, one entry per foundation");
  assertLength(s.tableau, 7, "tableau, one entry per column");
  assertGreaterThan(
    s.foundations[0].length,
    0,
    "the posed foundation, on a board carrying cards",
  );
  assertGreaterThan(
    s.tableau[TARGET_COLUMN].length,
    0,
    "the posed column, on a board carrying cards",
  );

  for (const card of s.stock) assertCardShape(card, "a stock card");
  for (const card of s.waste) assertCardShape(card, "a waste card");
  for (const pile of s.foundations) {
    for (const card of pile) assertCardShape(card, "a foundation card");
  }
  for (const pile of s.tableau) {
    for (const card of pile) assertCardShape(card, "a tableau card");
  }

  assertGreaterThan(
    s.wasteSets.length,
    0,
    "wasteSets, on a waste that has been turned",
  );
  for (const count of s.wasteSets) {
    assertEqual(typeof count, "number", "an entry of wasteSets");
  }
  assertEqual(typeof s.wasteVisibleCount, "number", "wasteVisibleCount");

  // ---- The run in hand and its target -----------------------------------

  assertNotNull(
    s.drag,
    "drag, with a run in hand: a press on a column's face-up card lifts it " +
      "(specs/controls.md)",
  );
  if (s.drag !== null) {
    assertGreaterThan(s.drag.cards.length, 0, "drag.cards");
    for (const card of s.drag.cards) assertCardShape(card, "a held card");
    assertContains(SOURCE_PILES, s.drag.fromPile, "drag.fromPile");
    assertEqual(typeof s.drag.fromIndex, "number", "drag.fromIndex");
    assertEqual(typeof s.drag.x, "number", "drag.x");
    assertEqual(typeof s.drag.y, "number", "drag.y");
  }

  assertNotNull(
    s.dropTarget,
    "dropTarget, with a red Queen held over a black King's column, which " +
      "accepts it (specs/tableau.md)",
  );
  if (s.dropTarget !== null) {
    assertContains(TARGET_PILES, s.dropTarget.pile, "dropTarget.pile");
    assertEqual(typeof s.dropTarget.index, "number", "dropTarget.index");
  }

  // ---- The pointer ------------------------------------------------------

  assertHasProperty(s, "pointer", "pointer");
  assertEqual(typeof s.pointer.x, "number", "pointer.x");
  assertEqual(typeof s.pointer.y, "number", "pointer.y");
  assertEqual(typeof s.pointer.down, "boolean", "pointer.down");

  assertNotNull(s.lastPress, "lastPress, after a press");
  if (s.lastPress !== null) {
    assertEqual(typeof s.lastPress.x, "number", "lastPress.x");
    assertEqual(typeof s.lastPress.y, "number", "lastPress.y");
    assertEqual(typeof s.lastPress.at, "number", "lastPress.at");
  }

  // ---- The cascade ------------------------------------------------------

  assertLength(s.flyers, FLYERS.length, "flyers, with two cards in flight");
  for (const flyer of s.flyers) {
    assertEqual(typeof flyer.id, "number", "a flyer's id");
    assertContains(SUITS, flyer.suit, "a flyer's suit");
    assertEqual(typeof flyer.rank, "number", "a flyer's rank");
    assertEqual(typeof flyer.x, "number", "a flyer's x");
    assertEqual(typeof flyer.y, "number", "a flyer's y");
    assertEqual(typeof flyer.vx, "number", "a flyer's vx");
    assertEqual(typeof flyer.vy, "number", "a flyer's vy");
  }
});

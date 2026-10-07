// automove/picks-the-right-foundation — the card lands on its own suit's foundation.
//
// specs/foundations.md: a card belongs on the foundation already holding the
// next-lower card of its OWN suit; a foundation that holds cards is locked to that
// suit and refuses a card of any other; and every card belongs on at most one
// foundation. Any suit may be started on any empty foundation, so the suits are not
// tied to fixed slots.
// specs/instrumentation.md: `autoMove` sends the playable card to the foundation it
// belongs on.
//
// THE POSE IS BUILT SO EVERY WRONG MODEL LANDS ON A DIFFERENT SLOT. Three
// foundations are started and the hearts one is deliberately not the slot any
// shortcut would reach: spades sit on slot 0 built to their four, clubs on slot 1
// built to their seven, hearts on slot 2 built to their four, and slot 3 is left
// empty. The five of hearts is then the only card in play, and:
//
//   * a build that takes the first foundation whose top card is one rank lower,
//     ignoring the suit lock, puts it on slot 0, whose four of SPADES is also one
//     rank lower;
//   * a build that indexes foundations by the suit order specs/deal.md builds a deck
//     in — spades, hearts, diamonds, clubs — puts it on slot 1;
//   * a build that takes the first foundation, or the first EMPTY one, puts it on
//     slot 0 or slot 3.
//
// Only a build that looks for the foundation holding the four of HEARTS puts it on
// slot 2. All four foundations are read afterwards, so a wrong slot names itself.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  card,
  createHarness,
  FIVE,
  FOUR,
  openTable,
  poseColumn,
  poseFoundation,
  SEVEN,
  type Harness,
} from "../harness";
import { pileText } from "./board";

/** The three started foundations: the suit each slot holds, and to what rank. */
const SPADES = { slot: 0, suit: "spades", upTo: FOUR } as const;
const CLUBS = { slot: 1, suit: "clubs", upTo: SEVEN } as const;
const HEARTS = { slot: 2, suit: "hearts", upTo: FOUR } as const;
/** The slot left empty, which by specs/foundations.md accepts an Ace alone. */
const EMPTY_SLOT = 3;
/** The column the card waits in. */
const COLUMN = 4;
/** The card in play: one rank above the hearts foundation's top, and of its suit. */
const CARD = card(HEARTS.suit, FIVE);
const CARD_TEXT = "5H";
/** The three started foundations as they must read once the call has returned. */
const HEARTS_HOME = ["AH", "2H", "3H", "4H", CARD_TEXT];
const SPADES_HOME = ["AS", "2S", "3S", "4S"];
const CLUBS_HOME = ["AC", "2C", "3C", "4C", "5C", "6C", "7C"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sends the card to the foundation already holding its suit", async () => {
  openTable(h);
  poseFoundation(h, SPADES.slot, SPADES.suit, SPADES.upTo);
  poseFoundation(h, CLUBS.slot, CLUBS.suit, CLUBS.upTo);
  poseFoundation(h, HEARTS.slot, HEARTS.suit, HEARTS.upTo);
  poseColumn(h, COLUMN, [CARD]);

  const went = h.debug.autoMove("tableau", COLUMN);
  const after = h.snapshot();
  await h.advance(1);
  captureStill(h, "home");

  assertEqual(
    went,
    true,
    `autoMove("tableau", ${COLUMN}) with ${CARD_TEXT} there and the hearts ` +
      "foundation holding the four of hearts (specs/instrumentation.md)",
  );
  assertDeepEqual(
    pileText(after.foundations[HEARTS.slot]),
    HEARTS_HOME,
    `foundation ${HEARTS.slot}, the one already holding the suit ` +
      "(specs/foundations.md)",
  );
  assertDeepEqual(
    pileText(after.foundations[SPADES.slot]),
    SPADES_HOME,
    `foundation ${SPADES.slot}, which is locked to spades and so refuses a ` +
      "heart, its own four being one rank lower or not " +
      "(specs/foundations.md)",
  );
  assertDeepEqual(
    pileText(after.foundations[CLUBS.slot]),
    CLUBS_HOME,
    `foundation ${CLUBS.slot}, which is locked to clubs ` +
      "(specs/foundations.md)",
  );
  assertDeepEqual(
    pileText(after.foundations[EMPTY_SLOT]),
    [],
    `foundation ${EMPTY_SLOT}, which is empty and so accepts an Ace alone ` +
      "(specs/foundations.md)",
  );
});

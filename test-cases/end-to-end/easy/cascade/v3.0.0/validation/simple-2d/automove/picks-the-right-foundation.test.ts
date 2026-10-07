// automove/picks-the-right-foundation — the card lands on its own suit's foundation.
//
// specs/foundations.md: a card belongs on the foundation already holding the
// next-lower card of its OWN suit, a foundation that holds cards is locked to that
// suit, and every card belongs on at most one foundation. Any suit may be started on
// any empty foundation, so the suits are not tied to fixed slots.
// specs/instrumentation.md: `autoMove` sends the playable card to the foundation it
// belongs on.
//
// THE POSE IS BUILT SO EVERY WRONG MODEL LANDS SOMEWHERE ELSE. Three foundations are
// started, and the hearts one is deliberately NOT the slot a build would pick by
// counting suits: spades sit on slot 0, clubs on slot 1, hearts on slot 2, and slot
// 3 is empty. The five of hearts is then the only card in play. A build that indexes
// foundations by suit order puts it on slot 1, one that takes the first foundation
// puts it on slot 0, and one that takes the first EMPTY foundation puts it on slot 3.
// Only a build that looks for the foundation holding the four of hearts puts it on
// slot 2.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  pileSpecs,
  poseColumn,
  poseFoundation,
  type Harness,
} from "../harness";

/** The three started foundations: the suit each slot holds, and to what rank. */
const SPADES = { slot: 0, upTo: 3 } as const;
const CLUBS = { slot: 1, upTo: 7 } as const;
const HEARTS = { slot: 2, upTo: 4 } as const;
/** The slot left empty, which by specs/foundations.md accepts an Ace alone. */
const EMPTY_SLOT = 3;
/** The column the card waits in. */
const COLUMN = 4;
/** The card in play: one rank above the hearts foundation's top, and of its suit. */
const CARD = "5H";
/** The hearts foundation as it must read once the card has joined it. */
const HEARTS_HOME = ["AH", "2H", "3H", "4H", CARD];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sends the card to the foundation already holding its suit", async () => {
  openTable(h);
  poseFoundation(h, SPADES.slot, "spades", SPADES.upTo);
  poseFoundation(h, CLUBS.slot, "clubs", CLUBS.upTo);
  poseFoundation(h, HEARTS.slot, "hearts", HEARTS.upTo);
  poseColumn(h, COLUMN, [CARD]);

  const went = h.debug.autoMove("tableau", COLUMN);
  const after = h.snapshot();
  await h.advance(1);
  captureStill(h, "home");

  assertEqual(
    went,
    true,
    `autoMove("tableau", ${COLUMN}) with ${CARD} there and the hearts ` +
      "foundation holding the four of hearts (specs/instrumentation.md)",
  );
  assertDeepEqual(
    pileSpecs(after.foundations[HEARTS.slot]),
    HEARTS_HOME,
    `foundation ${HEARTS.slot}, the one already holding the suit ` +
      "(specs/foundations.md)",
  );
  assertDeepEqual(
    pileSpecs(after.foundations[SPADES.slot]),
    ["AS", "2S", "3S"],
    `foundation ${SPADES.slot}, which is locked to spades ` +
      "(specs/foundations.md)",
  );
  assertDeepEqual(
    pileSpecs(after.foundations[CLUBS.slot]),
    ["AC", "2C", "3C", "4C", "5C", "6C", "7C"],
    `foundation ${CLUBS.slot}, which is locked to clubs ` +
      "(specs/foundations.md)",
  );
  assertDeepEqual(
    pileSpecs(after.foundations[EMPTY_SLOT]),
    [],
    `foundation ${EMPTY_SLOT}, which is empty and so accepts an Ace alone ` +
      "(specs/foundations.md)",
  );
});

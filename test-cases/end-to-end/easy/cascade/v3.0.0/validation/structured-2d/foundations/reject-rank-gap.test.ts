// foundations/reject-rank-gap — a foundation refuses a rank gap.
//
// specs/foundations.md: a foundation whose top card is rank `r` of suit `s` accepts
// the card of rank `r + 1` of that suit, and refuses every other card offered to it.
// A foundation builds one suit UPWARD, one rank at a time.
// specs/instrumentation.md: a refused `move` returns `false` and leaves the board
// unchanged.
//
// THE DISTINGUISHING RANK. The spade foundation is built to its five and the seven
// of spades is offered: the right suit, the right direction, and exactly one rank
// too far. A build that tests only `card.rank > top.rank` accepts it, and so does
// one that tests the suit alone; a build comparing against `r + 1` refuses it. The
// six of spades is nowhere on the table, so the gap cannot be closed by another card
// going first.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  card,
  createHarness,
  FIVE,
  openTable,
  poseColumn,
  poseFoundation,
  SEVEN,
  type Harness,
} from "../harness";
import { boardText } from "./board";

/** The started foundation, its suit, and the rank it is built to. */
const FOUNDATION = 0;
const FOUNDATION_SUIT = "spades";
const FOUNDATION_TOP_RANK = FIVE;
/** The column the skipping card waits in. */
const COLUMN = 2;
/** Two ranks above the foundation's top card, and of its suit. */
const SKIPPING = card(FOUNDATION_SUIT, SEVEN);
const SKIPPING_TEXT = "7S";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses a card two ranks above the foundation's top card", async () => {
  openTable(h);
  poseFoundation(h, FOUNDATION, FOUNDATION_SUIT, FOUNDATION_TOP_RANK);
  poseColumn(h, COLUMN, [SKIPPING]);
  const before = boardText(h.snapshot());

  const accepted = h.debug.move("tableau", COLUMN, 0, "foundation", FOUNDATION);
  const after = boardText(h.snapshot());
  await h.advance(1);
  captureStill(h, "refused");

  assertEqual(
    accepted,
    false,
    `move of ${SKIPPING_TEXT} onto the ${FOUNDATION_SUIT} foundation built ` +
      `to its ${FOUNDATION_TOP_RANK}, which accepts the next rank up and no ` +
      "other (specs/foundations.md)",
  );
  assertDeepEqual(
    after,
    before,
    "the board after the refused move: the skipped rank is still in its " +
      "column (specs/instrumentation.md)",
  );
});

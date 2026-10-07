// automove/obeys-rank — an auto-move obeys the foundation's rank rule.
//
// specs/foundations.md: a foundation whose top card is rank `r` of suit `s` accepts
// the card of rank `r + 1` and suit `s`, and refuses every other card offered to it.
// specs/instrumentation.md: `autoMove` sends the playable card home only when that
// is legal, and returns `false` when nothing moved.
//
// THE DISTINGUISHING RANK. The spades foundation is built to its three and the five
// of spades waits in a column: the right suit, the right direction, and exactly one
// rank too high. A build that checks the suit alone sends it, and so does one that
// accepts any rank above the foundation's top; a build that compares against
// `r + 1` refuses it. The four of spades is nowhere on the table, so the refusal
// cannot be got right by accident through some other card going instead, and no
// empty foundation can take the five either, since an empty one takes an Ace alone.

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
  THREE,
  type Harness,
} from "../harness";
import { boardText } from "./board";

/** The started foundation, its suit, and the rank it is built to. */
const FOUNDATION = 0;
const FOUNDATION_SUIT = "spades";
const FOUNDATION_TOP_RANK = THREE;
/** The column the skipping card waits in. */
const COLUMN = 1;
/** Two ranks above the foundation's top, and of its suit. */
const SKIPPING = card(FOUNDATION_SUIT, FIVE);
const SKIPPING_TEXT = "5S";

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

  const went = h.debug.autoMove("tableau", COLUMN);
  const after = boardText(h.snapshot());
  await h.advance(1);
  captureStill(h, "unchanged");

  assertEqual(
    went,
    false,
    `autoMove("tableau", ${COLUMN}) with ${SKIPPING_TEXT} there and the ` +
      `spades foundation built to its ${FOUNDATION_TOP_RANK}, which accepts ` +
      "only the next rank up (specs/foundations.md)",
  );
  assertDeepEqual(
    after,
    before,
    "the board after the refused auto-move: the skipped rank is still out " +
      "(specs/instrumentation.md)",
  );
});

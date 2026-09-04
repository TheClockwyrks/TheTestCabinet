// tableau/reject-rank-gap — a column refuses a card that skips a rank.
//
// specs/tableau.md: a column whose lowest card is face-up, of rank `r` and color
// `c`, accepts a run led by a card of rank `r - 1` and the color other than `c`, and
// "refuses every other run offered to it". `r - 2` is not `r - 1`.
// specs/instrumentation.md: a refused `move` returns `false` and leaves the board
// unchanged.
//
// THE DISTINGUISHING CARD. The target's lowest card is the red nine and the card
// offered is the BLACK SEVEN: the alternating color, two ranks down. A build that
// asks only that the offered card be lower than the target's — the ordering without
// the step — accepts it, and every other item in this group offers a card such a
// build would refuse or accept alike. The black eight that lies between them is not
// on the table, so nothing can bridge the gap for it.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  poseColumn,
  type Harness,
} from "../harness";
import { boardSpecs } from "./board";

/** The column the card is offered to, holding one face-up card. */
const TARGET = 2;
/** Its lowest card: rank nine, red. */
const TARGET_LOWEST = "9H";
/** The column the offered card waits alone in. */
const SOURCE = 5;
/** TWO ranks lower than the target's card, in the alternating color. */
const OFFERED = "7S";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses a card two ranks lower, though its color alternates", async () => {
  openTable(h);
  poseColumn(h, TARGET, [TARGET_LOWEST]);
  poseColumn(h, SOURCE, [OFFERED]);
  const before = boardSpecs(h.snapshot());

  const accepted = h.debug.move("tableau", SOURCE, 0, "tableau", TARGET);
  const after = boardSpecs(h.snapshot());
  await h.advance(1);
  captureStill(h, "refused");

  assertEqual(
    accepted,
    false,
    `move of ${OFFERED} onto column ${TARGET}, whose lowest card is ` +
      `${TARGET_LOWEST}: two ranks lower, where the rule takes one ` +
      "(specs/tableau.md)",
  );
  assertDeepEqual(
    after,
    before,
    "the board after the refused move: the offered card is still alone in " +
      "its own column and the target still holds one card " +
      "(specs/tableau.md)",
  );
});

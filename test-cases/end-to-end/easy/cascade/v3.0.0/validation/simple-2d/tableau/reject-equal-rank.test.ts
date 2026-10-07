// tableau/reject-equal-rank — a column refuses a card of its own rank.
//
// specs/tableau.md: a column whose lowest card is face-up, of rank `r` and color
// `c`, accepts a run led by a card of rank `r - 1` and the color other than `c`, and
// "refuses every other run offered to it". `r` is not `r - 1`.
// specs/instrumentation.md: a refused `move` returns `false` and leaves the board
// unchanged.
//
// THE DISTINGUISHING CARD. The target's lowest card is the red nine and the card
// offered is the BLACK NINE: the alternating color, the same rank. A build that
// tests the color and forgets the rank altogether accepts it, and so does one that
// wrote its rank test as `<=` rather than the step down. Both read as an acceptance
// here and nowhere else in this group: every other card offered to a column in these
// items differs from the target's in rank as well.

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
/** The SAME rank as the target's card, in the alternating color. */
const OFFERED = "9S";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses a card of equal rank, though its color alternates", async () => {
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
      `${TARGET_LOWEST}: the same rank, where the rule takes the one below ` +
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

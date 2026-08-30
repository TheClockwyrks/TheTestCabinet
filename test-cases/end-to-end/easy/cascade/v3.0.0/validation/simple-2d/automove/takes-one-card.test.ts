// automove/takes-one-card — an auto-move takes one card and leaves the rest.
//
// specs/foundations.md: a foundation takes exactly one card at a time, and a run of
// two or more is refused even when its leading card alone would be accepted.
// specs/tableau.md: the cards above the one a move takes stay in the column, in
// their order and with their faces unchanged.
// specs/instrumentation.md: `autoMove` sends the named pile's PLAYABLE CARD, which
// in a column is its lowest face-up card.
//
// THE CARD ABOVE IS A TEMPTING ONE. The column holds the three of hearts with the
// two of spades below it, which is a run by specs/tableau.md: one rank lower, the
// opposite color. A build that lifts the whole face-up run rather than the one
// playable card carries the three of hearts along with it, and a build that walks
// the column upward sends the three of hearts instead. Either way the column does
// not read as it must here.

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

/** The started foundation and its top card. */
const FOUNDATION = 0;
const FOUNDATION_TOP = "AS";
/** The column in play. */
const COLUMN = 2;
/** The card that stays: drawn above the playable one, and in run order with it. */
const STAYS = "3H";
/** The column's lowest face-up card, which is the one the auto-move takes. */
const GOES = "2S";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sends the lowest face-up card alone and leaves the card above it", async () => {
  openTable(h);
  poseFoundation(h, FOUNDATION, "spades", 1);
  poseColumn(h, COLUMN, [STAYS, GOES]);

  const went = h.debug.autoMove("tableau", COLUMN);
  const after = h.snapshot();
  await h.advance(1);
  captureStill(h, "home");

  assertEqual(
    went,
    true,
    `autoMove("tableau", ${COLUMN}) with ${GOES} lowest in that column and ` +
      `${FOUNDATION_TOP} home (specs/instrumentation.md)`,
  );
  assertDeepEqual(
    pileSpecs(after.foundations[FOUNDATION]),
    [FOUNDATION_TOP, GOES],
    `foundation ${FOUNDATION}, which takes exactly one card at a time ` +
      "(specs/foundations.md)",
  );
  assertDeepEqual(
    pileSpecs(after.tableau[COLUMN]),
    [STAYS],
    `column ${COLUMN}: the card above the one taken stays, in its order and ` +
      "with its face unchanged (specs/tableau.md)",
  );
});

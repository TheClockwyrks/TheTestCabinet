// automove/illegal-does-nothing — an auto-move no foundation would accept changes
// nothing.
//
// specs/instrumentation.md: `autoMove` sends the playable card to the foundation it
// belongs on WHEN THAT IS LEGAL, and does nothing otherwise, returning `false` when
// nothing moved. specs/foundations.md: an empty foundation accepts an Ace and
// nothing else, and a foundation holding cards is locked to its own suit, so a card
// that is neither an Ace nor the successor of a started foundation's top belongs on
// no foundation at all.
//
// THE POSE. The spades foundation is started with its Ace, and the five of hearts
// waits alone in a column. Hearts is not started, so the only foundations that could
// take it are the three empty ones, and those take Aces alone. A build that dumps a
// refused card onto the first empty slot moves it and fails here; so does one that
// ignores the suit and stacks it on the spades foundation.
//
// WHAT "NOTHING" MEANS IS THE WHOLE BOARD, read before the call and again the
// instant it returns: the thirteen piles and the waste's set memory. A check that
// read the named column alone would pass a build that took the card and left it
// somewhere else.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  ACE,
  captureStill,
  card,
  createHarness,
  FIVE,
  openTable,
  poseColumn,
  poseFoundation,
  type Harness,
} from "../harness";
import { boardText } from "./board";

/** The one started foundation, and the suit it is locked to. */
const FOUNDATION = 0;
const FOUNDATION_SUIT = "spades";
const FOUNDATION_UP_TO = ACE;
/** The column the refused card waits in. */
const COLUMN = 2;
/** A card of an unstarted suit, and not an Ace: no foundation accepts it. */
const REFUSED = card("hearts", FIVE);
const REFUSED_TEXT = "5H";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses the auto-move and leaves the board exactly as it was", async () => {
  openTable(h);
  poseFoundation(h, FOUNDATION, FOUNDATION_SUIT, FOUNDATION_UP_TO);
  poseColumn(h, COLUMN, [REFUSED]);
  const before = boardText(h.snapshot());

  const went = h.debug.autoMove("tableau", COLUMN);
  const after = boardText(h.snapshot());
  await h.advance(1);
  captureStill(h, "unchanged");

  assertEqual(
    went,
    false,
    `autoMove("tableau", ${COLUMN}) with ${REFUSED_TEXT} there and no ` +
      "foundation able to accept it (specs/instrumentation.md)",
  );
  assertDeepEqual(
    after,
    before,
    "the board after a refused auto-move: nothing moved " +
      "(specs/instrumentation.md)",
  );
});

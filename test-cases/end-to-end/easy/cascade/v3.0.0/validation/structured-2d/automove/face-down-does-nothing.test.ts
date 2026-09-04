// automove/face-down-does-nothing — a column whose lowest card is face-down sends
// nothing.
//
// specs/instrumentation.md: a pile that holds no playable card sends nothing, and
// the list is explicit — an empty pile, A COLUMN WHOSE LOWEST CARD IS FACE-DOWN, and
// a foundation. `autoMove` returns `false` when nothing moved. specs/tableau.md: a
// face-down card is never moved and never read, and becomes playable only once it
// has been turned.
//
// TWO WRONG MODELS, AND EACH OF THEM MOVES A DIFFERENT CARD. The column holds the
// three of hearts over a face-down two of spades, and BOTH those cards have a
// foundation waiting: spades is built to its Ace and hearts to its two. So a build
// that never reads the face sends the two of spades home, and a build that reads
// past the face-down card to the lowest card that happens to be face-up sends the
// three of hearts home. Either one changes the board and fails here, and the
// failure names which card it moved. A build that reads the specification finds no
// playable card at all and sends nothing.
//
// THE READING IS TAKEN BEFORE ANY FRAME RUNS. The pose and the call both land at the
// call under this engine (specs/instrumentation.md), so the board is read the
// instant the call returns. The frame that follows is only there to draw the
// picture. Nothing is gated off: the automatic turn stays on, because the
// requirement is that this column gave it nothing to do.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  ACE,
  captureStill,
  card,
  createHarness,
  down,
  openTable,
  poseColumn,
  poseFoundation,
  THREE,
  TWO,
  type Harness,
} from "../harness";
import { boardText } from "./board";

/** The spades foundation, which would accept the face-down card were it face-up. */
const SPADES = { slot: 0, suit: "spades", upTo: ACE } as const;
/** The hearts foundation, which would accept the card ABOVE it. */
const HEARTS = { slot: 1, suit: "hearts", upTo: TWO } as const;
/** The column in play. */
const COLUMN = 1;
/** Its cards, top of the fan first: a face-up card over a face-down one. */
const ABOVE = card(HEARTS.suit, THREE);
const ABOVE_TEXT = "3H";
const LOWEST = down(card(SPADES.suit, TWO));
const LOWEST_TEXT = "#2S";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sends nothing when the column's lowest card is face-down", async () => {
  openTable(h);
  poseFoundation(h, SPADES.slot, SPADES.suit, SPADES.upTo);
  poseFoundation(h, HEARTS.slot, HEARTS.suit, HEARTS.upTo);
  poseColumn(h, COLUMN, [ABOVE, LOWEST]);
  const before = boardText(h.snapshot());

  const went = h.debug.autoMove("tableau", COLUMN);
  const after = boardText(h.snapshot());
  await h.advance(1);
  captureStill(h, "unchanged");

  assertEqual(
    went,
    false,
    `autoMove("tableau", ${COLUMN}), whose lowest card is ${LOWEST_TEXT}, ` +
      "face-down, so the column holds no playable card " +
      "(specs/instrumentation.md)",
  );
  assertDeepEqual(
    after,
    before,
    `the board after the call: ${LOWEST_TEXT} is still face-down in column ` +
      `${COLUMN} and ${ABOVE_TEXT} is still above it (specs/tableau.md)`,
  );
});

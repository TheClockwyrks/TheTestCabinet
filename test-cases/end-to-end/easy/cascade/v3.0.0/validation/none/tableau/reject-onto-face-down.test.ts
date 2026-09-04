// tableau/reject-onto-face-down — a column whose lowest card is face-down takes
// nothing.
//
// THE RULE. `specs/tableau.md`, the acceptance table: a column whose "lowest
// card is face-down" accepts "Nothing". The file says why: "A face-down card is
// never moved and is never read. It becomes playable only once it has been
// turned." So the column is closed until its card turns, whatever is offered to
// it.
//
// TWO CARDS, ONE FOR EACH WAY A BUILD CAN GET THIS WRONG. The column holds one
// card, the eight of hearts, face-down.
//
//   - The seven of spades is what a build that READ THE FACE-DOWN CARD would
//     take: one rank below the eight and the other color, which is exactly the
//     run the acceptance table's middle row admits for a face-up eight.
//   - The King of diamonds is what a build that treats a column it cannot read
//     as EMPTY would take, by the table's first row.
//
// A build with neither rule takes both and the column reads three cards; a build
// with one of them takes one and the column reads two, holding the card that
// names which model it implemented. Only the stated rule leaves the column
// holding its one face-down card, and the reading tells the three apart.
//
// The card stays face-down throughout, and that is asserted: `specs/tableau.md`
// gives the turn to an accepted move, and there is no accepted move here.
//
// The four faculty gates are left at their reset defaults, which are all on.
// That is deliberate rather than incidental: `autoFlip` turns a column's newly
// exposed card AFTER AN ACCEPTED MOVE, and no move here is accepted, so a build
// that turned this card has broken the rule `tableau/no-early-flip` and
// `instrumentation/auto-flip-gate-off` also grade.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  captureStill,
  card,
  createHarness,
  faceDown,
  openTable,
  pileOf,
  poseColumn,
  requireCard,
  whereIs,
  type Harness,
} from "../harness";

/** The closed column, holding one face-down card and nothing else. */
const TARGET = 0;
const BURIED = faceDown("8H");

/** The card a build that read the buried eight would take. */
const RUN_COLUMN = 1;
const RUN_CARD = card("7S");

/** The card a build that read the column as empty would take. */
const KING_COLUMN = 2;
const KING = card("KD");

/** Where each offered card sits in its own column, counted from the bottom. */
const SOURCE_ROW = 0;

/** One frame, so the still shows the board the two refusals left. */
const DRAW_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("refuses both a card that fits its buried rank and a King, and stays closed", async () => {
  await openTable(h);
  const [buriedId] = await poseColumn(h, TARGET, BURIED);
  const [runId] = await poseColumn(h, RUN_COLUMN, [RUN_CARD]);
  const [kingId] = await poseColumn(h, KING_COLUMN, [KING]);

  const runAccepted = await h.debug.move(
    "tableau",
    RUN_COLUMN,
    SOURCE_ROW,
    "tableau",
    TARGET,
  );
  const kingAccepted = await h.debug.move(
    "tableau",
    KING_COLUMN,
    SOURCE_ROW,
    "tableau",
    TARGET,
  );

  await h.advance(DRAW_FRAMES);
  await captureStill(h, "refused");
  const after = await h.snapshot();

  assertEqual(
    runAccepted,
    false,
    `move's verdict on the ${RUN_CARD.suit} 7 offered to a column whose only ` +
      "card is a face-down 8 — specs/tableau.md: such a column accepts " +
      "nothing, because a face-down card is never read",
  );
  assertEqual(
    kingAccepted,
    false,
    `move's verdict on the ${KING.suit} King offered to the same column — a ` +
      "column holding a face-down card is not an empty column",
  );
  assertLength(
    pileOf(after, "tableau", TARGET),
    1,
    `the cards in column ${TARGET} after both were offered to it — three is ` +
      "a build with no rule here at all, two is a build that either read the " +
      "buried card or mistook the column for an empty one",
  );
  assertEqual(
    requireCard(after, buriedId, "the buried card the column is closed by")
      .faceUp,
    false,
    `the face of the buried 8 (id ${buriedId}) after the two refusals — ` +
      "specs/tableau.md gives the turn to an accepted move, and neither move " +
      "was accepted",
  );
  assertDeepEqual(
    whereIs(after, runId),
    { pile: "tableau", index: RUN_COLUMN, row: 0 },
    `where the ${RUN_CARD.suit} 7 (id ${runId}) sits after its refusal — ` +
      "specs/tableau.md: a refused move changes nothing",
  );
  assertDeepEqual(
    whereIs(after, kingId),
    { pile: "tableau", index: KING_COLUMN, row: 0 },
    `where the ${KING.suit} King (id ${kingId}) sits after its refusal`,
  );
});

// instrumentation/move-accepts-legal — a move the rules accept returns `true` and
// is applied to the board.
//
// THE RULE. specs/instrumentation.md: `move(fromPile, fromIndex, fromRow,
// toPile, toIndex)` "Attempts a move and returns whether the rules accepted it",
// and "It returns `true` when the game's own rules accepted the move ... An
// accepted move applies through the same path a released drop uses, so a newly
// exposed column card turns and a completed board wins."
//
// WHY IT IS A `broken` POINT, AND WHY THE TWO VERDICTS ARE TWO POINTS. `move` is
// the operation this suite drives the rules through — the `tableau`,
// `foundations`, `runs` and `winning` groups all read their verdicts out of it —
// and the two ways it can be wrong are unrelated builds: one whose `move` always
// answers `true` is a different defect from one that always answers `false`, and
// every suite that poses a board with `move` stands on one direction or the
// other. `instrumentation/move-refuses-illegal` is the other half.
//
// THE MOVE IS THE ONE NO OTHER RULE BEARS ON: an Ace onto an EMPTY foundation,
// which specs/foundations.md accepts whatever the suit, so no ordering, colour
// or run rule is in play and the verdict is the whole of what is read.
//
// BOTH HALVES OF "ACCEPTED" ARE ASSERTED, because they fail differently: a build
// that answers `true` and applies nothing leaves the card where it was, and a
// build that applies the move and answers `false` fails the other point. So the
// card is read on the foundation and the column is read empty.
//
// WHAT THIS DOES NOT DECIDE. The rules themselves. Which cards a foundation
// accepts is `foundations/*`'s, which runs a column accepts is `tableau/*`'s, and
// what a whole run does when it moves is `runs/*`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  card,
  createHarness,
  openTable,
  pileOf,
  poseColumn,
  SEVEN,
  SIX,
  topOf,
  type Harness,
} from "../harness";

/** The column offered to, and the column the single card is lifted from. */
const TARGET_COLUMN = 0;
const SOURCE_COLUMN = 1;

/** The card standing on the target: a red seven, which takes a black six. */
const TARGET_CARD = card("hearts", SEVEN);

/** The card the rules accept, and the card they refuse: one rank, two colours. */
const LEGAL_CARD = card("spades", SIX);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns true for a legal move and applies it", async () => {
  openTable(h);
  poseColumn(h, TARGET_COLUMN, [TARGET_CARD]);
  const [movedId] = poseColumn(h, SOURCE_COLUMN, [LEGAL_CARD]);

  const verdict = h.debug.move(
    "tableau",
    SOURCE_COLUMN,
    0,
    "tableau",
    TARGET_COLUMN,
  );
  const after = h.snapshot();
  await h.advance(1);
  // Before the assertions, so a move that never applied still leaves the
  // picture of the board it left.
  captureStill(h, "board");

  assertEqual(
    verdict,
    true,
    `the verdict move() returned for the ${LEGAL_CARD.suit} six offered to ` +
      `the ${TARGET_CARD.suit} seven, one rank lower and the other colour, ` +
      "which a column accepts (specs/tableau.md)",
  );
  assertEqual(
    topOf(pileOf(after, "tableau", TARGET_COLUMN))?.id,
    movedId,
    `the card lowest on column ${TARGET_COLUMN} after the accepted move: an ` +
      "accepted move applies (specs/instrumentation.md)",
  );
  assertLength(
    pileOf(after, "tableau", SOURCE_COLUMN),
    0,
    `cards left on column ${SOURCE_COLUMN} after the accepted move`,
  );
});

// instrumentation/move-accepts-legal — a move the rules accept returns `true` and
// is applied to the board.
//
// THE RULE. `specs/instrumentation.md`: `move(fromPile, fromIndex, fromRow,
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
// which `specs/foundations.md` accepts whatever the suit, so no ordering, colour
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
  cardKey,
  createHarness,
  openTable,
  pileOf,
  poseColumn,
  topOf,
  type Harness,
} from "../harness";

/** The column and the foundation the accepted move runs between. */
const LEGAL_COLUMN = 0;
const LEGAL_FOUNDATION = 0;
const LEGAL_CARD = "AS";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns true for a legal move and applies it", async () => {
  await openTable(h);
  await poseColumn(h, LEGAL_COLUMN, [card(LEGAL_CARD)]);

  const accepted = await h.debug.move(
    "tableau",
    LEGAL_COLUMN,
    0,
    "foundation",
    LEGAL_FOUNDATION,
  );
  // Read before a frame runs: an accepted move applies at the call, so nothing
  // is waiting on an update.
  const applied = await h.snapshot();

  await h.advance(1);
  // Before the assertions, so a wrong verdict still leaves the picture of the
  // board the move left.
  await captureStill(h, "board");

  assertEqual(
    accepted,
    true,
    `the verdict move() returned on sending the ${LEGAL_CARD} from column ` +
      `${LEGAL_COLUMN} to the empty foundation ${LEGAL_FOUNDATION}, which ` +
      `accepts an Ace of any suit (specs/foundations.md)`,
  );
  const home = topOf(pileOf(applied, "foundation", LEGAL_FOUNDATION));
  assertEqual(
    home === undefined ? "no card" : cardKey(home),
    cardKey(card(LEGAL_CARD)),
    `the card on foundation ${LEGAL_FOUNDATION} once the move was accepted — ` +
      `an accepted move APPLIES (specs/instrumentation.md)`,
  );
  assertLength(
    pileOf(applied, "tableau", LEGAL_COLUMN),
    0,
    `the cards left in column ${LEGAL_COLUMN} once its only card went home`,
  );
});

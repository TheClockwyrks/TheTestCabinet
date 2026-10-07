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
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  pileOf,
  pileSpecs,
  poseColumn,
  type Harness,
} from "../harness";

/** The column the King of clubs waits on, and the column the Queen is offered from. */
const TARGET_COLUMN = 0;
const TARGET_CARD = "KC";
const SOURCE_COLUMN = 1;

/** The two Queens: the red one a black King accepts, the black one it refuses. */
const ACCEPTED_CARD = "QH";

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
  poseColumn(h, SOURCE_COLUMN, [ACCEPTED_CARD]);

  const accepted = h.debug.move(
    "tableau",
    SOURCE_COLUMN,
    0,
    "tableau",
    TARGET_COLUMN,
  );
  const after = h.snapshot();

  // The board after the accepted move.
  await h.advance(1);
  captureStill(h, "board");

  assertEqual(
    accepted,
    true,
    `move must return true for the ${ACCEPTED_CARD} onto the ${TARGET_CARD}, ` +
      "which the column accepts (specs/tableau.md)",
  );
  assertDeepEqual(
    pileSpecs(pileOf(after, "tableau", TARGET_COLUMN)),
    [TARGET_CARD, ACCEPTED_CARD],
    `tableau ${TARGET_COLUMN}, bottom card first, once the accepted move has ` +
      "applied (specs/instrumentation.md)",
  );
  assertLength(
    pileOf(after, "tableau", SOURCE_COLUMN),
    0,
    `tableau ${SOURCE_COLUMN}, which the moved card has left`,
  );
});

// tableau/build-down-alternating — a column takes the next card down in the other
// color.
//
// specs/tableau.md: a column whose lowest card is face-up, "of rank `r` and color
// `c`", accepts a run led by a card "of rank `r - 1` and the color other than `c`".
// specs/instrumentation.md: `move(fromPile, fromIndex, fromRow, toPile, toIndex)`
// attempts a move and returns `true` when the game's own rules accepted it; an
// accepted move applies through the same path a released drop uses.
//
// THE POSE. One face-up card lowest in the target column, one card alone in a source
// column, and nothing else anywhere, so the verdict can turn on nothing but the two
// cards' rank and color. Neither column holds a face-down card, so no turning rule
// is entangled with this one.
//
// THE DISTINGUISHING PAIR. A RED nine is offered a BLACK eight. That is the only
// pairing of the four this group asks about that the rule accepts: the same rank
// down in the same color (`reject-same-color`), a rank up (`reject-rank-higher`),
// a rank skipped (`reject-rank-gap`) and an equal rank (`reject-equal-rank`) each
// have their own item, and every one of them differs from this card in exactly one
// of the two properties the rule reads. A build that ignored color, or compared
// ranks the other way round, passes here and fails there; a build that refuses
// everything fails here alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  pileSpecs,
  poseColumn,
  type Harness,
} from "../harness";

/** The column the offered card lands on, holding one face-up card. */
const TARGET = 2;
/** Its lowest card: rank nine, red. */
const TARGET_LOWEST = "9H";
/** The column the offered card waits alone in. */
const SOURCE = 5;
/** One rank lower than the target's card, and the other color. */
const OFFERED = "8S";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("accepts a card one rank lower and the opposite color", async () => {
  openTable(h);
  poseColumn(h, TARGET, [TARGET_LOWEST]);
  poseColumn(h, SOURCE, [OFFERED]);

  const accepted = h.debug.move("tableau", SOURCE, 0, "tableau", TARGET);
  const after = h.snapshot();
  await h.advance(1);
  captureStill(h, "accepted");

  assertEqual(
    accepted,
    true,
    `move of ${OFFERED} onto column ${TARGET}, whose lowest card is ` +
      `${TARGET_LOWEST}: one rank lower, and the other color ` +
      "(specs/tableau.md)",
  );
  assertDeepEqual(
    pileSpecs(after.tableau[TARGET]),
    [TARGET_LOWEST, OFFERED],
    `column ${TARGET} after the move: the offered card is the column's new ` +
      "lowest card, beneath the one it landed on (specs/tableau.md)",
  );
  assertLength(
    after.tableau[SOURCE],
    0,
    `the cards left in column ${SOURCE}: the offered card has left it ` +
      "(specs/tableau.md)",
  );
});

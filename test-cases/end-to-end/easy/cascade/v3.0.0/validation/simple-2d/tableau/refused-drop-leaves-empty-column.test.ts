// tableau/refused-drop-leaves-empty-column — a non-King released over an empty
// column leaves it empty.
//
// specs/tableau.md: an empty column accepts a run led by a King and refuses every
// other run; and "a column that was empty when a run was refused by it is still
// empty", with every card the refused move carried back in the pile it was taken
// from, in the order it left.
// specs/controls.md: a drop resolves to the pile whose drop rectangle contains the
// center of the run's leading card, and where that pile refuses the run, "the run
// returns to the pile it was lifted from".
// specs/table.md: an empty column's drop rectangle is `CARD_W x CARD_H` at
// `(COLUMN_X[i], TABLEAU_Y)`.
//
// WHY THE POINTER AND NOT `move`. This item is the released DROP: the path where a
// run has already left its column and is in hand when the target refuses it, so a
// build that resolves the drop correctly but forgets to put the run back loses the
// card into the empty column, or off the table entirely. A `move` never lifts
// anything, and could not tell those apart.
//
// THE GESTURE IS READ WHILE IT IS IN HAND, because a build whose press lifts nothing
// would leave the empty column empty for the wrong reason and pass a check that only
// read the end. So the run in hand is read first, and only then the release.
//
// The release point is the empty column's drop rectangle's own center, and the run
// is grabbed at its card's center, so the leading card's center lands exactly there
// (specs/controls.md: the run keeps the offset between the press point and the
// leading card's top-left).

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength } from "../assert";
import {
  captureStill,
  cardSpec,
  createHarness,
  openTable,
  poseColumn,
  pressPoint,
  releasePoint,
  type Harness,
} from "../harness";
import { boardSpecs } from "./board";

/** The column left empty, which the card is released over. */
const TARGET = 0;
/** The column the card is lifted from. */
const SOURCE = 6;
/** The card dropped: a Queen, which is not a King. */
const DROPPED = "QH";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses a non-King dropped on an empty column and leaves it empty", async () => {
  openTable(h);
  poseColumn(h, SOURCE, [DROPPED]);
  const before = boardSpecs(h.snapshot());

  const from = pressPoint(h.snapshot(), "tableau", SOURCE, 0);
  const to = releasePoint(h.snapshot(), "tableau", TARGET);

  h.debug.pointerDown(from.x, from.y);
  const held = h.snapshot();
  h.debug.pointerMove(to.x, to.y);
  h.debug.pointerUp(to.x, to.y);
  const dropped = h.snapshot();
  const after = boardSpecs(dropped);
  await h.advance(1);
  captureStill(h, "refused");

  assertDeepEqual(
    (held.drag?.cards ?? []).map(cardSpec),
    [DROPPED],
    `the run in hand after pressing ${DROPPED} in column ${SOURCE}: the press ` +
      "lifts the card it landed on (specs/controls.md)",
  );
  assertLength(
    dropped.tableau[TARGET],
    0,
    `the cards in column ${TARGET} after the release over its drop ` +
      "rectangle: an empty column refuses everything but a King and is still " +
      "empty (specs/tableau.md)",
  );
  assertDeepEqual(
    after,
    before,
    `the board after the refused drop: ${DROPPED} is back in column ` +
      `${SOURCE}, face-up, exactly as it left (specs/tableau.md)`,
  );
});

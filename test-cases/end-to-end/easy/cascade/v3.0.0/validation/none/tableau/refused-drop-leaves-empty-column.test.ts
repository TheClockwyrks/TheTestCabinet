// tableau/refused-drop-leaves-empty-column — a non-King released over an empty
// column goes back where it came from.
//
// THE RULE, IN THREE FILES. `specs/table.md` fixes an empty column's drop
// rectangle as `CARD_W x CARD_H` at `(COLUMN_X[i], TABLEAU_Y)`.
// `specs/controls.md` resolves a drop to the pile whose rectangle contains the
// center of the run's leading card, and returns the run when that pile refuses
// it. `specs/tableau.md` has an empty column accept a run led by a King and
// refuse every other run, and says a column "that was empty when a run was
// refused by it is still empty".
//
// WHY THE POINTER RATHER THAN `move`. `tableau/reject-non-king-empty` already
// decides the rule through the surface's `move`; what is decided here is the
// state a refused DROP leaves — a build that resolves the release correctly and
// then loses the run, or leaves a ghost card standing on the column it was
// refused by, is a build a player cannot recover a card from. That defect exists
// only on the gesture path.
//
// THE POSE. Column 1 holds the Queen of hearts, one rank below a King and so the
// nearest card to legal that the rule still refuses; column 0 is empty because
// `openTable` cleared it, not because something was taken out of it. The Queen
// is pressed at its own center and carried until its center sits at the center
// of column 0's drop rectangle, `(274, 250)`, which is 122 units from the press
// and so far beyond `DRAG_THRESHOLD` (`5`): the gesture is a drop, not a click.
// `dragRunTo` measures the carry from the offset the build itself reports, so a
// build that holds the run at some other offset is still carried to the target
// the check named.
//
// WHAT IS READ: the empty column is still empty, the Queen is back in its own
// column in its own row, and nothing is left in hand. A build that took the
// Queen reads a card in column 0; a build that dropped it reads it in neither
// column; a build that never releases it reads a run still in hand.
//
// The four faculty gates are left at their reset defaults, which are all on. No
// move was accepted, so none of them has anything to do.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength, assertNull } from "../assert";
import {
  captureStill,
  card,
  cardCenter,
  columnCardTopLeft,
  createHarness,
  dragRunTo,
  dropRect,
  openTable,
  pileOf,
  poseColumn,
  rectCenter,
  whereIs,
  type Harness,
} from "../harness";

/** The empty column the Queen is released over. */
const EMPTY = 0;

/** The column the Queen is lifted from, and the card itself. */
const SOURCE = 1;
const QUEEN = card("QH");
/** Where the Queen sits in its column, counted from the bottom. */
const QUEEN_ROW = 0;
/** The faces that column is drawn with, which is what decides the fan's offsets. */
const SOURCE_FACES = [QUEEN.faceUp ?? true];

/** One frame, so the still shows the empty column and the Queen back home. */
const DRAW_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("refuses a Queen released over an empty column and returns it to its own", async () => {
  await openTable(h);
  const [queenId] = await poseColumn(h, SOURCE, [QUEEN]);

  const queenTopLeft = columnCardTopLeft(SOURCE, QUEEN_ROW, SOURCE_FACES);
  const press = cardCenter(queenTopLeft.x, queenTopLeft.y);
  const target = rectCenter(dropRect("tableau", EMPTY));

  await dragRunTo(h, press.x, press.y, target.x, target.y);

  await h.advance(DRAW_FRAMES);
  await captureStill(h, "refused");
  const after = await h.snapshot();

  assertLength(
    pileOf(after, "tableau", EMPTY),
    0,
    `the cards in column ${EMPTY} after the Queen was released with its ` +
      `center at (${target.x}, ${target.y}), inside that column's drop ` +
      "rectangle (specs/table.md) — specs/tableau.md: an empty column takes a " +
      "run led by a King and is still empty when it refuses one",
  );
  assertDeepEqual(
    whereIs(after, queenId),
    { pile: "tableau", index: SOURCE, row: QUEEN_ROW },
    `where the ${QUEEN.suit} Queen (id ${queenId}) sits after the refused ` +
      "drop — specs/controls.md returns a run the target refuses to the pile " +
      "it was lifted from. A reading of null is a build that lost the card off " +
      "the table",
  );
  assertLength(
    pileOf(after, "tableau", SOURCE),
    1,
    `the cards in column ${SOURCE}, which the Queen was lifted from and ` +
      "returned to",
  );
  assertNull(
    after.drag,
    "the run in hand once the release has been answered — the gesture ended " +
      "with the release (specs/controls.md)",
  );
});

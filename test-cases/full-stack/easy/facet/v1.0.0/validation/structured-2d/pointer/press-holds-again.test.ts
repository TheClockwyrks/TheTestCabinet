// Facet — pointer/press-holds-again: a press on the cell already held takes hold
// of it again, and withdraws whatever it was offered into.
//
// The SECOND row of specs/controls.md's press table, which states both halves as
// one sentence: "The selected cell — Leaves it selected and withdraws any
// standing offer, so the gem is taken hold of again where it started."
//
// TWO HALVES, ONE POINT, BECAUSE THE ROW IS ONE SENTENCE. They fail differently
// and they are repaired differently — a build that read the second press as a
// deselect fails on the selection, one that ignored the press entirely fails on
// the offer — but the specification does not offer a build the choice of honoring
// one of them, so the point is the row.
//
// WHY THE ROW EXISTS AT ALL. A move is a hold, and a player who has carried a gem
// onto a neighbor and wants to start again puts it back down where it began. If
// the second press deselected, that player would have to press twice to pick the
// same gem up; if it left the offer standing, the very next release would play a
// move the player had just taken back. So this row is what makes a hold
// recoverable, and it is read on a board where the standing offer is a
// PRODUCTIVE one — the release after it would be an accepted swap, not a
// refusal, so an offer this press failed to withdraw is a move waiting to happen
// rather than a harmless leftover.
//
// THE OFFER IS POSED RATHER THAN DRAGGED INTO PLACE. specs/instrumentation.md's
// `setOffer` makes `(col, row)` "the cell the selected gem is offered into" and
// leaves "the selection, the board, and the phase" where they were, requesting no
// swap — so the state this press is read against is arranged in one call and
// nothing of how a player reached it enters the reading. How a drag reaches it is
// `pointer/drag-offers`'s point, and how a drag withdraws it is
// `pointer/drag-back-withdraws`'s.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertNull,
  assertTrue,
} from "../assert";
import {
  areAdjacent,
  assertBoardEquals,
  hasAnyRun,
  quietRowsWithEscape,
  swapIsProductive,
  type CellRef,
  type PlacedToken,
} from "../board";
import {
  captureStill,
  createHarness,
  loadBoard,
  pressCell,
  type Harness,
} from "../harness";

/** Three rubies one exchange short of a run in row 4, clear of the filler's corner. */
const RUN_CELLS: readonly PlacedToken[] = [
  { col: 2, row: 4, token: "R0" },
  { col: 4, row: 4, token: "R0" },
  { col: 3, row: 3, token: "R0" },
];

/** The gem the player has hold of, and presses again. */
const HELD: CellRef = { col: 3, row: 3 };

/** The neighbor it stands offered into when that second press is made. */
const OFFERED: CellRef = { col: 3, row: 4 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps the gem held and withdraws the offer", async () => {
  const posed = quietRowsWithEscape(RUN_CELLS);
  assertEqual(hasAnyRun(posed), false, "a maximal run on the posed board");
  assertTrue(
    areAdjacent(HELD, OFFERED),
    "the offered cell is an orthogonal neighbor of the held one, which is the " +
      "only cell an offer can stand on",
  );
  assertTrue(
    swapIsProductive(posed, HELD, OFFERED),
    "the standing offer is an exchange R3 accepts, so an offer left standing " +
      "is a move the next release would play",
  );

  loadBoard(h, posed);
  h.debug.setSelection(HELD.col, HELD.row);
  h.debug.setOffer(OFFERED.col, OFFERED.row);

  const before = h.snapshot();
  assertDeepEqual(before.selection, HELD, "the gem the player has hold of");
  assertDeepEqual(before.offer, OFFERED, "the neighbor it is offered into");

  const again = pressCell(h, HELD);

  // The frame that draws the gem back where it started, and the picture of it.
  await h.advance(1);
  captureStill(h, "held");

  assertDeepEqual(
    again.selection,
    HELD,
    "the selection after pressing the cell already held",
  );
  assertNull(again.offer, "the offer the second press withdraws");
  assertBoardEquals(
    h.board(),
    posed,
    "the board, which taking hold of a gem again does not touch",
  );
  assertEqual(
    again.phase,
    "idle",
    "the phase, since withdrawing an offer requests no swap",
  );
});

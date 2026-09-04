// Facet — pointer/press-offers: a press on a neighbor of the held gem offers it
// into that cell, and plays nothing.
//
// The THIRD row of specs/controls.md's press table: "A cell orthogonally adjacent
// to the selected cell — Offers the selected gem into that cell." The sentence
// above the table makes the order part of the rule — "The rows below are
// evaluated in order, and the first row that matches is the one that applies" —
// so a gem is already held here, and the pressed cell is neither that cell nor
// far from it, which leaves this row and no other.
//
// AND NOTHING IS PLAYED. specs/controls.md is explicit about where a move enters
// the rules: "Nothing reaches the move rules until the pointer is released", and
// the release table gives the release with an offer standing the swap request. So
// what this press does is name the neighbor, leave the hold where it is, and stop
// there.
//
// THE EXCHANGE IS POSED PRODUCTIVE, AND THAT IS THE WHOLE DESIGN OF THE FIXTURE.
// A build that requests the swap on the press rather than on the release is only
// visible where the swap would be ACCEPTED: on a board where R3 would refuse the
// exchange, such a build leaves a refusal that looks much like nothing happening,
// and a check could read "the board stands" and pass it. Here the exchange
// completes a run of three, so a press that played it exchanges two cells and
// puts the game into `swapping` — which the readings below cannot miss.
//
// FOUR READINGS. The offer is the pressed cell; the selection has not moved,
// because this row offers rather than re-selects; all 64 cells stand as posed,
// because the exchange a player SEES while an offer stands is DRAWN rather than
// made — specs/ui.md has "the gem at `state.selection` and the gem at
// `state.offer` drawn exchanged, so a player sees the move a release would play",
// and specs/rules.md gives the exchange of the two cells to an accepted swap
// alone; and the phase is still `idle`, because no swap was requested.
//
// THE PRESS IS POSED THROUGH THE SURFACE. specs/instrumentation.md makes
// `pointerDown` drive "the same input path a real pointer drives" and resolve at
// the call, so a point about the press RULES reads the rule and nothing of a
// build's event plumbing or frame scheduling.

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

/**
 * Three rubies one exchange short of a run in row 4, clear of the filler's spare
 * corner swap.
 *
 * They are what make the exchange this check offers a PRODUCTIVE one, so a build
 * that plays the move on the press is caught by an accepted swap rather than
 * hidden behind a refusal.
 */
const RUN_CELLS: readonly PlacedToken[] = [
  { col: 2, row: 4, token: "R0" },
  { col: 4, row: 4, token: "R0" },
  { col: 3, row: 3, token: "R0" },
];

/** The gem the player has hold of when the press is made. */
const HELD: CellRef = { col: 3, row: 3 };

/** The orthogonal neighbor the press lands on, which the gem is offered into. */
const NEIGHBOR: CellRef = { col: 3, row: 4 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("names the pressed neighbor as the offer, and requests no swap", async () => {
  const posed = quietRowsWithEscape(RUN_CELLS);
  assertEqual(hasAnyRun(posed), false, "a maximal run on the posed board");
  assertTrue(
    areAdjacent(HELD, NEIGHBOR),
    "the pressed cell is orthogonally adjacent to the held one, so the press " +
      "table's third row is the row that matches",
  );
  assertTrue(
    swapIsProductive(posed, HELD, NEIGHBOR),
    "the exchange is one R3 accepts, so a press that played it would open a " +
      "chain rather than raise a refusal",
  );

  await loadBoard(h, posed);
  await h.debug.setSelection(HELD.col, HELD.row);
  const held = await h.snapshot();
  assertDeepEqual(held.selection, HELD, "the gem the player has hold of");
  assertNull(held.offer, "the offer standing before the press");

  const offered = await pressCell(h, NEIGHBOR);

  // The frame that draws the offer, and the picture of it.
  await h.advance(1);
  await captureStill(h, "offer");

  assertDeepEqual(offered.offer, NEIGHBOR, "the cell the press offered into");
  assertDeepEqual(
    offered.selection,
    HELD,
    "the selection, which this row offers from rather than moves",
  );
  assertBoardEquals(
    await h.board(),
    posed,
    "the board, which an offer names a move on rather than plays",
  );
  assertEqual(
    offered.phase,
    "idle",
    "the phase, since nothing reaches the move rules until the release",
  );
});

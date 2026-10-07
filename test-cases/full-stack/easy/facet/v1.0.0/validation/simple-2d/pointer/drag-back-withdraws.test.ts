// Facet — pointer/drag-back-withdraws: carrying the gem home withdraws the offer.
//
// The first row of specs/controls.md's drag table: "While the pointer is held
// down … The selected cell — The standing offer is withdrawn, so nothing is
// offered." It is the row that makes a move reversible, and specs/controls.md
// spells out what it is for immediately below the tables: "a player who takes
// hold of a gem, carries it onto a neighbor, and carries it back where it came
// from has withdrawn the offer, and the release plays nothing."
//
// READ ON ITS OWN, AND WITH THE SELECTION READ BESIDE IT. The row withdraws the
// offer and says nothing about the hold, so the gem is still held: it is the same
// gesture as pressing the held cell again, which the press table words as "the
// gem is taken hold of again where it started". A build that withdrew the offer
// AND dropped the selection would leave the player holding nothing halfway
// through a gesture — the next movement would offer nothing, and the release
// would play nothing — so both are asserted, and a build that gets one right
// fails here on the other rather than somewhere further along.
//
// THE OFFER IS PUT THERE BY A DRAG, not posed. This point is about the drag table
// reading one position against the selected cell, so the offer it withdraws has
// to be one the same table put there — otherwise a build that never read a
// movement at all would pass by leaving a posed offer untouched. The first
// movement is asserted to have made the offer before the second is made.
//
// WHAT THIS DOES NOT DECIDE. That the whole undone gesture plays nothing is
// `pointer/drag-undo-plays-nothing`, which drives the release as well; the
// exchange is posed productive here for the same reason it is there, so a build
// that plays a swap at any point along the way is caught by `phase` rather than
// hidden behind a refusal.

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
  captureReplay,
  createHarness,
  dragOntoCell,
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

/** The gem the press takes hold of, and the drag carries back onto. */
const HELD: CellRef = { col: 3, row: 3 };

/** The orthogonal neighbor the gem is carried out onto first. */
const NEIGHBOR: CellRef = { col: 3, row: 4 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("withdraws the offer and keeps the gem held", async () => {
  const posed = quietRowsWithEscape(RUN_CELLS);
  assertEqual(hasAnyRun(posed), false, "a maximal run on the posed board");
  assertTrue(
    areAdjacent(HELD, NEIGHBOR),
    "the carried-onto cell is an orthogonal neighbor of the held one",
  );
  assertTrue(
    swapIsProductive(posed, HELD, NEIGHBOR),
    "the exchange is one R3 accepts, so a build that played it on a movement " +
      "is caught by the phase rather than by a refusal",
  );

  loadBoard(h, posed);

  const home = await captureReplay(h, "withdraw", async () => {
    // The hold, and the carry out that makes the offer this row withdraws. No
    // frame runs between the three: specs/instrumentation.md resolves each at
    // the call, so the gesture is posed with the game standing still.
    const held = pressCell(h, HELD);
    assertDeepEqual(held.selection, HELD, "the gem the press took hold of");
    assertNull(held.offer, "the offer standing before the carry out");

    const out = dragOntoCell(h, NEIGHBOR);
    assertDeepEqual(out.offer, NEIGHBOR, "the offer the carry out made");
    assertEqual(out.phase, "idle", "the phase while the gem stands offered");

    // And back where it started.
    const reading = dragOntoCell(h, HELD);
    const board = h.board();
    await h.advance(1);
    return { reading, board };
  });

  assertNull(home.reading.offer, "the offer the carry home withdrew");
  assertDeepEqual(
    home.reading.selection,
    HELD,
    "the selection, which withdrawing an offer does not let go of",
  );
  assertBoardEquals(
    home.board,
    posed,
    "the board, which carrying a gem out and back does not touch",
  );
  assertEqual(
    home.reading.phase,
    "idle",
    "the phase, since nothing reaches the move rules until the release",
  );
});

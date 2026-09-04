// Facet — pointer/drag-undo-plays-nothing: a gem carried out and back plays
// nothing.
//
// specs/controls.md states the whole gesture as a consequence of its three
// tables: "So a player who takes hold of a gem, carries it onto a neighbor, and
// carries it back where it came from has withdrawn the offer, and the release
// plays nothing. A move is played only by a release with an offer standing."
//
// IT IS THE PROMISE THE HOLD MODEL MAKES A PLAYER, which is why it is a point of
// its own rather than a corollary of the three rows it is built from. A build
// that plays the swap on the press, or on the first movement that reaches a
// neighbor, answers every one of `pointer/press-offers`,
// `pointer/drag-offers` and `pointer/drag-back-withdraws` in the letter and
// breaks exactly this — the player who thought better of a move has played it
// anyway, and there is no way back.
//
// THE WHOLE GESTURE, END TO END: press on the cell, carry onto the neighbor,
// carry back onto the cell, release. Four operations, and each is the one
// specs/controls.md names, so what decides the outcome is the build's own press,
// move and release rules and nothing this check arranged.
//
// THE EXCHANGE IS PRODUCTIVE ON PURPOSE. If the exchange were one R3 refuses, a
// build that played it at any point along the way would leave the board untouched
// and a refusal standing — and a check reading "the board stands" would pass it.
// Here the exchange completes a run of three, so a swap played anywhere in the
// gesture exchanges two cells, opens a chain, and scores; every one of those
// shows in the readings below.
//
// FOUR READINGS, ONE PER TRACE A PLAYED SWAP WOULD LEAVE. All 64 cells stand as
// posed, so nothing was exchanged; `phase` is `idle` at chain step `0`, so
// nothing was accepted and no chain is running; the score is what it was, so
// nothing was cleared; and no refusal stands, so nothing was even requested.

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
  releasePointer,
  type Harness,
} from "../harness";

/** Three rubies one exchange short of a run in row 4, clear of the filler's corner. */
const RUN_CELLS: readonly PlacedToken[] = [
  { col: 2, row: 4, token: "R0" },
  { col: 4, row: 4, token: "R0" },
  { col: 3, row: 3, token: "R0" },
];

/** The gem the gesture takes hold of, and puts back. */
const HELD: CellRef = { col: 3, row: 3 };

/** The orthogonal neighbor it is carried out onto and then away from. */
const NEIGHBOR: CellRef = { col: 3, row: 4 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the board, the phase and the score exactly as they were", async () => {
  const posed = quietRowsWithEscape(RUN_CELLS);
  assertEqual(hasAnyRun(posed), false, "a maximal run on the posed board");
  assertTrue(
    areAdjacent(HELD, NEIGHBOR),
    "the carried-onto cell is an orthogonal neighbor of the held one",
  );
  assertTrue(
    swapIsProductive(posed, HELD, NEIGHBOR),
    "the exchange is one R3 accepts, so a swap played anywhere in the gesture " +
      "opens a chain rather than raising a refusal",
  );

  const opened = loadBoard(h, posed);
  assertEqual(opened.phase, "idle", "the phase the board rests in");

  const undone = await captureReplay(h, "undo", async () => {
    // The gesture, in the four operations specs/controls.md names. No frame runs
    // between them: each is resolved at the call, so the whole of what is read
    // afterwards was decided by the press, the two movements and the release.
    const held = pressCell(h, HELD);
    assertDeepEqual(held.selection, HELD, "the gem the press took hold of");

    const out = dragOntoCell(h, NEIGHBOR);
    assertDeepEqual(out.offer, NEIGHBOR, "the offer the carry out made");

    const home = dragOntoCell(h, HELD);
    assertNull(home.offer, "the offer the carry home withdrew");

    const reading = releasePointer(h);
    const board = h.board();
    await h.advance(1);
    return { reading, board };
  });

  assertBoardEquals(
    undone.board,
    posed,
    "the board a gesture that played nothing leaves",
  );
  assertEqual(undone.reading.phase, "idle", "the phase after the release");
  assertEqual(
    undone.reading.chainStep,
    0,
    "the chain step, which a played swap would have carried past 0",
  );
  assertEqual(
    undone.reading.score,
    opened.score,
    "the score, against what the board was posed carrying",
  );
  assertNull(
    undone.reading.refusal,
    "the refusal a swap requested anywhere in the gesture would have left",
  );
});

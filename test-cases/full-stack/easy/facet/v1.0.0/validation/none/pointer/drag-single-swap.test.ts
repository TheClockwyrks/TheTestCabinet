// Facet — pointer/drag-single-swap: once a drag has requested its swap, the rest
// of that hold changes nothing, and the release edge ends the drag.
//
// specs/controls.md closes its dragging paragraph with it: "A drag requests at
// most one swap, so the rest of that hold changes nothing, and the release edge
// ends the drag." Without it a player sweeping a finger across the board would
// fire a swap request at every cell the finger crossed, which is the difference
// between a game and a board that empties itself under the pointer.
//
// THE SCENARIO IS ONE UNBROKEN HOLD. A press on a cell, a move into the
// neighbor's reach that asks for the one swap the board accepts, and then the
// pointer keeps going: across two more of the pressed cell's orthogonal
// neighbors — the cells a build that never latched the drag would ask to swap
// next — then the release, then one more cell after it. Each of those five calls
// is read against the state the swap left.
//
// NOT ONE FRAME IS ADVANCED AFTER THE SWAP. specs/instrumentation.md resolves
// every pointer call at the call, so the whole hold is driven with the clock
// standing still, and nothing on the board can move of its own accord while it
// is. Anything that differs from the reading taken the instant the swap landed
// is therefore the hold's doing and nothing else's.
//
// WHAT A SECOND REQUEST WOULD LOOK LIKE. The swap left `phase` at `resolving`,
// and R2 accepts a swap "only while `phase` is `idle`" — so a second request
// made during the rest of this hold is refused, and specs/rules.md has a refused
// swap set `refusal` to the two cells it named for `REFUSAL_SECONDS`. A standing
// refusal is therefore the fingerprint of the request this rule forbids, and it
// is read alongside the selection, the phase, the chain step, the score and the
// board, none of which may move either.
//
// WHAT THIS DOES NOT ASSERT. That the drag requests its swap at all is
// `pointer/drag-swaps`; this point takes that as its starting position and reads
// only what the rest of the hold does.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertTrue } from "../assert";
import { GEM_HIT_R, GEM_R } from "../constants";
import {
  areAdjacent,
  assertBoardEquals,
  cellCenter,
  hasAnyRun,
  insideCell,
  quietRowsWithEscape,
  swapIsLegal,
  type CellRef,
} from "../board";
import {
  captureReplay,
  createHarness,
  loadBoard,
  resolveChain,
  type Harness,
} from "../harness";
import type { FacetSnapshot } from "../surface";

/** The cell the hold begins on, and the neighbor the drag reaches into. */
const PRESSED: CellRef = { col: 3, row: 3 };
const NEIGHBOR: CellRef = { col: 4, row: 3 };

/**
 * How far short of the neighbor's center the drag stops, along the row: the same
 * 33 `pointer/drag-swaps` reaches into, midway between `GEM_R` and `GEM_HIT_R`.
 */
const SHORT_OF_CENTER = (GEM_R + GEM_HIT_R) / 2;

/**
 * Where the pointer goes after the swap: two more of the pressed cell's
 * orthogonal neighbors while the hold stands, and a third after the release.
 *
 * Neighbors of the PRESSED cell on purpose. A build that cleared its "already
 * swapped" latch, or never set one, has a pressed cell still in hand and these
 * are exactly the cells its drag rule would ask to swap with next.
 */
const CROSSED: CellRef[] = [
  { col: 3, row: 2 },
  { col: 3, row: 4 },
];
const AFTER_RELEASE: CellRef = { col: 2, row: 3 };

/** The fields the rest of the hold may not move. */
function reading(snapshot: FacetSnapshot): Record<string, unknown> {
  return {
    selection: snapshot.selection,
    refusal: snapshot.refusal,
    phase: snapshot.phase,
    chainStep: snapshot.chainStep,
    score: snapshot.score,
    levelScore: snapshot.levelScore,
  };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("asks for nothing more for the rest of the hold, and ends on the release", async () => {
  // The same board `pointer/drag-swaps` is posed on: the one productive exchange
  // is the pressed cell against its right-hand neighbor, so the drag has a swap
  // to spend and every later cell the pointer crosses has none.
  const posed = quietRowsWithEscape([
    { col: 4, row: 1, token: "R0" },
    { col: 4, row: 2, token: "R0" },
    { col: PRESSED.col, row: PRESSED.row, token: "R0" },
  ]);
  assertTrue(!hasAnyRun(posed), "the posed board carries no run of its own");
  assertTrue(
    swapIsLegal(posed, PRESSED, NEIGHBOR),
    "R1 and R3 accept the one swap this hold is entitled to",
  );
  for (const cell of [...CROSSED, AFTER_RELEASE]) {
    assertTrue(
      areAdjacent(PRESSED, cell),
      `(${cell.col},${cell.row}) is a neighbor of the pressed cell, so a build ` +
        `that had not spent its drag would ask to swap with it`,
    );
  }

  const from = cellCenter(PRESSED.col, PRESSED.row);
  const into = insideCell(NEIGHBOR.col, NEIGHBOR.row, -SHORT_OF_CENTER, 0);

  await loadBoard(h, posed);

  const hold = await captureReplay(h, "drag", async () => {
    // One frame first, so the recording opens on the board as it was posed.
    await h.advance(1);
    await h.debug.pointerDown(from.x, from.y);
    await h.debug.pointerMove(into.x, into.y);
    const swapped = await h.snapshot();
    const swappedBoard = await h.board();

    // The hold continues over two more of the pressed cell's neighbors.
    for (const cell of CROSSED) {
      const at = cellCenter(cell.col, cell.row);
      await h.debug.pointerMove(at.x, at.y);
    }
    const crossed = await h.snapshot();
    const crossedBoard = await h.board();

    // The release edge ends the drag.
    await h.debug.pointerUp();
    const released = await h.snapshot();
    const releasedBoard = await h.board();

    // And a move made after that release resumes nothing.
    const past = cellCenter(AFTER_RELEASE.col, AFTER_RELEASE.row);
    await h.debug.pointerMove(past.x, past.y);
    const after = await h.snapshot();
    const afterBoard = await h.board();

    // The chain runs on for the recording's sake alone, after every reading
    // this check makes has been taken.
    await resolveChain(h);
    return {
      swapped,
      swappedBoard,
      crossed,
      crossedBoard,
      released,
      releasedBoard,
      after,
      afterBoard,
    };
  });

  // The starting position: the drag really did spend its one swap.
  assertEqual(
    hold.swapped.phase,
    "resolving",
    "the phase the drag's accepted swap set",
  );
  assertEqual(hold.swapped.chainStep, 1, "the chain step that swap set");

  // The rest of the hold.
  assertDeepEqual(
    reading(hold.crossed),
    reading(hold.swapped),
    "the state after the pointer crossed two more of the pressed cell's " +
      "neighbors while still held",
  );
  assertBoardEquals(
    hold.crossedBoard,
    hold.swappedBoard,
    "the board after the rest of the hold",
  );

  // The release.
  assertDeepEqual(
    reading(hold.released),
    reading(hold.swapped),
    "the state the release edge left",
  );
  assertBoardEquals(
    hold.releasedBoard,
    hold.swappedBoard,
    "the board the release edge left",
  );

  // And nothing resumes after it.
  assertDeepEqual(
    reading(hold.after),
    reading(hold.swapped),
    "the state after a move made with the pointer no longer held",
  );
  assertBoardEquals(
    hold.afterBoard,
    hold.swappedBoard,
    "the board after a move made with the pointer no longer held",
  );
});

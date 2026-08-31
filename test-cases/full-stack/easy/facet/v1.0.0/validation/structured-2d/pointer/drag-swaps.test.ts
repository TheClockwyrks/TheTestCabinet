// Facet — pointer/drag-swaps: a pointer held down from a press on a cell, moved
// within GEM_HIT_R of an orthogonally adjacent cell's center, requests that swap
// and clears the selection.
//
// specs/controls.md states it in one sentence: "While the pointer is held down
// from a press that targeted a cell, the pointer moving within `GEM_HIT_R` of the
// center of a cell orthogonally adjacent to the pressed cell requests that swap
// and clears the selection." It is the whole of what makes the board playable
// with one gesture rather than two presses, and what a build owes is a REQUEST —
// R1, R2 and R3 decide the request, and specs/controls.md sends a drag down the
// same acceptance path a press uses.
//
// WHERE THE MOVE LANDS, AND WHY NOT THE CENTER. The rule is a RADIUS, so the
// drag stops 33 units short of the neighbor's center along the row: inside
// `GEM_HIT_R` (36) of that center and outside `GEM_R` (30), the radius the gem
// itself is drawn within, and 39 — outside `GEM_HIT_R` — from the pressed cell's
// own center. A build that read the drag at the wrong one of specs/board.md's
// two radii, one that only answered a drag reaching the exact center, and one
// that never let go of the cell the press began on all fail there, and all three
// would pass a drag driven to the center itself.
//
// NO FRAME PASSES BETWEEN THE PRESS AND THE MOVE. specs/instrumentation.md makes
// each pointer call take effect "immediately, when it is called" rather than
// waiting to be sampled, so the swap the drag asks for is there to read the
// instant the move returns. It also means the two calls cannot be told apart by
// any clock: the reading taken between them shows the press had only selected,
// so the swap below is the MOVE's doing and not the press's.
//
// HOW THE READING SAYS WHICH SWAP. specs/rules.md has an accepted swap "exchange
// the two cells at once, set `chainStep` to `1`, set `phase` to `resolving`, and
// resolve step `1` immediately", so an accepted request is legible with no frame
// advanced. The board is posed so that the one productive exchange on it is the
// pressed cell against its right-hand neighbor, and the gem that neighbor held is
// found in the pressed cell afterward — which no other swap would put there.
//
// WHAT THIS DOES NOT ASSERT. That the rest of the hold does nothing more is
// `pointer/drag-single-swap`; what the two-press route does is `pointer/press-swaps`.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertNull,
  assertTrue,
} from "../assert";
import { GEM_HIT_R, GEM_R } from "../constants";
import {
  cellCenter,
  hasAnyRun,
  insideCell,
  parseToken,
  quietRowsWithEscape,
  swapIsLegal,
  tokenAt,
  type CellRef,
} from "../board";
import {
  captureReplay,
  createHarness,
  loadBoard,
  resolveChain,
  type Harness,
} from "../harness";

/** The cell the hold begins on, and the neighbor the drag reaches into. */
const PRESSED: CellRef = { col: 3, row: 3 };
const NEIGHBOR: CellRef = { col: 4, row: 3 };

/**
 * How far short of the neighbor's center the drag stops, along the row: midway
 * between `GEM_R` (30) and `GEM_HIT_R` (36), which is 33.
 *
 * Inside the radius the drag rule is written at — which `insideCell` proves
 * before the point is used — and outside the radius the neighbor's gem is drawn
 * within, so a build that answered a drag only once the pointer was over the
 * artwork fails here. It is also `CELL_PITCH - 33` = 39 from the pressed cell's
 * own center, which the check proves is outside `GEM_HIT_R`.
 */
const SHORT_OF_CENTER = (GEM_R + GEM_HIT_R) / 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("requests the neighbor's swap on the move, and clears the selection", async () => {
  // Two rubies stacked above the neighbor's cell, and a ruby in the pressed
  // cell: the exchange carries that ruby into column 4 and completes a run of
  // three there. Nothing else on the filler matches anything, and the escape
  // keeps a legal swap on the board so the round is not over.
  const posed = quietRowsWithEscape([
    { col: 4, row: 1, token: "R0" },
    { col: 4, row: 2, token: "R0" },
    { col: PRESSED.col, row: PRESSED.row, token: "R0" },
  ]);
  assertTrue(!hasAnyRun(posed), "the posed board carries no run of its own");
  assertTrue(
    swapIsLegal(posed, PRESSED, NEIGHBOR),
    "R1 and R3 accept the swap the drag asks for",
  );
  const carried = parseToken(
    tokenAt(posed, NEIGHBOR.col, NEIGHBOR.row),
  ).kind;

  const from = cellCenter(PRESSED.col, PRESSED.row);
  const into = insideCell(NEIGHBOR.col, NEIGHBOR.row, -SHORT_OF_CENTER, 0);
  assertGreaterThan(
    Math.hypot(into.x - from.x, into.y - from.y),
    GEM_HIT_R,
    "the drag has carried the pointer out of the pressed cell's own reach",
  );

  loadBoard(h, posed);

  const drag = await captureReplay(h, "drag", async () => {
    // One frame first, so the recording opens on the board as it was posed.
    await h.advance(1);
    h.debug.pointerDown(from.x, from.y);
    const held = h.snapshot();
    // No frame between these two calls: the move is what asks for the swap.
    h.debug.pointerMove(into.x, into.y);
    const dragged = h.snapshot();
    h.debug.pointerUp();
    // The chain runs on for the recording's sake alone; every assertion below
    // reads `held` or `dragged`, the states the two calls themselves left.
    await resolveChain(h);
    return { held, dragged };
  });

  // The hold began from a press that targeted a cell, and that press alone asked
  // for nothing — so what follows belongs to the move.
  assertDeepEqual(drag.held.selection, PRESSED, "the cell the hold began on");
  assertEqual(drag.held.phase, "idle", "the phase the press alone left");

  assertNull(drag.dragged.selection, "the selection the drag's swap cleared");
  assertEqual(
    drag.dragged.phase,
    "resolving",
    "the phase the accepted swap set",
  );
  assertEqual(
    drag.dragged.chainStep,
    1,
    "the chain step the accepted swap set",
  );

  // Which swap: the gem the neighbor held now sits in the pressed cell. The run
  // the exchange made is in the neighbor's column, so the pressed cell is
  // outside the clear set and still holds what the exchange put there.
  const landed = drag.dragged.board.cells.find(
    (cell) => cell.col === PRESSED.col && cell.row === PRESSED.row,
  );
  assertEqual(
    landed?.kind,
    carried,
    `the gem (${NEIGHBOR.col},${NEIGHBOR.row}) held, now at ` +
      `(${PRESSED.col},${PRESSED.row})`,
  );
});

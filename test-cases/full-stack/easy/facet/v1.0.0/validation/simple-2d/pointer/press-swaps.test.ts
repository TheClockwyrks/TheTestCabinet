// Facet — pointer/press-swaps: a press on a cell orthogonally adjacent to the
// selected one requests that swap and clears the selection.
//
// The third row of specs/controls.md's press table: "A cell orthogonally
// adjacent to the selected cell — Requests that swap and clears the selection."
// It is the row that makes the pointer able to play the game at all, and
// specs/controls.md adds that "every requested swap goes through one acceptance
// path, whether a press, a drag, or the keyboard asked for it", so what a press
// owes is a REQUEST — the acceptance is R1, R2 and R3's business.
//
// HOW THE REQUEST IS OBSERVED. specs/rules.md says an accepted swap "exchanges
// the two cells at once, sets `chainStep` to `1`, sets `phase` to `resolving`,
// and resolves step `1` immediately", so a swap the build really requested and
// really accepted is visible the instant the press returns, with no frame
// advanced. The board is posed so that exactly one exchange on it is productive
// — the selected cell against its right-hand neighbor — which is what makes the
// reading say WHICH swap was requested rather than merely that something moved:
// the gem the selected cell held is found in the neighbor's cell afterward.
//
// WHAT A WRONG BUILD LOOKS LIKE HERE. One that read the press table's fourth row
// ("Any other cell — Moves the selection to that cell") before the third leaves
// `phase` at `idle` with the selection sitting on the neighbor. One that swapped
// but kept the selection leaves it standing. One that requested the wrong pair
// leaves the board resolving somewhere else, or not at all.
//
// The fixture is proved against specs/rules.md's own predicates before it is
// posed: the board carries no run of its own, so nothing resolves until the
// press asks for it, and the pair the press names is a legal swap under R1 and
// R3, so a refusal here would be the build's and not the check's.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNull, assertTrue } from "../assert";
import {
  cellCenter,
  hasAnyRun,
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

/** The selected cell, and the neighbor the press lands on. */
const SELECTED: CellRef = { col: 3, row: 3 };
const NEIGHBOR: CellRef = { col: 4, row: 3 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("requests the swap with the neighbor, and clears the selection", async () => {
  // A ruby above and below the selected cell, and a ruby in the neighbor: the
  // exchange carries that ruby into column 3 and makes a run of three there.
  // Nothing else on the filler matches anything.
  const posed = quietRowsWithEscape([
    { col: 3, row: 2, token: "R0" },
    { col: 3, row: 4, token: "R0" },
    { col: NEIGHBOR.col, row: NEIGHBOR.row, token: "R0" },
  ]);
  assertTrue(!hasAnyRun(posed), "the posed board carries no run of its own");
  assertTrue(
    swapIsLegal(posed, SELECTED, NEIGHBOR),
    "R1 and R3 accept the swap the press asks for",
  );
  const carried = parseToken(tokenAt(posed, SELECTED.col, SELECTED.row)).kind;

  loadBoard(h, posed);
  h.debug.setSelection(SELECTED.col, SELECTED.row);
  assertDeepEqual(
    h.snapshot().selection,
    SELECTED,
    "the selection the press is made against",
  );

  const center = cellCenter(NEIGHBOR.col, NEIGHBOR.row);
  const pressed = await captureReplay(h, "swap", async () => {
    h.debug.pointerDown(center.x, center.y);
    const after = h.snapshot();
    h.debug.pointerUp();
    // The chain runs on for the replay's sake alone; every assertion below is
    // read off `after`, the state the press itself left.
    await resolveChain(h);
    return after;
  });

  assertNull(pressed.selection, "the selection the requested swap cleared");
  assertEqual(pressed.phase, "resolving", "the phase the accepted swap set");
  assertEqual(pressed.chainStep, 1, "the chain step the accepted swap set");

  // Which swap: the gem the selected cell held now sits in the neighbor's cell.
  // The run the exchange made is in the selected cell's column, so the neighbor
  // is outside the clear set and still holds what the exchange put there.
  const landed = pressed.board.cells.find(
    (cell) => cell.col === NEIGHBOR.col && cell.row === NEIGHBOR.row,
  );
  assertEqual(
    landed?.kind,
    carried,
    `the gem (${SELECTED.col},${SELECTED.row}) held, now at ` +
      `(${NEIGHBOR.col},${NEIGHBOR.row})`,
  );
});

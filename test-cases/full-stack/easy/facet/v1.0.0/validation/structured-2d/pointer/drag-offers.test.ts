// Facet — pointer/drag-offers: carrying a held gem onto its neighbor offers the
// move, and plays nothing.
//
// The second row of specs/controls.md's drag table: "While the pointer is held
// down, each position it reaches is read against the selected cell … A cell
// orthogonally adjacent to the selected cell — That cell becomes the offer,
// replacing any offer standing." The reach is the same one a press is measured
// by: the pointer is read against the cell whose center lies within `GEM_HIT_R`
// (`36`) of it.
//
// AND NOTHING IS PLAYED, because "Nothing reaches the move rules until the
// pointer is released." A drag names the move; the release plays it.
//
// THE POINTER IS CARRIED TO A POSITION OFF THE NEIGHBOR'S CENTER, and inside
// `GEM_HIT_R` of it, because that is what a player's hand does — a drag that only
// ever landed on exact centers would say nothing about the radius the rule is
// written in. The position is proved, before the build is asked anything, to lie
// inside the radius of the neighbor's center and nearer that center than any
// other, so specs/controls.md's targeting rule names that cell and no other.
//
// THE EXCHANGE IS POSED PRODUCTIVE. A build that requests the swap on the
// MOVEMENT rather than on the release is only visible where the swap would be
// accepted: where R3 would refuse it, such a build leaves a refusal that a check
// reading "the board stands" would pass. Here the exchange completes a run of
// three, so a movement that played it exchanges two cells and puts the game into
// `swapping`.
//
// THE HOLD IS TAKEN BY A REAL PRESS, through the surface's `pointerDown`, rather
// than posed with `setSelection`: the drag table reads "while the pointer is held
// down", so the pointer has to actually be down for the movement to be a drag at
// all. A build that read every movement against the selection, held or not, would
// answer a posed selection and fail a player who merely swept the mouse across
// the board — and that build is caught by `pointer/drag-back-withdraws`'s
// companion arrangement rather than hidden here.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertDeepEqual,
  assertEqual,
  assertLessThan,
  assertNull,
  assertTrue,
} from "../assert";
import { GEM_HIT_R } from "../constants";
import {
  areAdjacent,
  assertBoardEquals,
  cellCenter,
  distanceToNearestCell,
  hasAnyRun,
  insideCell,
  quietRowsWithEscape,
  swapIsProductive,
  type CellRef,
  type PlacedToken,
} from "../board";
import {
  captureReplay,
  createHarness,
  loadBoard,
  movePointer,
  pressCell,
  type Harness,
} from "../harness";

/** Three rubies one exchange short of a run in row 4, clear of the filler's corner. */
const RUN_CELLS: readonly PlacedToken[] = [
  { col: 2, row: 4, token: "R0" },
  { col: 4, row: 4, token: "R0" },
  { col: 3, row: 3, token: "R0" },
];

/** The gem the press takes hold of. */
const HELD: CellRef = { col: 3, row: 3 };

/** The orthogonal neighbor the drag carries it onto. */
const NEIGHBOR: CellRef = { col: 3, row: 4 };

/**
 * How far off the neighbor's center the drag stops, on each axis.
 *
 * `20` and `20` is `28.28` from the center, inside `GEM_HIT_R` (`36`) and well
 * outside it from every other center, so the position targets that neighbor and
 * nothing else. `insideCell` refuses an offset that is not inside the radius, so
 * the figure cannot drift out of range unnoticed.
 */
const OFF_CENTER = 20;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("makes the neighbor the offer, and requests no swap", async () => {
  const posed = quietRowsWithEscape(RUN_CELLS);
  assertEqual(hasAnyRun(posed), false, "a maximal run on the posed board");
  assertTrue(
    areAdjacent(HELD, NEIGHBOR),
    "the carried-onto cell is an orthogonal neighbor of the held one",
  );
  assertTrue(
    swapIsProductive(posed, HELD, NEIGHBOR),
    "the exchange is one R3 accepts, so a drag that played it would open a " +
      "chain rather than raise a refusal",
  );

  // Where the drag stops, proved to name the neighbor and no other cell.
  const at = insideCell(NEIGHBOR.col, NEIGHBOR.row, OFF_CENTER, OFF_CENTER);
  const center = cellCenter(NEIGHBOR.col, NEIGHBOR.row);
  const reach = Math.hypot(at.x - center.x, at.y - center.y);
  assertLessThan(
    reach,
    GEM_HIT_R,
    "the drag stops within GEM_HIT_R of the neighbor",
  );
  assertCloseTo(
    distanceToNearestCell(at.x, at.y),
    reach,
    9,
    "no cell center lies nearer the drag's stopping point than the neighbor's",
  );

  loadBoard(h, posed);

  const carried = await captureReplay(h, "drag", async () => {
    // A real press, so the movement that follows is a drag rather than a sweep.
    const held = pressCell(h, HELD);
    assertDeepEqual(held.selection, HELD, "the gem the press took hold of");
    assertNull(held.offer, "the offer standing before the drag");

    // No frame between the press and the movement: specs/instrumentation.md
    // resolves each of the three at the call, so the whole hold is posed with
    // the game standing still and nothing of a build's frame scheduling enters
    // the reading.
    const reading = movePointer(h, at.x, at.y);
    const board = h.board();
    await h.advance(1);
    return { reading, board };
  });

  assertDeepEqual(
    carried.reading.offer,
    NEIGHBOR,
    "the cell the drag offered the held gem into",
  );
  assertDeepEqual(
    carried.reading.selection,
    HELD,
    "the selection, which the drag offers FROM rather than moves",
  );
  assertBoardEquals(
    carried.board,
    posed,
    "the board, which an offer names a move on rather than plays",
  );
  assertEqual(
    carried.reading.phase,
    "idle",
    "the phase, since nothing reaches the move rules until the release",
  );
});

// runs/r5-prism-against-prism — trading a prism against a prism takes the whole
// board.
//
// R5 of specs/rules.md gives this swap the largest seed there is: "Step 1 of a
// chain begun by a swap that traded a `prism` against a `prism` is seeded with
// every cell on the board." Every cell — all `GRID_COLS` by `GRID_ROWS` of them,
// the two prisms included. It is the one move in the game whose outcome does not
// depend on what is on the board, which is what makes it checkable exactly.
//
// HOW A SEED THAT REACHES EVERY CELL IS OBSERVED. R9 refills what the step
// empties, so a cleared cell and an untouched one both hold a gem afterward and
// a plain gem tells the two apart from neither. What a refill can never deal is
// a PRISM: R9 fills an empty cell "with a `plain` gem", and R8 creates a prism
// only from a maximal run of five or more, of which this board carries none. So
// the scenario writes prisms across the board — into all four corners, down both
// edges and out in the middle — and a prism still standing afterward is a cell
// the step did not take. A build that seeds the two traded cells, or the ring
// around them, or the row and column they lie in, leaves prisms standing in the
// corners and is caught there as well as on the count.
//
// AND THE CELLS ARE ONLY EVER READ FOR THEIR CUT. Nothing here reads a strain or
// a kind: what R9 deals into an emptied cell is drawn off the game's own random
// draw and is `settling/r9-refill-plain-zero`'s point rather than this one,
// so a build that refills at the wrong strain loses that point and not this one
// too.
//
// WHY THE MARKERS ARE PRISMS AND NOT CUT GEMS. R6 grows the seed through a
// `brilliant`, a `star` or a flawed gem, so markers of those three would let a
// build with a far too small seed grow it back to the whole board and pass. A
// prism adds nothing under R6, and neither does a plain gem at strain `0`, so
// the board below leaves R6 with nothing to do and what the step clears is the
// seed R5 gave it exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertTrue } from "../assert";
import { GRID_COLS, GRID_ROWS } from "../constants";
import {
  hasPrism,
  isPrism,
  maximalRuns,
  parseRows,
  quietRowsWith,
  renderBoard,
  swapped,
  type CellRef,
  type PlacedToken,
} from "../board";
import {
  captureReplay,
  createHarness,
  loadBoard,
  swapAndStep,
  type Harness,
} from "../harness";

/** Every cell of the board: the seed R5 gives this one swap. */
const WHOLE_BOARD = GRID_COLS * GRID_ROWS;

/** The two prisms, orthogonally adjacent so R1 accepts the swap. */
const LEFT: CellRef = { col: 3, row: 3 };
const RIGHT: CellRef = { col: 4, row: 3 };

/**
 * The prisms written out across the board, away from the traded pair.
 *
 * All four corners, the middle of both side edges, and two more in open board,
 * so that every wrong seed a build might reach for — the traded pair alone, the
 * cells around them, their row and their column — leaves at least one of these
 * standing.
 */
const MARKERS: readonly CellRef[] = [
  { col: 0, row: 0 },
  { col: GRID_COLS - 1, row: 0 },
  { col: 0, row: GRID_ROWS - 1 },
  { col: GRID_COLS - 1, row: GRID_ROWS - 1 },
  { col: 0, row: 4 },
  { col: GRID_COLS - 1, row: 4 },
  { col: 2, row: 6 },
  { col: 5, row: 1 },
];

/** Every prism the board is posed with: the traded pair and the markers. */
const PRISMS: readonly CellRef[] = [LEFT, RIGHT, ...MARKERS];

/**
 * The quiet filler with those cells turned into prisms.
 *
 * A prism belongs to no kind, so writing one over a cell can never make a run:
 * the board matches nothing, and R5's ordinary seed would be empty. What the
 * step clears therefore comes from the prism-against-prism sentence alone.
 */
const POSED = quietRowsWith(
  PRISMS.map(({ col, row }): PlacedToken => ({ col, row, token: "X0" })),
);

/**
 * Frames driven after the step has resolved, purely so the recorded clip holds
 * the shattering and the fall.
 *
 * `swapAndStep` leaves the step `0.03875` s into its own hold; twelve more frames
 * of the suite's 64 Hz clock add `0.1875` s, for `0.22625` s in all. That is
 * short of `0.3` s, the SHORTEST hold any step can have, so the board is never
 * read a second time and every assertion is made against the reading taken before
 * them.
 */
const CLIP_FRAMES = 12;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("clears every cell when a prism is traded against a prism", async () => {
  // The fixture states its own premises: both traded cells hold a prism, every
  // marker is one too, the board carries no run for the ordinary seed to take,
  // and nothing on it is cut or flawed, so R6 has nothing to add to whatever
  // seed the build reaches for.
  assertTrue(isPrism(POSED, LEFT), "the left-hand cell holds a prism");
  assertTrue(isPrism(POSED, RIGHT), "the right-hand cell holds a prism");
  for (const marker of MARKERS) {
    assertTrue(
      isPrism(POSED, marker),
      `the marker at (${marker.col},${marker.row}) holds a prism`,
    );
  }
  assertLength(
    maximalRuns(swapped(POSED, LEFT, RIGHT)),
    0,
    "maximal runs the swap produces",
  );
  for (const gem of parseRows(POSED).flat()) {
    assertTrue(
      gem.cut === "plain" || gem.cut === "prism",
      "every posed gem is plain or one of the prisms",
    );
    assertEqual(gem.strain, 0, "the strain of every gem posed");
  }

  loadBoard(h, POSED);

  const first = await captureReplay(h, "clear", async () => {
    const reading = await swapAndStep(h, LEFT, RIGHT);
    await h.advance(CLIP_FRAMES);
    return reading;
  });

  // Every cell on the board, the two prisms among them.
  assertEqual(first.lastCleared, WHOLE_BOARD, "cells the step cleared");

  // And not one prism is left anywhere — not in a corner, not on an edge, not
  // the traded pair itself — which is the same claim as "every cell", read off
  // the board rather than off a counter.
  assertLength(first.board.cells, WHOLE_BOARD, "cells the board reports");
  assertTrue(!hasPrism(renderBoard(first)), "no prism survived the step");
});

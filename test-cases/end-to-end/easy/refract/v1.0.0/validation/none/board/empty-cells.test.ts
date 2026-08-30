// board/empty-cells — an empty cell holds nothing.
//
// specs/board.md: every cell is either empty or holds exactly one node, and an
// empty cell holds nothing and is drawn as nothing, or as quiet background
// texture of the build's choosing. "Quiet" gets the case's objective bound:
// every empty cell's sampled center stays within 50 of 441 of the board's own
// ground — room for a grid dot or a faint texture, never for anything as loud
// as a node, which the same items require to stand MORE than 50 apart.
//
// WHICH GROUND, AND WHY THAT IS NOT CIRCULAR. The comparand is the board's OWN
// ground — the first empty cell's sample on the same frame — and not a
// stage-edge sample: specs/board.md leaves the background to the build, so a
// vignette or a board backing puts real distance between a cell inside the
// board and a patch at the stage's edge, and the reading would be of the
// backdrop rather than of the cell.
//
// On its own that would narrow the item to "every empty cell is drawn as
// quietly as the ground cell", which a build that drew one and the same loud
// marker in EVERY empty cell would satisfy — the ground would be the marker,
// and every cell would match it. So each empty cell is also read ACROSS ITSELF:
// eight points at NODE_R / 2 and eight at NODE_R from its center are held to
// the same line as its center. A marker of any real extent then fails whichever
// way it is drawn — the center reads the marker and the ring reads what
// surrounds it, or the reverse — and it fails in every cell at once rather than
// only where it differs from the ground. Together the two clauses decide what
// the item states: no empty cell holds anything a player would read as a node.
//
// THE RING IS READ ON INTERIOR CELLS ONLY. A cell on the board's outer ring has
// points at NODE_R sitting NODE_R past the outermost cell centers, and
// specs/board.md leaves that band to the build: the largest board's centers span
// y 152..632, "leaving room above the board for the heading and below it for the
// footer described in specs/ui.md", and specs/ui.md pins the height of neither.
// A heading, a legend, or a footer reaching within NODE_R of the outermost row
// would be read here as something drawn in a board cell, which is another item's
// requirement and not this one's. An interior cell's ring reaches only toward
// its own neighbours, a full CELL_PITCH away, so what it reads is the cell.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  center,
  colorDistance,
  createHarness,
  loadBoard,
  sampleColor,
  type Harness,
} from "../harness";
import { NODE_R } from "../notation";
import { DISTINCT_MIN, groundSample } from "./sampling";

/**
 * A 5x4 board mixing nodes and gaps: two channels on the outer columns, a
 * crystal in the middle, and thirteen empty cells between and around them.
 */
const MIXED_BOARD = `
T...S
..2..
t...s
T...S
`;

/**
 * Where each interior empty cell is read across itself: eight directions at
 * each of two radii inside the cell. NODE_R is the radius specs/board.md draws
 * a node's silhouette inside, so a marker a player could mistake for a node
 * cannot avoid all sixteen points and the center as well.
 */
const RING_RADII = [NODE_R / 2, NODE_R] as const;
const RING_DIRECTIONS = 8;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps every empty cell's center within 50 of the board's ground", async () => {
  const board = await loadBoard(h, MIXED_BOARD);
  await captureStill(h, "board");
  const ground = await groundSample(h, board);

  const occupied = new Set(
    board.nodes.map((node) => `${node.col},${node.row}`),
  );
  let readAcross = 0;
  for (let row = 0; row < board.rows; row += 1) {
    for (let col = 0; col < board.cols; col += 1) {
      if (occupied.has(`${col},${row}`)) continue;
      const at = center(board, { col, row });
      const color = await sampleColor(h, at.x, at.y);
      assertLessThanOrEqual(
        colorDistance(color, ground),
        DISTINCT_MIN,
        `the empty cell (${col}, ${row}) at its center (${at.x}, ${at.y})`,
      );

      // Interior cells only: see THE RING IS READ ON INTERIOR CELLS ONLY.
      const interior =
        col > 0 && col < board.cols - 1 && row > 0 && row < board.rows - 1;
      if (!interior) continue;
      readAcross += 1;
      for (const radius of RING_RADII) {
        for (let step = 0; step < RING_DIRECTIONS; step += 1) {
          const angle = ((2 * Math.PI) / RING_DIRECTIONS) * step;
          const x = at.x + radius * Math.cos(angle);
          const y = at.y + radius * Math.sin(angle);
          assertLessThanOrEqual(
            colorDistance(await sampleColor(h, x, y), ground),
            DISTINCT_MIN,
            `the empty cell (${col}, ${row}) read across itself, ` +
              `${radius} out from its center at ${Math.round(
                (angle * 180) / Math.PI,
              )} degrees`,
          );
        }
      }
    }
  }

  // The across-itself reading is never vacuous: the posed board has interior
  // empty cells, and they were read.
  assertGreaterThan(
    readAcross,
    0,
    "interior empty cells of the posed board read across themselves",
  );
});

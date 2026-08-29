// maze/corridors-one-wide — corridors are one tile wide.
//
// specs/maze.md, under "A conforming maze": "Corridor width. No four corridor
// tiles form a `2 x 2` block anywhere on the grid, so corridors run one tile wide
// throughout, winding between junctions. The den chamber is the one open area
// wider than a corridor, and it is made of den-interior tiles."
//
// So the reading is literal: every `2 x 2` window of the grid, counted for the
// ones whose four cells are all corridor, and the bound is zero. The chamber
// cannot turn up among them, because it is made of `d` tiles and this counts `.`
// tiles — which is exactly why the rule is stated that way and why nothing here
// has to carve the den out by hand.
//
// THE BOARD IS THE BUILD'S OWN. This is one of the eight points that read the
// layout the game laid out for itself rather than a posed fixture, because
// finding the property in a board a build invented IS the check. It is measured
// over several freshly seeded layouts, so a generator that opens a room only
// sometimes is caught.

import { afterEach, beforeEach } from "vitest";
import { check } from "../scene";
import { assertEqual } from "../assert";
import { createHarness, type Harness } from "../harness";
import { count2x2Open } from "../maze";
import { captureBoard, freshBoards, requireLaidOut, witness } from "./boards";

/**
 * How many `2 x 2` blocks of four corridor tiles a conforming layout may carry.
 *
 * None: specs/maze.md allows the block "anywhere on the grid" nowhere at all.
 */
const MAX_OPEN_BLOCKS = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

check(
  "lays out corridors one tile wide, with no 2x2 block of open corridor",
  async () => {
    const boards = freshBoards(h);
    requireLaidOut(boards);

    const measured = boards.map((board) => {
      const blocks = count2x2Open(board.snapshot);
      return { board, blocks, ok: blocks === MAX_OPEN_BLOCKS };
    });
    await captureBoard(h, witness(measured).board);

    for (const one of measured) {
      assertEqual(
        one.blocks,
        MAX_OPEN_BLOCKS,
        `2x2 blocks whose four tiles are all corridor, in the maze laid out from ` +
          `seed ${one.board.seed}`,
      );
    }
  },
);

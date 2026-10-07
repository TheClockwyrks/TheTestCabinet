// The campaign's twenty-four boards: transcription and solvability.
//
// The layouts are checked against the dimensions `specs/campaign-boards.md`
// gives in each heading, and every board is then SOLVED — a known solution is
// traced through the debug surface's pointer path, so the same grab rules,
// limits, and completion test a player plays under are what prove each board
// finishable. A board whose transcription drifted by one character would fail
// here: either the dimensions change, the notation stops parsing, or the
// solution stops threading.

import { describe, expect, it } from "vitest";
import { cellCenter, channelsOn } from "./board";
import { CAMPAIGN_BOARDS, campaignBoard } from "./campaign";
import {
  CAMPAIGN_LENGTH,
  GRID_MAX_COLS,
  GRID_MAX_ROWS,
  MAX_CHARGES,
} from "./constants";
import { createDebugApi, type RefractDebugApi } from "./debug";
import { measureDifficulty } from "./difficulty";
import { createInitialState } from "./flow";
import type { Cell, RefractState } from "./game";

/**
 * A route drawn through the surface's three pointer poses: a press at the
 * first cell's center, a move to each remaining center, then a release. The
 * surface carries no sugar for a route, so a caller that wants one composes it.
 */
function traceRoute(
  api: RefractDebugApi,
  state: RefractState,
  cells: readonly { col: number; row: number }[],
): RefractState {
  if (cells.length === 0) return state;
  const [firstX, firstY] = cellCenter(cells[0], state.board);
  let next = api.pointerDown(state, firstX, firstY);
  for (const cell of cells.slice(1)) {
    const [x, y] = cellCenter(cell, next.board);
    next = api.pointerMove(next, x, y);
  }
  return api.pointerUp(next);
}

/**
 * One known solution per board, found by exhaustive search over the ruleset
 * and replayed through the pointer path below: per board, one route per
 * channel present, in CHANNELS order, as `[col, row]` pairs.
 */
const SOLUTIONS: readonly (readonly (readonly [number, number][])[])[] = [
  // Board 1
  [
    [
      [1, 0],
      [2, 0],
      [1, 1],
      [0, 1],
      [1, 2],
      [2, 2],
      [2, 1],
    ],
  ],
  // Board 2
  [
    [
      [0, 1],
      [1, 0],
      [2, 0],
      [1, 1],
      [0, 2],
      [1, 2],
      [2, 1],
    ],
  ],
  // Board 3
  [
    [
      [1, 0],
      [0, 0],
      [0, 1],
      [1, 1],
      [0, 2],
      [1, 2],
      [2, 2],
      [3, 1],
      [3, 0],
      [2, 0],
      [2, 1],
    ],
  ],
  // Board 4
  [
    [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 2],
      [2, 2],
      [3, 2],
      [3, 1],
      [3, 0],
      [2, 1],
      [1, 1],
    ],
  ],
  // Board 5
  [
    [
      [2, 0],
      [1, 0],
      [1, 1],
      [2, 1],
      [3, 0],
      [3, 1],
      [3, 2],
      [3, 3],
      [2, 3],
      [1, 3],
      [0, 3],
      [0, 2],
      [1, 2],
      [2, 2],
    ],
  ],
  // Board 6
  [
    [
      [3, 0],
      [2, 0],
      [1, 0],
      [0, 0],
      [0, 1],
      [1, 1],
      [0, 2],
      [0, 3],
      [1, 3],
      [2, 2],
      [2, 1],
      [3, 2],
      [3, 3],
      [2, 3],
    ],
  ],
  // Board 7
  [
    [
      [1, 0],
      [2, 0],
      [3, 0],
      [2, 1],
      [3, 1],
      [3, 2],
      [2, 2],
    ],
    [
      [0, 0],
      [0, 1],
      [1, 1],
      [0, 2],
      [1, 2],
      [2, 3],
      [1, 3],
      [0, 3],
    ],
  ],
  // Board 8
  [
    [
      [2, 1],
      [2, 0],
      [1, 1],
      [2, 2],
      [3, 1],
      [4, 1],
      [3, 2],
      [4, 2],
      [3, 3],
      [4, 3],
    ],
    [
      [0, 0],
      [1, 0],
      [0, 1],
      [0, 2],
      [1, 2],
      [2, 3],
      [1, 3],
      [0, 3],
    ],
  ],
  // Board 9
  [
    [
      [0, 2],
      [0, 1],
      [0, 0],
      [1, 1],
      [0, 1],
      [1, 2],
      [0, 3],
      [1, 3],
    ],
    [
      [1, 0],
      [2, 0],
      [3, 0],
      [2, 1],
      [3, 1],
      [2, 2],
      [3, 2],
      [2, 3],
    ],
  ],
  // Board 10
  [
    [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
      [0, 2],
      [0, 3],
      [1, 2],
      [2, 1],
      [3, 0],
    ],
    [
      [3, 2],
      [4, 2],
      [4, 3],
      [3, 3],
      [2, 2],
      [1, 2],
      [2, 3],
      [1, 3],
    ],
  ],
  // Board 11
  [
    [
      [2, 1],
      [2, 0],
      [1, 1],
      [0, 1],
      [0, 2],
      [0, 3],
      [1, 2],
      [2, 3],
    ],
    [
      [2, 2],
      [3, 1],
      [4, 0],
      [4, 1],
      [3, 1],
      [3, 2],
      [3, 3],
      [4, 3],
      [3, 2],
      [4, 2],
    ],
  ],
  // Board 12
  [
    [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
      [2, 0],
      [3, 0],
      [4, 1],
      [3, 2],
      [2, 2],
      [3, 3],
    ],
    [
      [3, 1],
      [2, 1],
      [1, 2],
      [0, 3],
      [1, 3],
      [1, 2],
      [2, 2],
      [2, 3],
    ],
  ],
  // Board 13
  [
    [
      [1, 1],
      [0, 1],
      [0, 2],
      [1, 2],
      [0, 3],
      [0, 4],
    ],
    [
      [2, 3],
      [2, 2],
      [1, 2],
      [1, 3],
      [2, 2],
      [3, 3],
      [2, 4],
    ],
    [
      [1, 0],
      [2, 0],
      [3, 0],
      [2, 1],
      [3, 1],
    ],
  ],
  // Board 14
  [
    [
      [3, 0],
      [2, 0],
      [1, 1],
      [2, 2],
      [1, 2],
      [0, 1],
      [0, 2],
    ],
    [
      [1, 4],
      [1, 3],
      [2, 3],
      [2, 4],
      [3, 3],
      [4, 2],
      [4, 3],
      [3, 4],
      [4, 4],
    ],
    [
      [3, 1],
      [2, 1],
      [1, 1],
      [1, 2],
      [0, 3],
      [1, 3],
      [0, 4],
    ],
  ],
  // Board 15
  [
    [
      [1, 0],
      [2, 1],
      [3, 0],
      [4, 0],
      [4, 1],
      [3, 0],
      [3, 1],
      [2, 2],
      [3, 2],
    ],
    [
      [1, 2],
      [0, 1],
      [0, 2],
      [0, 3],
      [1, 3],
      [2, 3],
      [1, 4],
    ],
    [
      [1, 1],
      [2, 2],
      [3, 3],
      [2, 3],
      [3, 4],
      [3, 3],
      [4, 2],
      [4, 3],
    ],
  ],
  // Board 16
  [
    [
      [2, 2],
      [2, 1],
      [2, 0],
      [3, 0],
      [4, 0],
      [3, 1],
      [4, 1],
      [4, 2],
    ],
    [
      [1, 1],
      [2, 1],
      [3, 2],
      [2, 3],
      [1, 2],
      [1, 3],
      [0, 4],
    ],
    [
      [0, 2],
      [0, 3],
      [1, 3],
      [2, 3],
      [1, 4],
      [2, 4],
      [3, 3],
      [3, 4],
    ],
  ],
  // Board 17
  [
    [
      [2, 1],
      [3, 0],
      [4, 0],
      [3, 1],
      [2, 2],
      [1, 1],
      [0, 2],
      [1, 2],
      [0, 3],
    ],
    [
      [0, 1],
      [1, 1],
      [1, 2],
      [2, 2],
      [3, 3],
      [2, 3],
      [1, 2],
      [1, 3],
      [0, 4],
      [1, 4],
    ],
    [
      [3, 2],
      [4, 1],
      [5, 0],
      [5, 1],
      [4, 2],
      [5, 2],
      [4, 3],
      [3, 3],
      [3, 4],
      [4, 4],
    ],
  ],
  // Board 18
  [
    [
      [0, 0],
      [0, 1],
      [1, 1],
      [2, 2],
      [2, 3],
      [3, 3],
      [3, 4],
    ],
    [
      [4, 3],
      [4, 2],
      [3, 1],
      [3, 2],
      [3, 3],
      [4, 2],
      [5, 2],
      [4, 1],
      [5, 1],
      [5, 2],
      [5, 3],
      [5, 4],
      [4, 4],
    ],
    [
      [2, 1],
      [3, 2],
      [2, 2],
      [1, 2],
      [0, 2],
      [1, 3],
      [2, 2],
      [3, 3],
      [2, 4],
      [1, 4],
      [0, 4],
    ],
  ],
  // Board 19
  [
    [
      [3, 2],
      [3, 1],
      [2, 0],
      [3, 0],
      [4, 0],
      [3, 1],
      [4, 1],
      [4, 2],
    ],
    [
      [0, 3],
      [1, 3],
      [1, 4],
      [2, 3],
      [3, 3],
      [4, 4],
      [3, 4],
      [2, 4],
    ],
    [
      [1, 0],
      [1, 1],
      [2, 1],
      [3, 1],
      [2, 2],
      [1, 2],
      [1, 3],
      [2, 2],
      [3, 3],
      [4, 3],
    ],
  ],
  // Board 20
  [
    [
      [4, 0],
      [3, 0],
      [3, 1],
      [3, 2],
      [2, 1],
      [1, 1],
      [2, 2],
    ],
    [
      [1, 0],
      [0, 1],
      [1, 1],
      [0, 2],
      [1, 2],
      [0, 3],
      [1, 3],
      [1, 2],
      [2, 3],
      [1, 3],
      [0, 4],
      [1, 4],
      [2, 3],
      [2, 4],
    ],
    [
      [4, 1],
      [5, 1],
      [5, 2],
      [4, 3],
      [3, 2],
      [3, 3],
      [4, 3],
      [3, 4],
      [4, 4],
      [4, 3],
      [5, 4],
    ],
  ],
  // Board 21
  [
    [
      [5, 0],
      [4, 1],
      [4, 2],
      [3, 3],
      [4, 3],
      [5, 3],
      [4, 4],
      [3, 3],
      [3, 4],
      [2, 4],
      [2, 3],
    ],
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [2, 1],
      [2, 2],
      [3, 1],
      [4, 2],
      [5, 1],
      [5, 2],
      [4, 3],
      [4, 2],
      [3, 2],
    ],
    [
      [2, 0],
      [1, 0],
      [0, 1],
      [1, 1],
      [2, 2],
      [1, 3],
      [1, 4],
      [2, 4],
      [3, 3],
      [2, 2],
      [1, 2],
    ],
  ],
  // Board 22
  [
    [
      [0, 4],
      [0, 3],
      [0, 2],
      [1, 1],
      [1, 0],
      [2, 0],
      [3, 0],
      [3, 1],
      [2, 1],
      [1, 2],
      [0, 3],
      [1, 4],
    ],
    [
      [4, 2],
      [3, 3],
      [2, 4],
      [1, 5],
      [2, 5],
      [2, 4],
      [3, 5],
      [4, 5],
      [3, 4],
      [3, 3],
      [2, 3],
    ],
    [
      [2, 2],
      [2, 1],
      [3, 0],
      [4, 0],
      [4, 1],
      [5, 1],
      [5, 2],
      [4, 1],
      [3, 2],
      [3, 3],
      [4, 3],
      [4, 4],
      [5, 3],
    ],
  ],
  // Board 23
  [
    [
      [4, 0],
      [3, 1],
      [4, 2],
      [5, 1],
      [6, 2],
      [6, 3],
      [5, 2],
      [4, 3],
      [4, 4],
      [3, 4],
      [2, 4],
      [2, 3],
      [1, 2],
      [1, 1],
      [0, 1],
      [1, 0],
      [2, 1],
      [2, 2],
    ],
    [
      [2, 0],
      [1, 0],
      [0, 0],
      [0, 1],
      [0, 2],
      [1, 1],
      [2, 1],
      [3, 1],
      [3, 2],
      [2, 1],
      [3, 0],
    ],
    [
      [6, 4],
      [5, 4],
      [6, 5],
      [5, 5],
      [4, 5],
      [3, 5],
      [2, 5],
      [1, 4],
      [0, 4],
      [0, 5],
      [1, 4],
      [2, 4],
      [2, 5],
      [1, 5],
    ],
  ],
  // Board 24
  [
    [
      [4, 3],
      [4, 4],
      [3, 3],
      [3, 4],
      [2, 4],
      [2, 3],
      [1, 3],
      [0, 3],
      [1, 4],
      [0, 5],
      [1, 5],
      [2, 4],
      [2, 5],
    ],
    [
      [1, 1],
      [0, 1],
      [0, 0],
      [1, 0],
      [0, 1],
      [0, 2],
      [1, 2],
      [1, 3],
      [2, 4],
      [3, 5],
      [3, 4],
      [4, 4],
      [3, 5],
      [4, 5],
      [4, 4],
      [5, 5],
    ],
    [
      [2, 2],
      [3, 1],
      [2, 0],
      [3, 0],
      [4, 1],
      [5, 1],
      [5, 0],
      [6, 1],
      [5, 1],
      [5, 2],
      [5, 3],
      [6, 3],
      [6, 4],
      [5, 4],
    ],
  ],
];

/** The `cols x rows` each board's heading states in specs/campaign-boards.md. */
const DIMENSIONS: readonly [number, number][] = [
  [3, 3],
  [3, 3],
  [4, 3],
  [4, 3],
  [4, 4],
  [4, 4],
  [4, 4],
  [5, 4],
  [4, 4],
  [5, 4],
  [5, 4],
  [5, 4],
  [4, 5],
  [5, 5],
  [5, 5],
  [5, 5],
  [6, 5],
  [6, 5],
  [5, 5],
  [6, 5],
  [6, 5],
  [6, 6],
  [7, 6],
  [7, 6],
];

function route(cells: readonly (readonly [number, number])[]): Cell[] {
  return cells.map(([col, row]) => ({ col, row }));
}

/** The crystals of one campaign board, by 0-based index. */
function crystalsOf(index: number) {
  return campaignBoard(index).nodes.filter((node) => node.kind === "crystal");
}

describe("the campaign boards", () => {
  it("holds exactly CAMPAIGN_LENGTH boards", () => {
    expect(CAMPAIGN_BOARDS).toHaveLength(CAMPAIGN_LENGTH);
    expect(SOLUTIONS).toHaveLength(CAMPAIGN_LENGTH);
  });

  it("parses every board at the dimensions its heading states", () => {
    DIMENSIONS.forEach(([cols, rows], index) => {
      const board = campaignBoard(index);
      expect([board.cols, board.rows], `board ${index + 1}`).toEqual([
        cols,
        rows,
      ]);
    });
  });

  it("gives Set A a single channel, no crystals, and at least two solutions each", () => {
    for (let index = 0; index < 6; index++) {
      const board = campaignBoard(index);
      expect(channelsOn(board), `board ${index + 1}`).toEqual(["triangle"]);
      expect(
        board.nodes.some((node) => node.kind === "crystal"),
        `board ${index + 1}`,
      ).toBe(false);
      // The set's stated latitude: none of its boards is a forced march.
      const measured = measureDifficulty(board, 2);
      expect(measured, `board ${index + 1}`).not.toBeNull();
      expect(measured?.solutions, `board ${index + 1}`).toBeGreaterThanOrEqual(
        2,
      );
    }
  });

  it("stands the course's first crystal on board 9, carrying two charges", () => {
    for (let index = 0; index < 8; index++) {
      expect(crystalsOf(index), `board ${index + 1}`).toHaveLength(0);
    }
    const crystals = crystalsOf(8);
    expect(crystals).toHaveLength(1);
    expect(crystals[0].charges).toBe(2);
  });

  it("holds MAX_CHARGES back until board 17, then doubles it on board 18", () => {
    for (let index = 0; index < 16; index++) {
      const charges = crystalsOf(index).map((node) => node.charges);
      expect(charges, `board ${index + 1}`).not.toContain(MAX_CHARGES);
    }
    const seventeenth = crystalsOf(16).map((node) => node.charges);
    expect(seventeenth).toContain(MAX_CHARGES);
    const eighteenth = crystalsOf(17).filter(
      (node) => node.charges === MAX_CHARGES,
    );
    expect(eighteenth).toHaveLength(2);
  });

  it("fills the whole grid on boards 23 and 24", () => {
    for (const index of [22, 23]) {
      const board = campaignBoard(index);
      expect([board.cols, board.rows], `board ${index + 1}`).toEqual([
        GRID_MAX_COLS,
        GRID_MAX_ROWS,
      ]);
    }
  });

  it("refuses an index outside the course", () => {
    expect(() => campaignBoard(-1)).toThrow(RangeError);
    expect(() => campaignBoard(CAMPAIGN_LENGTH)).toThrow(RangeError);
  });

  describe("every board is solvable through the pointer path", () => {
    const debug = createDebugApi();
    SOLUTIONS.forEach((solution, index) => {
      it(`solves board ${index + 1}`, () => {
        let state: RefractState = debug.loadBoard(
          createInitialState(),
          CAMPAIGN_BOARDS[index],
        );
        expect(channelsOn(state.board)).toHaveLength(solution.length);
        for (const channelRoute of solution) {
          state = traceRoute(debug, state, route(channelRoute));
        }
        const snapshot = debug.snapshot(state);
        expect(snapshot.solved).toBe(true);
        for (const beam of Object.values(snapshot.beams)) {
          expect(beam.complete).toBe(true);
        }
        for (const node of snapshot.board.nodes) {
          if (node.kind === "crystal") expect(node.spent).toBe(node.charges);
        }
      });
    });
  });
});

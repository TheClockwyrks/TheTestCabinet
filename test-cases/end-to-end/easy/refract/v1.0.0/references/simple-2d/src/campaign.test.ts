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
import { channelsOn } from "./board";
import { CAMPAIGN_BOARDS, campaignBoard } from "./campaign";
import { CAMPAIGN_LENGTH } from "./constants";
import { createDebugApi } from "./debug";
import { createInitialState } from "./flow";
import type { Cell, RefractState } from "./game";

/**
 * One known solution per board, found by exhaustive search over the ruleset
 * and replayed through the pointer path below: per board, one route per
 * channel present, in CHANNELS order, as `[col, row]` pairs.
 */
const SOLUTIONS: readonly (readonly (readonly [number, number][])[])[] = [
  // Board 1
  [
    [
      [2, 1],
      [1, 0],
      [1, 1],
      [0, 2],
    ],
  ],
  // Board 2
  [
    [
      [1, 0],
      [0, 1],
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
      [1, 2],
      [2, 1],
      [3, 1],
    ],
  ],
  // Board 4
  [
    [
      [3, 1],
      [3, 2],
      [2, 1],
      [1, 0],
      [0, 1],
      [1, 2],
      [2, 2],
    ],
  ],
  // Board 5
  [
    [
      [2, 2],
      [3, 3],
      [3, 2],
      [2, 1],
      [2, 0],
      [1, 1],
      [1, 2],
      [0, 3],
    ],
  ],
  // Board 6
  [
    [
      [3, 0],
      [2, 1],
      [1, 0],
      [0, 1],
      [0, 2],
      [0, 3],
      [1, 2],
      [2, 3],
      [1, 3],
    ],
  ],
  // Board 7
  [
    [
      [1, 1],
      [0, 1],
      [0, 2],
      [1, 3],
      [2, 3],
    ],
    [
      [3, 0],
      [2, 1],
      [3, 2],
      [3, 3],
      [2, 2],
    ],
  ],
  // Board 8
  [
    [
      [0, 2],
      [0, 1],
      [1, 1],
      [2, 0],
      [3, 1],
      [3, 2],
    ],
    [
      [1, 2],
      [2, 3],
      [3, 3],
      [4, 2],
      [4, 3],
    ],
  ],
  // Board 9
  [
    [
      [0, 0],
      [0, 1],
      [1, 2],
      [2, 2],
      [3, 3],
      [3, 2],
      [2, 1],
    ],
  ],
  // Board 10
  [
    [
      [0, 0],
      [1, 0],
      [2, 1],
      [2, 2],
      [3, 1],
      [4, 2],
    ],
    [
      [0, 1],
      [1, 1],
      [2, 2],
      [2, 3],
      [1, 3],
    ],
  ],
  // Board 11
  [
    [
      [1, 0],
      [0, 1],
      [1, 1],
      [2, 0],
      [3, 0],
      [3, 1],
      [3, 2],
    ],
    [
      [4, 0],
      [3, 0],
      [2, 1],
      [1, 2],
      [0, 3],
      [0, 2],
    ],
  ],
  // Board 12
  [
    [
      [1, 0],
      [1, 1],
      [2, 0],
      [3, 0],
      [4, 0],
      [3, 1],
      [2, 2],
      [3, 3],
    ],
    [
      [2, 1],
      [1, 1],
      [0, 1],
      [1, 2],
      [2, 3],
      [2, 4],
    ],
  ],
  // Board 13
  [
    [
      [3, 1],
      [4, 2],
      [4, 3],
      [4, 4],
      [3, 3],
      [2, 3],
      [1, 3],
      [2, 4],
    ],
    [
      [2, 0],
      [1, 0],
      [0, 1],
      [0, 2],
      [1, 2],
      [0, 1],
      [1, 1],
    ],
  ],
  // Board 14
  [
    // prettier-ignore
    [[2, 1], [3, 1], [4, 0], [5, 0], [5, 1], [4, 0], [3, 0], [2, 0], [1, 1], [0, 2]],
    [
      [2, 3],
      [1, 2],
      [1, 3],
      [0, 4],
      [1, 4],
      [1, 3],
      [2, 4],
      [3, 4],
    ],
  ],
  // Board 15
  [
    [
      [0, 3],
      [1, 2],
      [1, 3],
      [0, 4],
      [1, 4],
      [2, 4],
      [3, 4],
    ],
    [
      [0, 0],
      [0, 1],
      [1, 0],
      [2, 0],
      [2, 1],
      [3, 1],
    ],
    [
      [3, 2],
      [2, 1],
      [3, 0],
      [4, 0],
      [4, 1],
      [4, 2],
    ],
  ],
  // Board 16
  [
    [
      [1, 1],
      [0, 2],
      [0, 3],
      [0, 4],
      [1, 4],
      [0, 3],
      [1, 2],
      [2, 2],
    ],
    [
      [5, 2],
      [4, 3],
      [3, 2],
      [2, 3],
      [3, 4],
      [4, 4],
      [5, 4],
    ],
    [
      [3, 1],
      [2, 0],
      [3, 0],
      [4, 1],
      [4, 2],
      [3, 2],
      [3, 3],
    ],
  ],
  // Board 17
  [
    // prettier-ignore
    [[2, 0], [1, 1], [0, 2], [0, 3], [0, 4], [1, 4], [0, 3], [1, 3], [2, 2], [3, 2], [3, 3]],
    [
      [5, 1],
      [4, 0],
      [3, 0],
      [2, 1],
      [3, 2],
      [4, 2],
      [4, 3],
      [4, 4],
      [5, 4],
    ],
  ],
  // Board 18
  [
    [
      [2, 0],
      [1, 0],
      [0, 0],
      [1, 1],
      [1, 0],
      [2, 1],
      [3, 0],
      [3, 1],
      [2, 2],
    ],
    [
      [1, 3],
      [2, 3],
      [3, 4],
      [4, 5],
      [5, 4],
      [4, 3],
      [5, 2],
      [5, 3],
    ],
    [
      [5, 0],
      [4, 1],
      [5, 2],
      [4, 2],
      [3, 2],
      [3, 3],
      [4, 4],
    ],
  ],
  // Board 19
  [
    // prettier-ignore
    [[1, 4], [1, 5], [2, 5], [3, 5], [3, 4], [3, 3], [4, 3], [4, 4], [5, 5], [4, 5]],
    [
      [2, 1],
      [1, 2],
      [0, 1],
      [1, 1],
      [0, 0],
      [1, 0],
      [1, 1],
      [1, 2],
      [2, 3],
    ],
    [
      [4, 2],
      [3, 1],
      [2, 0],
      [3, 0],
      [4, 0],
      [5, 1],
      [5, 2],
      [5, 3],
    ],
  ],
  // Board 20
  [
    // prettier-ignore
    [[4, 1], [4, 0], [5, 1], [6, 0], [6, 1], [5, 2], [6, 3], [6, 4], [5, 3], [4, 2]],
    [
      [0, 1],
      [0, 2],
      [1, 2],
      [1, 3],
      [0, 2],
      [0, 3],
      [1, 3],
      [2, 4],
      [1, 4],
    ],
    [
      [1, 0],
      [2, 0],
      [3, 0],
      [2, 1],
      [2, 0],
      [1, 1],
      [2, 1],
      [3, 1],
    ],
  ],
  // Board 21
  [
    // prettier-ignore
    [[4, 0], [3, 1], [2, 2], [1, 2], [0, 1], [0, 2], [1, 2], [1, 3], [0, 2], [0, 3], [1, 3], [2, 3], [1, 4], [1, 3], [0, 4]],
    // prettier-ignore
    [[6, 1], [6, 0], [5, 0], [5, 1], [4, 2], [5, 3], [6, 3], [6, 4], [5, 5], [6, 5], [6, 4], [5, 4]],
  ],
  // Board 22
  [
    // prettier-ignore
    [[5, 1], [6, 1], [6, 2], [6, 3], [6, 4], [5, 4], [5, 5], [6, 4], [6, 5], [5, 5], [4, 5], [3, 4]],
    // prettier-ignore
    [[0, 0], [1, 0], [1, 1], [1, 2], [0, 1], [0, 2], [1, 2], [2, 2], [3, 3], [2, 3], [1, 4]],
    [
      [4, 0],
      [5, 0],
      [4, 1],
      [3, 2],
      [3, 3],
      [4, 4],
      [4, 3],
      [3, 2],
      [3, 1],
    ],
  ],
  // Board 23
  [
    // prettier-ignore
    [[0, 0], [0, 1], [0, 2], [1, 3], [0, 4], [0, 5], [1, 5], [2, 4], [3, 3], [4, 4], [5, 3], [6, 4], [6, 3]],
    // prettier-ignore
    [[4, 0], [3, 1], [2, 0], [1, 0], [1, 1], [2, 2], [3, 3], [3, 2], [4, 3], [5, 3], [6, 2]],
    // prettier-ignore
    [[5, 1], [6, 1], [5, 2], [4, 3], [3, 3], [3, 4], [4, 4], [3, 5], [2, 4], [1, 4]],
  ],
  // Board 24
  [
    // prettier-ignore
    [[0, 1], [1, 0], [2, 1], [3, 2], [3, 3], [3, 4], [2, 5], [1, 5], [0, 4], [0, 5], [1, 5], [1, 4], [2, 3]],
    // prettier-ignore
    [[0, 0], [1, 0], [1, 1], [0, 2], [0, 3], [1, 3], [1, 2], [2, 1], [2, 0], [3, 0], [4, 1], [5, 0]],
    // prettier-ignore
    [[2, 2], [3, 2], [4, 2], [5, 3], [6, 3], [5, 2], [6, 1], [6, 2], [6, 3], [5, 4], [4, 4]],
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
  [5, 5],
  [5, 5],
  [6, 5],
  [5, 5],
  [6, 5],
  [6, 5],
  [6, 6],
  [6, 6],
  [7, 5],
  [7, 6],
  [7, 6],
  [7, 6],
  [7, 6],
];

function route(cells: readonly (readonly [number, number])[]): Cell[] {
  return cells.map(([col, row]) => ({ col, row }));
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

  it("gives Set A a single channel and no crystals", () => {
    for (let index = 0; index < 6; index++) {
      const board = campaignBoard(index);
      expect(channelsOn(board)).toEqual(["triangle"]);
      expect(board.nodes.some((node) => node.kind === "crystal")).toBe(false);
    }
  });

  it("stands board 9's single crystal at one charge", () => {
    const crystals = campaignBoard(8).nodes.filter(
      (node) => node.kind === "crystal",
    );
    expect(crystals).toHaveLength(1);
    expect(crystals[0].charges).toBe(1);
  });

  it("stands a full MAX_CHARGES crystal on boards 21 and 23", () => {
    for (const index of [20, 22]) {
      const charges = campaignBoard(index)
        .nodes.filter((node) => node.kind === "crystal")
        .map((node) => node.charges);
      expect(charges, `board ${index + 1}`).toContain(3);
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
          state = debug.trace(state, route(channelRoute));
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

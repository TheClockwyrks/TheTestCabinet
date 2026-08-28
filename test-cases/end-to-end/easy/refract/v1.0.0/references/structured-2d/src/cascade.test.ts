// Cascade's generator: the tier ladder, determinism, the structural
// requirements every emitted board satisfies, and — the central requirement —
// solvability, proven by replaying each board's carved solution through a
// real engine's debug surface, which feeds the same per-sample pointer path a
// player draws through.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { channelsOn } from "./board";
import {
  fallbackBoard,
  generateBoard,
  generateBoardWithSolution,
  solutionSolves,
  tierFor,
} from "./cascade";
import {
  CHANNELS,
  GRID_MAX_COLS,
  GRID_MAX_ROWS,
  MAX_TIER,
  TIER_ADVANCE,
  TIERS,
} from "./constants";
import { createHarness, type Harness } from "./harness";
import type { BoardState } from "./game";

describe("the tier ladder", () => {
  it("climbs one step every TIER_ADVANCE boards and tops out at MAX_TIER", () => {
    expect(tierFor(0)).toBe(1);
    expect(tierFor(TIER_ADVANCE - 1)).toBe(1);
    expect(tierFor(TIER_ADVANCE)).toBe(2);
    expect(tierFor(4 * TIER_ADVANCE - 1)).toBe(4);
    expect(tierFor(4 * TIER_ADVANCE)).toBe(MAX_TIER);
    expect(tierFor(100 * TIER_ADVANCE)).toBe(MAX_TIER);
  });
});

describe("determinism", () => {
  it("emits the same board and advanced state for the same seed", () => {
    const first = generateBoardWithSolution(1234, 3);
    const second = generateBoardWithSolution(1234, 3);
    expect(second.board).toEqual(first.board);
    expect(second.solution).toEqual(first.solution);
    expect(second.rngState).toBe(first.rngState);
  });

  it("advances the state, so the next board follows from the previous one", () => {
    const first = generateBoard(42, 2);
    expect(first.rngState).not.toBe(42);
    const second = generateBoard(first.rngState, 2);
    expect(second.board).not.toEqual(first.board);
  });
});

/** Every structural requirement the tier table fixes for an emitted board. */
function expectWellFormed(
  board: BoardState,
  tier: number,
  label: string,
): void {
  const spec = TIERS[tier - 1];
  expect(board.cols, label).toBeGreaterThanOrEqual(spec.minCols);
  expect(board.cols, label).toBeLessThanOrEqual(spec.maxCols);
  expect(board.rows, label).toBeGreaterThanOrEqual(spec.minRows);
  expect(board.rows, label).toBeLessThanOrEqual(spec.maxRows);

  // The first n of CHANNELS, exactly.
  expect(channelsOn(board), label).toEqual([
    ...CHANNELS.slice(0, spec.channels),
  ]);
  for (const channel of channelsOn(board)) {
    const emitters = board.nodes.filter(
      (node) => node.kind === "emitter" && node.channel === channel,
    );
    expect(emitters, `${label} ${channel}`).toHaveLength(2);
  }

  const crystals = board.nodes.filter((node) => node.kind === "crystal");
  expect(crystals.length, label).toBeGreaterThanOrEqual(spec.minCrystals);
  expect(crystals.length, label).toBeLessThanOrEqual(spec.maxCrystals);
  for (const crystal of crystals) {
    expect(crystal.charges, label).toBeGreaterThanOrEqual(
      Math.max(1, spec.minCharges),
    );
    expect(crystal.charges, label).toBeLessThanOrEqual(spec.maxCharges);
  }
}

describe("emitted boards", () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
  });

  afterAll(() => {
    h.dispose();
  });

  it("satisfies the tier's structure and solves, across seeds and tiers", () => {
    for (let tier = 1; tier <= MAX_TIER; tier++) {
      let rngState = 1000 + tier;
      for (let round = 0; round < 8; round++) {
        const label = `tier ${tier} round ${round}`;
        const generated = generateBoardWithSolution(rngState, tier);
        rngState = generated.rngState;
        expectWellFormed(generated.board, tier, label);
        expect(solutionSolves(generated.board, generated.solution), label).toBe(
          true,
        );

        // The same solution, drawn through the real pointer path.
        h.debug.reset();
        h.debug.loadBoard(boardNotation(generated.board));
        for (const route of generated.solution) {
          h.debug.trace(route);
        }
        expect(h.debug.snapshot().solved, label).toBe(true);
      }
    }
  });

  it("draws each grid size from the tier's range; tier 5 is always 7x6", () => {
    let rngState = 7;
    for (let round = 0; round < 6; round++) {
      const { board, rngState: next } = generateBoard(rngState, MAX_TIER);
      rngState = next;
      expect(board.cols).toBe(GRID_MAX_COLS);
      expect(board.rows).toBe(GRID_MAX_ROWS);
    }
  });
});

describe("the fallback board", () => {
  it("is well-formed and solvable at every tier", () => {
    for (let tier = 1; tier <= MAX_TIER; tier++) {
      const { board, solution } = fallbackBoard(TIERS[tier - 1]);
      expectWellFormed(board, tier, `fallback tier ${tier}`);
      expect(solutionSolves(board, solution)).toBe(true);
    }
  });
});

/** A board rendered back to notation, to feed `loadBoard`. */
function boardNotation(board: BoardState): string[] {
  const emitters = { triangle: "T", square: "S", diamond: "D" } as const;
  const lenses = { triangle: "t", square: "s", diamond: "d" } as const;
  const rows: string[] = [];
  for (let row = 0; row < board.rows; row++) {
    let line = "";
    for (let col = 0; col < board.cols; col++) {
      const node = board.nodes.find(
        (entry) => entry.col === col && entry.row === row,
      );
      if (!node) line += ".";
      else if (node.kind === "crystal") line += String(node.charges);
      else if (node.kind === "emitter") {
        line += emitters[node.channel as keyof typeof emitters];
      } else line += lenses[node.channel as keyof typeof lenses];
    }
    rows.push(line);
  }
  return rows;
}

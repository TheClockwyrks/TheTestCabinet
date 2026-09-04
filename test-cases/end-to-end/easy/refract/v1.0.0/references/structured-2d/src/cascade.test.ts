// Cascade's generator: the tier ladder, determinism, the structural
// requirements every emitted board satisfies, and — the central requirements —
// solvability, proven by replaying each board's carved solution through a
// real engine's debug surface, which feeds the same per-sample pointer path a
// player draws through, and the difficulty floor, held against the five
// measures in `src/difficulty.ts`.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { channelsOn } from "./board";
import {
  generateBoard,
  generateBoardWithSolution,
  reserveBoard,
  solutionSolves,
  tierFor,
} from "./cascade";
import { CHANNELS, MAX_TIER, TIER_ADVANCE, TIERS } from "./constants";
import { measureDifficulty, meetsFloor } from "./difficulty";
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

  it("puts a twenty-five-board run at five boards per rung", () => {
    // Five rungs of five: the twenty-first board is the first generated past
    // the twentieth solve, so it is the first at the top rung, and the ladder
    // holds there through the twenty-fifth and beyond.
    expect(TIER_ADVANCE).toBe(5);
    expect(MAX_TIER).toBe(5);
    expect(TIERS).toHaveLength(MAX_TIER);
    for (let solved = 0; solved < MAX_TIER * TIER_ADVANCE; solved++) {
      expect(tierFor(solved)).toBe(Math.floor(solved / TIER_ADVANCE) + 1);
    }
    expect(tierFor(20)).toBe(MAX_TIER);
    expect(tierFor(24)).toBe(MAX_TIER);
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

  // The tier's cap on cells left empty.
  expect(
    board.cols * board.rows - board.nodes.length,
    label,
  ).toBeLessThanOrEqual(spec.maxEmptyCells);

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
          h.trace(route);
        }
        expect(h.debug.snapshot().solved, label).toBe(true);
      }
    }
  });

  it("draws each board's grid size from its tier's stated range", () => {
    for (let tier = 1; tier <= MAX_TIER; tier++) {
      const spec = TIERS[tier - 1];
      let rngState = 7 + tier;
      for (let round = 0; round < 6; round++) {
        const label = `tier ${tier} round ${round}`;
        const { board, rngState: next } = generateBoard(rngState, tier);
        rngState = next;
        expect(board.cols, label).toBeGreaterThanOrEqual(spec.minCols);
        expect(board.cols, label).toBeLessThanOrEqual(spec.maxCols);
        expect(board.rows, label).toBeGreaterThanOrEqual(spec.minRows);
        expect(board.rows, label).toBeLessThanOrEqual(spec.maxRows);
      }
    }
  });

  it("meets the tier's difficulty floor, along a played sequence", () => {
    // The first twelve boards of a run, exactly as a player would meet them:
    // one seed threaded board to board, the tier climbing every TIER_ADVANCE
    // solves. Each board is re-measured from scratch with the module the
    // generator itself trusts, and held to its tier's floor — solutions,
    // determined share, branching, shared crystals, and routes per channel,
    // all within the TIERS entry's bounds. Twelve boards keep the runtime
    // modest while crossing three rungs of the ladder.
    let rngState = 20260827;
    for (let solved = 0; solved < 12; solved++) {
      const tier = tierFor(solved);
      const spec = TIERS[tier - 1];
      const label = `board ${solved + 1}, tier ${tier}`;
      const generated = generateBoardWithSolution(rngState, tier);
      rngState = generated.rngState;
      const measured = measureDifficulty(
        generated.board,
        spec.maxSolutions + 1,
        spec.minRoutes,
      );
      expect(measured, label).not.toBeNull();
      if (measured === null) continue;
      expect(measured.capped, label).toBe(false);
      expect(meetsFloor(measured, spec), label).toBe(true);
    }
  });
});

describe("the reserve boards", () => {
  it("is well-formed and solvable at every tier", () => {
    // A reserve is the fixed board a tier falls back to only when every
    // attempt in the generator's budget misses. Each must parse, satisfy its
    // tier's whole structural row, and be solved by the solution stored
    // beside it, replayed through the real ruleset.
    for (let tier = 1; tier <= MAX_TIER; tier++) {
      const { board, solution } = reserveBoard(tier);
      expectWellFormed(board, tier, `reserve tier ${tier}`);
      expect(solutionSolves(board, solution)).toBe(true);
    }
  });

  it("meets its tier's difficulty floor too", () => {
    // The reserve carries the same contract as an emitted board: the floor
    // holds even on the path taken only when generation runs dry.
    for (let tier = 1; tier <= MAX_TIER; tier++) {
      const spec = TIERS[tier - 1];
      const { board } = reserveBoard(tier);
      const measured = measureDifficulty(
        board,
        spec.maxSolutions + 1,
        spec.minRoutes,
      );
      expect(measured, `reserve tier ${tier}`).not.toBeNull();
      if (measured === null) continue;
      expect(measured.capped, `reserve tier ${tier}`).toBe(false);
      expect(meetsFloor(measured, spec), `reserve tier ${tier}`).toBe(true);
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

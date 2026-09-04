// Cascade's generator: the tier ladder, determinism, the structural
// requirements every emitted board satisfies, the difficulty floor every
// emitted board clears, and — the central requirement — solvability, proven
// by replaying each board's carved solution through the debug surface's
// pointer path. The per-tier reserve boards are held to the same contract,
// since even the last resort keeps the sequence's guarantees.

import { describe, expect, it } from "vitest";
import { cellCenter, channelsOn } from "./board";
import {
  generateBoard,
  generateBoardWithSolution,
  reserveBoard,
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
import { measureDifficulty, meetsFloor } from "./difficulty";
import { createDebugApi, type RefractDebugApi } from "./debug";
import { createInitialState } from "./flow";
import type { BoardState, RefractState } from "./game";

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

describe("the tier ladder", () => {
  it("climbs one step every TIER_ADVANCE boards and tops out at MAX_TIER", () => {
    expect(tierFor(0)).toBe(1);
    expect(tierFor(TIER_ADVANCE - 1)).toBe(1);
    expect(tierFor(TIER_ADVANCE)).toBe(2);
    expect(tierFor(4 * TIER_ADVANCE - 1)).toBe(4);
    expect(tierFor(4 * TIER_ADVANCE)).toBe(MAX_TIER);
    expect(tierFor(100 * TIER_ADVANCE)).toBe(MAX_TIER);
  });

  it("makes the twenty-first board the first top-tier board", () => {
    // Five rungs of five boards each: boards 1..20 climb tiers 1..4, and the
    // board arriving after the twentieth solve is generated at MAX_TIER — so
    // a twenty-five-board sweep crosses the whole ladder with five boards on
    // every rung, the top one included.
    expect(MAX_TIER * TIER_ADVANCE).toBe(25);
    expect(tierFor(TIER_ADVANCE * (MAX_TIER - 1) - 1)).toBe(MAX_TIER - 1);
    expect(tierFor(TIER_ADVANCE * (MAX_TIER - 1))).toBe(MAX_TIER);
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

  // The empty-cells cap: the tier's boards crowd the bench they are given.
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

/** The board's five measures, held to every bound its tier's row states. */
function expectMeetsFloor(
  board: BoardState,
  tier: number,
  label: string,
): void {
  const spec = TIERS[tier - 1];
  const measured = measureDifficulty(
    board,
    spec.maxSolutions + 1,
    spec.minRoutes,
  );
  expect(measured, label).not.toBeNull();
  if (measured === null) return;
  expect(measured.capped, `${label} (enumeration ran to completion)`).toBe(
    false,
  );
  expect(meetsFloor(measured, spec), `${label} (the tier's floor)`).toBe(true);
}

describe("emitted boards", () => {
  it("satisfies the tier's structure and solves, across seeds and tiers", () => {
    const debug = createDebugApi();
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
        let state = createInitialState();
        state = { ...state, mode: "cascade" };
        state = {
          ...debug.loadBoard(state, boardNotation(generated.board)),
        };
        for (const route of generated.solution) {
          state = traceRoute(debug, state, route);
        }
        expect(debug.snapshot(state).solved, label).toBe(true);
      }
    }
  });

  it("meets the difficulty floor along a run's own opening sweep", () => {
    // The first twelve boards of a fixed-seed run, generated at the tier the
    // ladder puts each arrival at (board k arrives after k solves), each
    // remeasured against its tier's row — a modest sweep, since the fuller
    // per-tier structure-and-solvability loop above already draws the
    // generator forty times.
    let rngState = 20;
    for (let solved = 0; solved < 12; solved++) {
      const tier = tierFor(solved);
      const label = `board ${solved + 1} (tier ${tier})`;
      const generated = generateBoard(rngState, tier);
      rngState = generated.rngState;
      expectMeetsFloor(generated.board, tier, label);
    }
  });

  it("draws each grid size from the tier's range, up to the full 7x6", () => {
    const spec = TIERS[MAX_TIER - 1];
    expect(spec.maxCols).toBe(GRID_MAX_COLS);
    expect(spec.maxRows).toBe(GRID_MAX_ROWS);
    const sizes = new Set<string>();
    let rngState = 7;
    for (let round = 0; round < 8; round++) {
      const { board, rngState: next } = generateBoard(rngState, MAX_TIER);
      rngState = next;
      expect(board.cols).toBeGreaterThanOrEqual(spec.minCols);
      expect(board.cols).toBeLessThanOrEqual(spec.maxCols);
      expect(board.rows).toBeGreaterThanOrEqual(spec.minRows);
      expect(board.rows).toBeLessThanOrEqual(spec.maxRows);
      sizes.add(`${board.cols}x${board.rows}`);
    }
    // A range, not a single shape: the rounds really draw from it.
    expect(sizes.size).toBeGreaterThan(1);
  });
});

describe("the reserve boards", () => {
  it("is well-formed, on the floor, and solvable at every tier", () => {
    for (let tier = 1; tier <= MAX_TIER; tier++) {
      const { board, solution } = reserveBoard(tier);
      expectWellFormed(board, tier, `reserve tier ${tier}`);
      expectMeetsFloor(board, tier, `reserve tier ${tier}`);
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

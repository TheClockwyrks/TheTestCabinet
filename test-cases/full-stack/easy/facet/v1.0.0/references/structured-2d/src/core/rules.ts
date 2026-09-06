// Facet — the ruleset, R1 to R9 (specs/rules.md).
//
// This module is the whole of the game's logic over a board, and it is written
// as pure functions of a board: nothing here reads a clock, a canvas, or the
// game's wider state, and nothing here decides WHEN a rule runs. The order a
// chain step evaluates them in belongs to `chain.ts`, which is where the
// specification's `## A chain step` list is written down.
//
// The split follows the specification's own: the MOVE RULES (R1, R2, R3) decide
// whether a requested swap is accepted, and the RESOLUTION RULES (R4 to R9)
// decide what a chain step does to the board and refuse nothing.

import {
  BASE_SCORE,
  FLAWED_SCORE,
  GEM_KINDS,
  MATCH_MIN,
  MAX_STRAIN,
} from "../constants";
import {
  cellsOf,
  gemAt,
  inBounds,
  isFlawed,
  orthogonalNeighbors,
  orthogonallyAdjacent,
  kindForLetter,
  plainGem,
  sameCell,
  surroundingCells,
} from "./board";
import type { Picker } from "./random";
import type { BoardState, Cell, CellPair, Gem, GemKind, Phase } from "./state";

/** A maximal run under R4: three or more of one kind, in one line. */
export interface Run {
  readonly kind: GemKind;
  readonly orientation: "row" | "column";
  /**
   * The run's cells, indexed `0..n-1` from its lowest-column end for a row run
   * and from its lowest-row end for a column run, which is the indexing R8's
   * placement rule counts from.
   */
  readonly cells: readonly Cell[];
}

// ---- A set of cells ------------------------------------------------------

/**
 * A set of cells, keyed by address. The rules work over sets constantly — the
 * clear set, its seed, the cells R7 looks around — and a `Set` of strings is
 * the one representation that makes membership, union, and iteration in
 * reading order all cheap.
 */
export type CellSet = ReadonlySet<string>;

/** The key a cell is held in a `CellSet` under. */
export function cellKey(cell: Cell): string {
  return `${cell.col},${cell.row}`;
}

/** The cells of a set, in reading order, so every consumer sees one order. */
export function cellsIn(board: BoardState, cells: CellSet): Cell[] {
  return cellsOf(board).filter((cell) => cells.has(cellKey(cell)));
}

// ---- R4 Runs -------------------------------------------------------------

/**
 * Every maximal run on the board (R4).
 *
 * A run is `MATCH_MIN` or more gems of one kind on consecutive cells of a
 * single row or column, and it is maximal when neither cell just beyond its
 * ends holds that kind. Scanning each line for the longest same-kind stretches
 * yields exactly the maximal ones, so being maximal is a property of the
 * scan rather than a filter over it. A prism has no kind, so it ends whatever
 * stretch it sits in and joins no run.
 *
 * Runs come back rows first in row order, then columns in column order, which
 * fixes the order R8 reads them in.
 */
export function maximalRuns(board: BoardState): Run[] {
  const runs: Run[] = [];

  const scan = (
    orientation: "row" | "column",
    lines: number,
    length: number,
    at: (line: number, index: number) => Cell,
  ): void => {
    for (let line = 0; line < lines; line++) {
      let start = 0;
      while (start < length) {
        const kind = gemAt(board, at(line, start))?.kind ?? null;
        let end = start + 1;
        if (kind !== null) {
          while (end < length && gemAt(board, at(line, end))?.kind === kind) {
            end++;
          }
        }
        if (kind !== null && end - start >= MATCH_MIN) {
          const cells: Cell[] = [];
          for (let index = start; index < end; index++) {
            cells.push(at(line, index));
          }
          runs.push({ kind, orientation, cells });
        }
        start = end;
      }
    }
  };

  scan("row", board.rows, board.cols, (row, col) => ({ col, row }));
  scan("column", board.cols, board.rows, (col, row) => ({ col, row }));
  return runs;
}

// ---- R5 Seeding ----------------------------------------------------------

/** What R5 seeded a step with, and the runs R8 will read back out of it. */
export interface StepSeed {
  readonly cells: CellSet;
  /**
   * The maximal runs the seed came from. A step seeded from a prism swap has
   * none of them, which is exactly why R8 creates nothing on such a step.
   */
  readonly runs: readonly Run[];
}

/** The union of every maximal run on the board, which is R5's ordinary seed. */
export function seedFromRuns(board: BoardState): StepSeed {
  const runs = maximalRuns(board);
  const cells = new Set<string>();
  for (const run of runs) {
    for (const cell of run.cells) cells.add(cellKey(cell));
  }
  return { cells, runs };
}

/**
 * R5's special seed for step `1` of a chain begun by a swap that traded a
 * prism, read off the board AFTER the exchange, or `null` when the swap traded
 * no prism at all.
 *
 * Prism against prism seeds every cell on the board. Prism against a gem seeds
 * that prism together with every gem on the board of the traded gem's kind —
 * and the traded gem is the one now sitting where the prism came from.
 */
export function prismSeed(board: BoardState, swap: CellPair): StepSeed | null {
  const a = gemAt(board, swap.a);
  const b = gemAt(board, swap.b);
  if (!a || !b) return null;
  const aPrism = a.cut === "prism";
  const bPrism = b.cut === "prism";
  if (!aPrism && !bPrism) return null;

  const cells = new Set<string>();
  if (aPrism && bPrism) {
    for (const cell of cellsOf(board)) cells.add(cellKey(cell));
    return { cells, runs: [] };
  }
  const prismCell = aPrism ? swap.a : swap.b;
  const kind = (aPrism ? b : a).kind;
  cells.add(cellKey(prismCell));
  for (const cell of cellsOf(board)) {
    if (gemAt(board, cell)?.kind === kind) cells.add(cellKey(cell));
  }
  return { cells, runs: [] };
}

// ---- R6 Expansion --------------------------------------------------------

/**
 * The clear set and the wave every cell of it carries.
 *
 * `cells` is the set the rest of the step reads, `waveOf` is the wave each cell
 * came in at, and `waves` is the greatest of them, which is `0` when the set is
 * its seed alone. A wave changes nothing about which cells the set holds, what
 * the set scores, or what the step removes: it is what times the shattering.
 */
export interface ClearSet {
  readonly cells: CellSet;
  readonly waveOf: ReadonlyMap<string, number>;
  readonly waves: number;
}

/**
 * The clear set: the smallest set of cells containing the seed and closed
 * under R6's three additions — a brilliant adds the eight cells around it, a
 * star adds its whole row and column, and a flawed gem orthogonally adjacent
 * to the set joins it.
 *
 * The closure is taken breadth-first from the seed, so a brilliant reached
 * through a star reached through a flawed gem contributes its own ring in the
 * same pass and, because a cell is reached the first time any addition reaches
 * it, every cell carries the LOWEST wave that reaches it. Each cell of the seed
 * is at wave `0`, and a cell an addition brings in from a cell at wave `k` is
 * at wave `k + 1`.
 */
export function expandClearSet(board: BoardState, seed: CellSet): ClearSet {
  const cells = new Set(seed);
  const waveOf = new Map<string, number>();
  for (const key of seed) waveOf.set(key, 0);

  // A queue rather than a stack, because a stack would reach a cell down one
  // long branch before a short one reaches it and give it too high a wave.
  const pending = [...seed];
  let waves = 0;

  const cellOf = (key: string): Cell => {
    const [col, row] = key.split(",").map(Number);
    return { col, row };
  };

  for (let head = 0; head < pending.length; head++) {
    const key = pending[head];
    const cell = cellOf(key);
    if (!inBounds(board, cell)) continue;
    const wave = (waveOf.get(key) ?? 0) + 1;

    const add = (next: Cell): void => {
      const nextKey = cellKey(next);
      if (cells.has(nextKey)) return;
      cells.add(nextKey);
      waveOf.set(nextKey, wave);
      waves = Math.max(waves, wave);
      pending.push(nextKey);
    };

    const gem = gemAt(board, cell);
    if (gem?.cut === "brilliant") {
      for (const around of surroundingCells(board, cell)) add(around);
    }
    if (gem?.cut === "star") {
      for (let col = 0; col < board.cols; col++) add({ col, row: cell.row });
      for (let row = 0; row < board.rows; row++) add({ col: cell.col, row });
    }
    // The flawed addition reaches OUT of the set rather than into it, so it is
    // taken from every cell as that cell is processed, which is what carries a
    // detonation onward through a primed stretch of the board.
    for (const neighbor of orthogonalNeighbors(board, cell)) {
      const beside = gemAt(board, neighbor);
      if (beside && isFlawed(beside)) add(neighbor);
    }
  }
  return { cells, waveOf, waves };
}

// ---- R7 Strain -----------------------------------------------------------

/** A board after R7, and how many gems the rule left newly flawed. */
export interface StrainOutcome {
  readonly board: BoardState;
  /** Gems that reached `MAX_STRAIN` on this step, which raises the cue. */
  readonly flawed: number;
}

/**
 * R7: every gem outside the clear set that is orthogonally adjacent to at
 * least one cell in it gains `1` strain, capped at `MAX_STRAIN`.
 *
 * The rule is applied once per gem however many cleared neighbors it has,
 * which falls out of walking the survivors rather than the cleared cells.
 */
export function applyStrain(
  board: BoardState,
  cleared: CellSet,
): StrainOutcome {
  let flawed = 0;
  const gems = board.gems.map((gem, index) => {
    const cell = {
      col: index % board.cols,
      row: Math.floor(index / board.cols),
    };
    if (!gem || cleared.has(cellKey(cell))) return gem;
    const touched = orthogonalNeighbors(board, cell).some((neighbor) =>
      cleared.has(cellKey(neighbor)),
    );
    if (!touched) return gem;
    const strain = Math.min(gem.strain + 1, MAX_STRAIN);
    if (strain === gem.strain) return gem;
    if (strain === MAX_STRAIN) flawed++;
    return { ...gem, strain };
  });
  return { board: { ...board, gems }, flawed };
}

// ---- Scoring (specs/rules.md, `## Scoring`) ------------------------------

/**
 * What a clear set scores at a multiplier: each gem by the strain it carried
 * when the step scored it, a flawed gem worth double. The board handed in is
 * the one the step scored, so this runs BEFORE R7 raises anything.
 */
export function scoreClearSet(
  board: BoardState,
  cleared: CellSet,
  multiplier: number,
): number {
  let points = 0;
  for (const cell of cellsIn(board, cleared)) {
    const gem = gemAt(board, cell);
    if (!gem) continue;
    points += (isFlawed(gem) ? FLAWED_SCORE : BASE_SCORE) * multiplier;
  }
  return points;
}

// ---- Removal -------------------------------------------------------------

/** The clear set removed, leaving its cells empty for R8 and R9. */
export function removeCells(board: BoardState, cleared: CellSet): BoardState {
  const gems = board.gems.map((gem, index) => {
    const cell = {
      col: index % board.cols,
      row: Math.floor(index / board.cols),
    };
    return cleared.has(cellKey(cell)) ? null : gem;
  });
  return { ...board, gems };
}

// ---- R8 Cuts -------------------------------------------------------------

/** One gem R8 decided to create, and the cell it goes in. */
export interface Creation {
  readonly cell: Cell;
  readonly gem: Gem;
}

/** How the three cuts rank when more than one row of R8 applies to a cell. */
const CUT_RANK: Readonly<Record<string, number>> = {
  prism: 3,
  star: 2,
  brilliant: 1,
};

/**
 * R8's placement for the gem a run creates: whichever of the two cells the
 * chain's swap exchanged lies in the run, at the one of LOWER INDEX when both
 * lie in it, and the run's cell at index `floor((n - 1) / 2)` when neither
 * does. A step with no swap behind it — which cannot arise in play, since
 * every chain begins with one — falls to the same middle cell.
 */
export function placementFor(run: Run, swap: CellPair | null): Cell {
  if (swap) {
    const indices = [swap.a, swap.b]
      .map((cell) => run.cells.findIndex((inRun) => sameCell(inRun, cell)))
      .filter((index) => index >= 0);
    if (indices.length > 0) return run.cells[Math.min(...indices)];
  }
  return run.cells[Math.floor((run.cells.length - 1) / 2)];
}

/**
 * The gems R8 creates from the runs that seeded the step, one per cell.
 *
 * Every candidate is collected first — a run of exactly `4` offers a
 * brilliant, a run of `5` or more offers a prism, and a cell shared by a
 * horizontal and a vertical run offers a star there — and the candidates on
 * one cell are then settled by rank, `prism` over `star` over `brilliant`, so
 * that cell takes exactly one created gem. A created gem carries strain `0`
 * and the kind of the run that created it, a prism carrying none. It is placed
 * into a cell the removal just emptied rather than dropped into one, so it
 * arrives at `fell` `0` and R9 gives it the fall it then takes.
 */
export function creationsFor(
  runs: readonly Run[],
  swap: CellPair | null,
): Creation[] {
  const candidates: Creation[] = [];

  for (const run of runs) {
    if (run.cells.length === 4) {
      candidates.push({
        cell: placementFor(run, swap),
        gem: { kind: run.kind, cut: "brilliant", strain: 0, fell: 0 },
      });
    } else if (run.cells.length >= 5) {
      candidates.push({
        cell: placementFor(run, swap),
        gem: { kind: null, cut: "prism", strain: 0, fell: 0 },
      });
    }
  }

  const rows = runs.filter((run) => run.orientation === "row");
  const columns = runs.filter((run) => run.orientation === "column");
  for (const row of rows) {
    for (const column of columns) {
      const crossing = row.cells.find((cell) =>
        column.cells.some((other) => sameCell(cell, other)),
      );
      if (crossing) {
        candidates.push({
          cell: crossing,
          // The star belongs to the crossing, and the crossing cell holds one
          // kind, so the two runs necessarily agree on it.
          gem: { kind: row.kind, cut: "star", strain: 0, fell: 0 },
        });
      }
    }
  }

  const chosen = new Map<string, Creation>();
  for (const candidate of candidates) {
    const key = cellKey(candidate.cell);
    const standing = chosen.get(key);
    if (!standing || CUT_RANK[candidate.gem.cut] > CUT_RANK[standing.gem.cut]) {
      chosen.set(key, candidate);
    }
  }
  return [...chosen.values()];
}

/** The created gems placed, each at the cell the removal left empty. */
export function placeCreations(
  board: BoardState,
  creations: readonly Creation[],
): BoardState {
  const gems = [...board.gems];
  for (const creation of creations) {
    gems[creation.cell.row * board.cols + creation.cell.col] = creation.gem;
  }
  return { ...board, gems };
}

// ---- R9 Settling ---------------------------------------------------------

/** The kind the refill deals into `(col, row)`, a cell R9 left empty. */
export type RefillKindAt = (col: number, row: number) => GemKind;

/**
 * The refill `specs/instrumentation.md` gives a posed column: the gem dealt
 * into row `r` of column `col` takes the kind `refillKinds[col][r]` names, and
 * a column with nothing posed, or a row past the end of its pose, draws from
 * `GEM_KINDS` as R9 states. The pose is validated when it is written, so a
 * letter here always names a kind.
 */
export function posedRefill(
  refillKinds: readonly string[],
  picker: Picker,
): RefillKindAt {
  return (col, row) => {
    const letter = refillKinds[col]?.[row];
    const kind = letter === undefined ? null : kindForLetter(letter);
    return kind ?? picker.pick(GEM_KINDS);
  };
}

/**
 * R9: within each column every surviving gem falls to the lowest empty cell
 * below it, keeping the order its column held it in and carrying its strain
 * and its cut, and every cell still empty is then filled from the top of its
 * column with a plain gem at strain `0` whose kind is drawn uniformly from
 * `GEM_KINDS`.
 *
 * Every gem the step leaves behind takes its `fell`: `0` for one the rule did
 * not move, its new row less its old row for a survivor that dropped, and
 * `row + 1` for a refilled gem, which is the LEAST the rule allows because a
 * refilled gem comes from just above the board's top row. That is the shape a
 * column fills in, one gem entering per row of the gap.
 *
 * `refill` is what decides the kind dealt into a refilled cell: the draw R9
 * states, or the kind a pose stands in for it (`posedRefill`).
 */
export function settleAndRefill(
  board: BoardState,
  refill: RefillKindAt,
): BoardState {
  const gems = [...board.gems];
  for (let col = 0; col < board.cols; col++) {
    const survivors: { gem: Gem; row: number }[] = [];
    for (let row = 0; row < board.rows; row++) {
      const gem = gems[row * board.cols + col];
      if (gem) survivors.push({ gem, row });
    }
    const missing = board.rows - survivors.length;
    for (let row = 0; row < board.rows; row++) {
      if (row < missing) {
        gems[row * board.cols + col] = plainGem(refill(col, row), row + 1);
        continue;
      }
      const survivor = survivors[row - missing];
      gems[row * board.cols + col] = {
        ...survivor.gem,
        fell: row - survivor.row,
      };
    }
  }
  return { ...board, gems };
}

/**
 * The greatest `fell` on a board, which `specs/rules.md` calls the step's
 * `fall` and the snapshot reports as `lastFall`. It is derived rather than
 * stored, so it answers to the board as it stands, and it is half of what the
 * step in progress holds for.
 */
export function lastFall(board: BoardState): number {
  let fall = 0;
  for (const gem of board.gems) {
    if (gem && gem.fell > fall) fall = gem.fell;
  }
  return fall;
}

// ---- R1, R2, R3: the move rules -----------------------------------------

/** Why a swap was refused, or `"accepted"`. Useful in tests and diagnostics. */
export type SwapVerdict = "accepted" | "adjacency" | "resolving" | "barren";

/**
 * The board a swap would produce: the two cells exchanged, at once. A swap
 * carries each gem sideways or one row, which is not a fall, so both of them
 * arrive at `fell` `0` and the swap animation `specs/rules.md` times is what
 * draws the journey.
 */
export function applySwap(board: BoardState, swap: CellPair): BoardState {
  const a = gemAt(board, swap.a);
  const b = gemAt(board, swap.b);
  const gems = [...board.gems];
  gems[swap.a.row * board.cols + swap.a.col] = b && { ...b, fell: 0 };
  gems[swap.b.row * board.cols + swap.b.col] = a && { ...a, fell: 0 };
  return { ...board, gems };
}

/**
 * R3 alone: the swap is productive, because the board it produces carries at
 * least one maximal run under R4, or because one of the two cells holds a
 * prism. The prism half is checked on the board as it stands, since the
 * exchange only moves the prism from one of the two cells to the other.
 */
export function productiveSwap(board: BoardState, swap: CellPair): boolean {
  const a = gemAt(board, swap.a);
  const b = gemAt(board, swap.b);
  if (!a || !b) return false;
  if (a.cut === "prism" || b.cut === "prism") return true;
  return maximalRuns(applySwap(board, swap)).length > 0;
}

/**
 * R1, R2 and R3 together, which is the one acceptance path every requested
 * swap goes through — a press, a drag, the keyboard, or a posed
 * `requestSwap`.
 */
export function judgeSwap(
  board: BoardState,
  phase: Phase,
  swap: CellPair,
): SwapVerdict {
  if (
    !inBounds(board, swap.a) ||
    !inBounds(board, swap.b) ||
    !orthogonallyAdjacent(swap.a, swap.b)
  ) {
    return "adjacency";
  }
  if (phase !== "idle") return "resolving";
  return productiveSwap(board, swap) ? "accepted" : "barren";
}

// ---- The legal-swap search ----------------------------------------------

/**
 * Every legal swap on the board: a pair of orthogonally adjacent cells whose
 * exchange R1 and R3 both accept (specs/rules.md, `## Levels and the end of a
 * round`). R2 is deliberately not consulted — whether a legal swap EXISTS is a
 * property of the board, not of what the chain is doing.
 *
 * Each pair is enumerated once, by looking only right and down from each cell.
 */
export function legalSwaps(board: BoardState): CellPair[] {
  const found: CellPair[] = [];
  for (const cell of cellsOf(board)) {
    for (const other of [
      { col: cell.col + 1, row: cell.row },
      { col: cell.col, row: cell.row + 1 },
    ]) {
      if (!inBounds(board, other)) continue;
      const swap = { a: cell, b: other };
      if (productiveSwap(board, swap)) found.push(swap);
    }
  }
  return found;
}

/** Whether any legal swap exists, which is what the game-over test asks. */
export function legalSwapExists(board: BoardState): boolean {
  for (const cell of cellsOf(board)) {
    for (const other of [
      { col: cell.col + 1, row: cell.row },
      { col: cell.col, row: cell.row + 1 },
    ]) {
      if (!inBounds(board, other)) continue;
      if (productiveSwap(board, { a: cell, b: other })) return true;
    }
  }
  return false;
}

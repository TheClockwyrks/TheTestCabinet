// Facet — the map between the state `specs/state.md` declares and the record
// the core runs on.
//
// The two differ in exactly two places, and both differences are deliberate.
//
//   * A CELL. `specs/state.md` fixes `board.cells` as one `GemState` per cell,
//     each carrying its own `col` and `row`; the core holds `board.gems`,
//     row-major, with a `null` for a cell standing empty between R8's removal
//     and R9's settling inside one step. The two are the same information: a
//     cell's address is its index, and an empty cell is written as the one
//     `GemState` no gem can be — `kind: null` with `cut: "plain"`, since a
//     kindless gem is a prism and a prism's cut says so. The map is therefore
//     total and lossless in both directions, `fell` included: an empty cell
//     traveled nowhere, so it is written at `0`.
//
//   * A REFUSAL. `specs/state.md` fixes one `RefusalState` carrying the two
//     cells and the game time it has stood for; the core keeps the pair and the
//     timer as two fields, because the timer is advanced and the pair is not.
//     A `null` refusal rests its timer at `0`, which is where the core keeps it.
//
// Everything else is field for field. The conversion runs twice per frame, over
// 64 cells, which is nothing beside what the frame itself does, and it is what
// lets `src/core/` be the identical directory in every reference build of this
// case while each build declares the state its own engine's specification fixes.

import { EMPTY_BOARD } from "./core";
import type {
  BoardState as CoreBoard,
  Cell as CoreCell,
  CellPair as CoreCellPair,
  FacetState as CoreState,
  Gem as CoreGem,
} from "./core";
import type {
  BoardState,
  CellRef,
  Cut,
  FacetState,
  GemKind,
  GemState,
  SwapRef,
} from "./game";
import type { DeepReadonly } from "ts-essentials";

/** The `GemState` an empty cell is written as; see the header. */
export function emptyCell(col: number, row: number): GemState {
  return { col, row, kind: null, cut: "plain", strain: 0, fell: 0 };
}

/** Whether a cell holds no gem, which is the encoding above read back. */
export function isEmptyCell(cell: DeepReadonly<GemState>): boolean {
  return cell.kind === null && cell.cut === "plain";
}

// ---- Cells ---------------------------------------------------------------

function toCoreCell(cell: DeepReadonly<CellRef>): CoreCell {
  return { col: cell.col, row: cell.row };
}

function fromCoreCell(cell: CoreCell): CellRef {
  return { col: cell.col, row: cell.row };
}

function toCorePair(pair: DeepReadonly<SwapRef>): CoreCellPair {
  return { a: toCoreCell(pair.a), b: toCoreCell(pair.b) };
}

function fromCorePair(pair: CoreCellPair): SwapRef {
  return { a: fromCoreCell(pair.a), b: fromCoreCell(pair.b) };
}

// ---- The board -----------------------------------------------------------

/** One declared cell as the core's gem, and an empty cell as the core's `null`. */
export function toCoreGem(cell: DeepReadonly<GemState>): CoreGem | null {
  if (isEmptyCell(cell)) return null;
  return {
    kind: cell.kind as GemKind | null,
    cut: cell.cut as Cut,
    strain: cell.strain,
    fell: cell.fell,
  };
}

/** The declared board as the core's, in the same reading order. */
export function toCoreBoard(board: DeepReadonly<BoardState>): CoreBoard {
  if (board.cols === 0 || board.rows === 0) return EMPTY_BOARD;
  return {
    cols: board.cols,
    rows: board.rows,
    gems: board.cells.map(toCoreGem),
  };
}

/** The core's board as the declared one, each cell carrying its address. */
export function fromCoreBoard(board: CoreBoard): BoardState {
  const cells: GemState[] = [];
  for (let row = 0; row < board.rows; row += 1) {
    for (let col = 0; col < board.cols; col += 1) {
      const gem = board.gems[row * board.cols + col] ?? null;
      cells.push(
        gem === null
          ? emptyCell(col, row)
          : {
              col,
              row,
              kind: gem.kind,
              cut: gem.cut,
              strain: gem.strain,
              fell: gem.fell,
            },
      );
    }
  }
  return { cols: board.cols, rows: board.rows, cells };
}

// ---- The whole state -----------------------------------------------------

/** The declared state as the record every rule in `src/core/` is written on. */
export function toCore(state: DeepReadonly<FacetState>): CoreState {
  return {
    screen: state.screen,
    menuIndex: state.menuIndex,
    board: toCoreBoard(state.board),
    score: state.score,
    level: state.level,
    levelScore: state.levelScore,
    phase: state.phase,
    chainStep: state.chainStep,
    swapTimer: state.swapTimer,
    stepTimer: state.stepTimer,
    chainSwap: state.chainSwap === null ? null : toCorePair(state.chainSwap),
    lastCleared: state.lastCleared,
    lastPoints: state.lastPoints,
    lastWaves: state.lastWaves,
    moveScore: state.moveScore,
    bestMove: state.bestMove,
    bestChain: state.bestChain,
    selection: state.selection === null ? null : toCoreCell(state.selection),
    offer: state.offer === null ? null : toCoreCell(state.offer),
    refusal:
      state.refusal === null
        ? null
        : { a: toCoreCell(state.refusal.a), b: toCoreCell(state.refusal.b) },
    refusalTimer: state.refusal === null ? 0 : state.refusal.timer,
    pointer: {
      x: state.pointer.x,
      y: state.pointer.y,
      down: state.pointer.down,
      device: state.pointer.device,
    },
    armedTarget: state.armedTarget,
    muted: state.muted,
    simTime: state.simTime,
    refillKinds: [...state.refillKinds],
  };
}

/** The core's record as the state `specs/state.md` declares. */
export function fromCore(state: CoreState): FacetState {
  return {
    screen: state.screen,
    menuIndex: state.menuIndex,
    board: fromCoreBoard(state.board),
    phase: state.phase,
    chainStep: state.chainStep,
    swapTimer: state.swapTimer,
    stepTimer: state.stepTimer,
    score: state.score,
    level: state.level,
    levelScore: state.levelScore,
    lastCleared: state.lastCleared,
    lastPoints: state.lastPoints,
    lastWaves: state.lastWaves,
    moveScore: state.moveScore,
    bestMove: state.bestMove,
    bestChain: state.bestChain,
    selection: state.selection === null ? null : fromCoreCell(state.selection),
    offer: state.offer === null ? null : fromCoreCell(state.offer),
    refusal:
      state.refusal === null
        ? null
        : {
            a: fromCoreCell(state.refusal.a),
            b: fromCoreCell(state.refusal.b),
            timer: state.refusalTimer,
          },
    armedTarget: state.armedTarget,
    pointer: {
      x: state.pointer.x,
      y: state.pointer.y,
      down: state.pointer.down,
      device: state.pointer.device,
    },
    simTime: state.simTime,
    muted: state.muted,
    refillKinds: [...state.refillKinds],
    chainSwap: state.chainSwap === null ? null : fromCorePair(state.chainSwap),
  };
}

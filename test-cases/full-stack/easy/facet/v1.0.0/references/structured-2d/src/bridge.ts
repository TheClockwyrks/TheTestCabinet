// Facet — the one seam between the engine's live game state and the core's.
//
// Two shapes describe the same game, and each is required by something.
//
//   * `FacetState` in `src/game.ts` is the shape `specs/state.md` FIXES: a
//     class extending the engine's `GameState`, whose fields a tick writes in
//     place and whose board is a flat list of `GemState`, each carrying the
//     cell it occupies. It is what the engine builds, what the debug surface
//     poses, and what the renderer reads.
//   * `CoreState` in `src/core/state.ts` is the shape the RULES are written
//     against: every field `readonly`, so a chain step is the next state built
//     from the current one rather than a mutation half-applied. That core is
//     copied verbatim into every Facet reference, which is what makes a score
//     recorded under one engine comparable with a score recorded under
//     another, so it is not the thing that bends.
//
// This module is therefore the only place in the build that knows both, and
// every path that changes the game runs through it: read the live state into a
// core state, apply the core's own function, write the result back. Nothing
// else converts, and nothing else writes the live state's rule-bearing fields.
//
// The conversion is `O(cols * rows)` — sixty-four cells — once per frame and
// once per pose, which is nothing beside the frame that follows it.

import {
  EMPTY_BOARD,
  type BoardState as CoreBoard,
  type Cell,
  type FacetState as CoreState,
  type Gem,
} from "./core";
import type { BoardState, Cut, FacetState, GemKind, GemState } from "./game";

/** A cell address copied out, so neither side aliases the other's object. */
function cellOf(cell: Cell): { col: number; row: number } {
  return { col: cell.col, row: cell.row };
}

/**
 * The live board as the core reads it: one row-major slot per cell, in reading
 * order. A board with no cells in play converts to `EMPTY_BOARD`, which is what
 * the core carries off every menu screen.
 */
export function boardToCore(board: BoardState): CoreBoard {
  if (board.cols === 0 || board.rows === 0) return EMPTY_BOARD;
  const gems: (Gem | null)[] = new Array<Gem | null>(
    board.cols * board.rows,
  ).fill(null);
  for (const cell of board.cells) {
    gems[cell.row * board.cols + cell.col] = {
      kind: cell.kind,
      cut: cell.cut,
      strain: cell.strain,
      fell: cell.fell,
    };
  }
  return { cols: board.cols, rows: board.rows, gems };
}

/**
 * A core board as the live state carries it: one `GemState` per cell, in
 * reading order, each carrying the cell it occupies and how far it fell to
 * reach it.
 *
 * A settled board holds a gem in every cell — a slot stands empty only between
 * R9's removal and its settling, both inside one `resolveStep` call — so an
 * empty slot reaching here is a broken invariant rather than a state to
 * represent, and it is named rather than papered over.
 */
export function boardFromCore(board: CoreBoard): BoardState {
  const cells: GemState[] = [];
  for (let row = 0; row < board.rows; row += 1) {
    for (let col = 0; col < board.cols; col += 1) {
      const gem = board.gems[row * board.cols + col];
      if (!gem) {
        throw new Error(
          `Facet: (${col}, ${row}) is empty on a board that has settled`,
        );
      }
      cells.push({
        col,
        row,
        kind: gem.kind as GemKind | null,
        cut: gem.cut as Cut,
        strain: gem.strain,
        fell: gem.fell,
      });
    }
  }
  return { cols: board.cols, rows: board.rows, cells };
}

/** The live state read into the shape the rules are written against. */
export function toCore(state: FacetState): CoreState {
  return {
    screen: state.screen,
    menuIndex: state.menuIndex,
    board: boardToCore(state.board),
    score: state.score,
    level: state.level,
    levelScore: state.levelScore,
    phase: state.phase,
    chainStep: state.chainStep,
    swapTimer: state.swapTimer,
    stepTimer: state.stepTimer,
    chainSwap: state.chainSwap
      ? { a: cellOf(state.chainSwap.a), b: cellOf(state.chainSwap.b) }
      : null,
    lastCleared: state.lastCleared,
    lastPoints: state.lastPoints,
    lastWaves: state.lastWaves,
    moveScore: state.moveScore,
    bestMove: state.bestMove,
    bestChain: state.bestChain,
    selection: state.selection ? cellOf(state.selection) : null,
    offer: state.offer ? cellOf(state.offer) : null,
    refusal: state.refusal
      ? { a: cellOf(state.refusal.a), b: cellOf(state.refusal.b) }
      : null,
    refusalTimer: state.refusal ? state.refusal.timer : 0,
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

/**
 * A core state written back onto the live one, field by field, IN PLACE.
 *
 * In place because the framework's states are live objects: the engine built
 * this instance when the world opened and `engine.world.state` is that one
 * instance for the whole session, so a frame replaces the fields rather than
 * the object.
 *
 * `muted` is deliberately not among them. The engine owns muting, and
 * `FacetMode.tick` mirrors the bus's own bit onto the state each frame; taking
 * it from the core here would let a pose that carried a stale copy overwrite
 * what the player actually chose.
 */
export function applyCore(state: FacetState, next: CoreState): void {
  state.screen = next.screen;
  state.menuIndex = next.menuIndex;
  state.board = boardFromCore(next.board);
  state.phase = next.phase;
  state.chainStep = next.chainStep;
  state.swapTimer = next.swapTimer;
  state.stepTimer = next.stepTimer;
  state.score = next.score;
  state.level = next.level;
  state.levelScore = next.levelScore;
  state.lastCleared = next.lastCleared;
  state.lastPoints = next.lastPoints;
  state.lastWaves = next.lastWaves;
  state.moveScore = next.moveScore;
  state.bestMove = next.bestMove;
  state.bestChain = next.bestChain;
  state.selection = next.selection ? cellOf(next.selection) : null;
  state.offer = next.offer ? cellOf(next.offer) : null;
  state.refusal = next.refusal
    ? {
        a: cellOf(next.refusal.a),
        b: cellOf(next.refusal.b),
        timer: next.refusalTimer,
      }
    : null;
  state.armedTarget = next.armedTarget;
  state.pointer = {
    x: next.pointer.x,
    y: next.pointer.y,
    down: next.pointer.down,
    device: next.pointer.device,
  };
  state.simTime = next.simTime;
  state.refillKinds = [...next.refillKinds];
  state.chainSwap = next.chainSwap
    ? { a: cellOf(next.chainSwap.a), b: cellOf(next.chainSwap.b) }
    : null;
}

/**
 * The gem at a cell of the LIVE board, or `null` off the board. The renderer's
 * one accessor, so nothing outside this module indexes `board.cells` by hand.
 */
export function gemAtCell(
  board: BoardState,
  col: number,
  row: number,
): GemState | null {
  if (col < 0 || col >= board.cols || row < 0 || row >= board.rows) return null;
  return board.cells[row * board.cols + col] ?? null;
}

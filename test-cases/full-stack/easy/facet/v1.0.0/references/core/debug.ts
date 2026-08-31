// Facet — the debugging and automation surface, as pure logic.
//
// `specs/instrumentation.md` specifies a surface whose every operation is a
// READ or a POSE of the running game. This module is the logic behind all of
// them, written the way a pose is written: state in, state out, holding
// nothing.
//
// It stops short of the surface itself, deliberately, because the three
// reference builds present it differently — the `none` build installs an object
// on `window.__facet` that applies each pose to the state its own frame loop
// owns, and the two engine builds hand the pose functions back from
// `initialize` for the engine to apply through `engine.apply`. What must NOT
// differ between the three is what a pose DOES, so that lives here once.
//
// Several operations are elsewhere on purpose. `setAutoStep` and `advance` are
// the CLOCK, and a clock belongs to whatever is driving the frames.
// `pointerDown`, `pointerMove`, and `pointerUp` are in `controls.ts`, because
// they are not stand-ins for the pointer at all but the very path a real
// pointer takes. And the poses that move between screens — `start`, `openHowTo`,
// `pause`, `resume`, `continueLevel`, `quit` — are the transitions in
// `flow.ts`, posed as exactly the choices a player makes; `continueLevel` is
// re-exported here so the whole level-clear pose is reachable from this module
// as well.

import { DEFAULT_SEED, FACET_DEBUG_VERSION } from "../constants";
import {
  cellX,
  cellY,
  inBounds,
  parseBoard,
  parseToken,
  withGem,
} from "./board";
import { levelTarget, multiplierFor, requestSwap, stepHold } from "./chain";
import { lastFall, legalSwapExists } from "./rules";
import { targetsFor } from "./targets";
import {
  createInitialState,
  type Cell,
  type Cut,
  type FacetState,
  type Phase,
  type PointerDevice,
  type Screen,
} from "./state";

export { continueLevel } from "./flow";

/** One cell as the snapshot reports it; `kind` is `null` for a prism. */
export interface SnapshotCell {
  col: number;
  row: number;
  /** The cell center on the stage, derived from the formulas in board.md. */
  x: number;
  y: number;
  kind: string | null;
  cut: Cut;
  strain: number;
  /** How many rows the gem traveled to reach this cell (R9). */
  fell: number;
}

/** One pointer target as the snapshot reports it (specs/controls.md). */
export interface SnapshotTarget {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The fixed shape `snapshot()` returns (specs/instrumentation.md). */
export interface FacetSnapshot {
  version: number;
  screen: Screen;
  menuIndex: number;
  score: number;
  level: number;
  levelScore: number;
  levelTarget: number;
  phase: Phase;
  chainStep: number;
  multiplier: number;
  swapTimer: number;
  stepTimer: number;
  stepHold: number;
  board: { cols: number; rows: number; cells: SnapshotCell[] };
  selection: { col: number; row: number } | null;
  offer: { col: number; row: number } | null;
  refusal: {
    a: { col: number; row: number };
    b: { col: number; row: number };
  } | null;
  lastCleared: number;
  lastPoints: number;
  lastWaves: number;
  lastFall: number;
  moveScore: number;
  bestMove: number;
  bestChain: number;
  legalSwap: boolean;
  rngState: number;
  pointer: { x: number; y: number; down: boolean; device: PointerDevice };
  armedTarget: string | null;
  targets: SnapshotTarget[];
  muted: boolean;
  simTime: number;
}

/**
 * A pure read of the state. Every field is present on every screen, and a
 * field with nothing to report holds its resting value rather than going
 * missing. Seven are derived rather than stored: a cell's `x` and `y`, the
 * level's target, the chain multiplier, the board's longest fall, how long the
 * step in progress holds, whether a legal swap exists, and the current screen's
 * pointer targets.
 */
export function snapshot(state: FacetState): FacetSnapshot {
  const cells: SnapshotCell[] = [];
  for (let row = 0; row < state.board.rows; row++) {
    for (let col = 0; col < state.board.cols; col++) {
      const gem = state.board.gems[row * state.board.cols + col];
      cells.push({
        col,
        row,
        x: cellX(col),
        y: cellY(row),
        kind: gem?.kind ?? null,
        cut: gem?.cut ?? "plain",
        strain: gem?.strain ?? 0,
        fell: gem?.fell ?? 0,
      });
    }
  }
  return {
    version: FACET_DEBUG_VERSION,
    screen: state.screen,
    menuIndex: state.menuIndex,
    score: state.score,
    level: state.level,
    levelScore: state.levelScore,
    levelTarget: levelTarget(state.level),
    phase: state.phase,
    chainStep: state.chainStep,
    multiplier: multiplierFor(state.chainStep),
    swapTimer: state.swapTimer,
    stepTimer: state.stepTimer,
    stepHold: stepHold(state),
    board: { cols: state.board.cols, rows: state.board.rows, cells },
    selection: state.selection
      ? { col: state.selection.col, row: state.selection.row }
      : null,
    offer: state.offer ? { col: state.offer.col, row: state.offer.row } : null,
    refusal: state.refusal
      ? {
          a: { col: state.refusal.a.col, row: state.refusal.a.row },
          b: { col: state.refusal.b.col, row: state.refusal.b.row },
        }
      : null,
    lastCleared: state.lastCleared,
    lastPoints: state.lastPoints,
    lastWaves: state.lastWaves,
    lastFall: lastFall(state.board),
    moveScore: state.moveScore,
    bestMove: state.bestMove,
    bestChain: state.bestChain,
    legalSwap: legalSwapExists(state.board),
    rngState: state.rngState,
    pointer: {
      x: state.pointer.x,
      y: state.pointer.y,
      down: state.pointer.down,
      device: state.pointer.device,
    },
    armedTarget: state.armedTarget,
    targets: targetsFor(state.screen).map((target) => ({
      id: target.id,
      x: target.x,
      y: target.y,
      w: target.w,
      h: target.h,
    })),
    muted: state.muted,
    simTime: state.simTime,
  };
}

/**
 * Every declared field back at its title-screen value, with `rngState` seeded
 * from `options.seed` or `DEFAULT_SEED`. `muted` is deliberately carried over:
 * the runtime owns muting, and a reset is not a reason to start making noise
 * again.
 */
export function reset(
  state: FacetState,
  options?: { seed?: number },
): FacetState {
  return {
    ...createInitialState(options?.seed ?? DEFAULT_SEED),
    muted: state.muted,
  };
}

/**
 * An arbitrary board posed, and the game moved to `playing` with the chain
 * settled, nothing selected, nothing offered, and nothing armed. Every gem of a
 * posed board is standing still in the cell it was written at, so every cell
 * reports a `fell` of `0`, which the notation gives it.
 *
 * A board posed this way is a board like any other: it rests exactly as it was
 * written until a swap is accepted on it, and the rules govern it unchanged
 * from there.
 *
 * `score`, `level`, `levelScore`, `moveScore`, `bestMove`, `bestChain`,
 * `rngState`, and `simTime` stand where they were, which is what lets a
 * scenario pose a board on top of a round in progress.
 */
export function loadBoard(
  state: FacetState,
  rows: readonly string[],
): FacetState {
  return {
    ...state,
    screen: "playing",
    menuIndex: 0,
    board: parseBoard(rows),
    phase: "idle",
    chainStep: 0,
    swapTimer: 0,
    stepTimer: 0,
    chainSwap: null,
    selection: null,
    offer: null,
    refusal: null,
    refusalTimer: 0,
    armedTarget: null,
  };
}

/**
 * One cell of the board written, at a `fell` of `0` because a written gem is
 * standing still. Every other cell, the screen, the phase, the selection, and
 * the offer stand where they were.
 */
export function setGem(
  state: FacetState,
  col: number,
  row: number,
  token: string,
): FacetState {
  const cell = { col, row };
  if (!inBounds(state.board, cell)) {
    throw new Error(`Facet: (${col}, ${row}) is not a cell of the board`);
  }
  return { ...state, board: withGem(state.board, cell, parseToken(token)) };
}

/** `score` set. Nothing else changes, and `levelScore` is its own figure. */
export function setScore(state: FacetState, points: number): FacetState {
  return { ...state, score: points };
}

/**
 * `level` set, a whole number of at least `1`. The level's target follows from
 * it; the board and `levelScore` stand where they were.
 */
export function setLevel(state: FacetState, level: number): FacetState {
  return { ...state, level: Math.max(1, Math.floor(level)) };
}

/**
 * `levelScore` set. The level condition is evaluated when a chain settles, so a
 * level score posed at or past the target ends the level as the next chain
 * settles rather than on the spot.
 */
export function setLevelScore(state: FacetState, points: number): FacetState {
  return { ...state, levelScore: points };
}

/** `bestChain` set, a whole number of at least `0`. Nothing else changes. */
export function setBestChain(state: FacetState, chainStep: number): FacetState {
  return { ...state, bestChain: Math.max(0, Math.floor(chainStep)) };
}

/** `bestMove` set. Nothing else changes, and `moveScore` is its own figure. */
export function setBestMove(state: FacetState, points: number): FacetState {
  return { ...state, bestMove: points };
}

/** A cell made the selection, whatever was selected before. No swap is asked. */
export function setSelection(
  state: FacetState,
  col: number,
  row: number,
): FacetState {
  const cell: Cell = { col, row };
  if (!inBounds(state.board, cell)) {
    throw new Error(`Facet: (${col}, ${row}) is not a cell of the board`);
  }
  return { ...state, selection: cell };
}

/** Nothing selected. The offer, the board, and the phase stand where they were. */
export function clearSelection(state: FacetState): FacetState {
  return { ...state, selection: null };
}

/**
 * A cell made the one the selected gem is offered into, whatever was offered
 * before. No swap is requested: a release is what plays an offer, as
 * `specs/controls.md` states.
 */
export function setOffer(
  state: FacetState,
  col: number,
  row: number,
): FacetState {
  const cell: Cell = { col, row };
  if (!inBounds(state.board, cell)) {
    throw new Error(`Facet: (${col}, ${row}) is not a cell of the board`);
  }
  return { ...state, offer: cell };
}

/** Nothing offered. The selection, the board, and the phase stand where they were. */
export function clearOffer(state: FacetState): FacetState {
  return { ...state, offer: null };
}

/**
 * A swap posed, through the same acceptance path a player's release takes, so
 * R1, R2, and R3 decide it and nothing is bypassed. It names both cells itself,
 * so the selection and the offer stand where they were either way.
 *
 * A pose plays no cue, so the events the swap raised are dropped here: "a cue
 * is played by a frame, never by a pose of the debug surface" (specs/ui.md).
 */
export function poseSwap(
  state: FacetState,
  colA: number,
  rowA: number,
  colB: number,
  rowB: number,
): FacetState {
  return requestSwap(state, {
    a: { col: colA, row: rowA },
    b: { col: colB, row: rowB },
  }).state;
}

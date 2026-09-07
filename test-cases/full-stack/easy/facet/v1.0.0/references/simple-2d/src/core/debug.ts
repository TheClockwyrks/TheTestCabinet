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
// pointer takes.
//
// Every operation here writes ONE element of the state, which is what
// `specs/instrumentation.md` specifies: `setScreen` shows a screen and touches
// nothing else, `loadBoard` writes the board and touches nothing else, and so
// on. The menu choices a player makes — starting a round, opening the how-to
// screen, pausing, resuming, continuing to the next level, quitting — are the
// transitions in `flow.ts`, reached by the game's own input path. A caller that
// wants a round posed writes the fields a round starts with, one operation at a
// time.

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
  EMPTY_BOARD,
  type Cell,
  type Cut,
  type FacetState,
  type Phase,
  type PointerDevice,
  type Screen,
} from "./state";
import { dealOpeningBoard } from "./deal";

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
 * A whole number of at least `min`, or a thrown error the caller sees.
 *
 * The bounds these poses carry are ones the SPECIFICATION FIXES — an index
 * counted from `0`, a level counted from `1` — rather than ones that read a
 * live figure of the running game, so each is a domain rather than a rule. A
 * pose applies the value it is given and never settles for a nearer legal one
 * (specs/instrumentation.md), so a value outside the domain names no state the
 * game has and the only honest answer is to fail where the caller can see it.
 */
function requireWhole(name: string, value: number, min: number): number {
  if (!Number.isInteger(value) || value < min) {
    throw new Error(
      `Facet: ${name} takes a whole number of at least ${min}; got ${String(value)}`,
    );
  }
  return value;
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
 * Every reading this surface reports brought into agreement with the game as it
 * stands, without advancing anything (specs/instrumentation.md).
 *
 * THERE IS NOTHING TO REWRITE HERE, AND THAT IS THE ANSWER RATHER THAN AN
 * OMISSION. Every reading that FOLLOWS from something else is worked out at the
 * read, in `snapshot` above, from the state it follows from: a cell's `x` and
 * `y` from the cell center formulas, `levelTarget` from `level`, `multiplier`
 * from `chainStep`, `lastFall` from the board, `stepHold` from `lastWaves` and
 * `lastFall`, `legalSwap` from the board under R1 and R3, and `targets` from the
 * screen. None of them is held as a copy of something a pose can leave behind,
 * so a board written by `loadBoard` already reads with the legal swap and the
 * longest fall of the board that was written.
 *
 * The operation is required of every build, INCLUDING one that keeps any of
 * those as a stored copy — that build rewrites its copies from their sources
 * here — and this is what it comes to in a build that keeps none. It advances no
 * timer, runs no rule, draws from no generator, moves nothing to make a reading
 * agree, and raises no event. Calling it twice leaves what calling it once
 * leaves.
 */
export function reconcile(state: FacetState): FacetState {
  return { ...state };
}

/** The screen shown. Nothing else changes. */
export function setScreen(state: FacetState, screen: Screen): FacetState {
  return { ...state, screen };
}

/**
 * The highlighted menu item on whichever menu the screen shows, from `0`.
 *
 * The index is applied as given. Which screen is up is not a condition on this
 * pose, and an index the current menu has no item at is still written — what a
 * menu with no such item DRAWS is the renderer's answer, not this call's.
 */
export function setMenuIndex(state: FacetState, index: number): FacetState {
  return {
    ...state,
    menuIndex: requireWhole("setMenuIndex(index)", index, 0),
  };
}

/**
 * An arbitrary board posed. Every gem of a posed board is standing still in the
 * cell it was written at, so every cell reports a `fell` of `0`, which the
 * notation gives it.
 *
 * The board is the whole of what it writes: the screen, the menu index, the
 * phase and its timers, the selection, the offer, the refusal, and every figure
 * of the round stand where they were. A board posed this way is a board like
 * any other: it rests exactly as it was written until a swap is accepted on it,
 * and the rules govern it unchanged from there.
 */
export function loadBoard(
  state: FacetState,
  rows: readonly string[],
): FacetState {
  return { ...state, board: parseBoard(rows) };
}

/**
 * A fresh opening board dealt through the game's own code, so it holds no run
 * under R4, carries at least one legal swap, and comes in from above. Only the
 * board and the generator state it drew from change.
 */
export function dealBoard(state: FacetState): FacetState {
  const deal = dealOpeningBoard(state.rngState);
  return { ...state, board: deal.board, rngState: deal.rngState };
}

/** No board in play. Nothing else changes. */
export function clearBoard(state: FacetState): FacetState {
  return { ...state, board: EMPTY_BOARD };
}

/**
 * Resolution settled: the swap or the chain step in motion dropped and the
 * phase back at `idle` with the resting timers an idle board reports. The
 * board is left exactly as the dropped step found it.
 */
export function clearChain(state: FacetState): FacetState {
  return {
    ...state,
    phase: "idle",
    chainStep: 0,
    swapTimer: 0,
    stepTimer: 0,
    chainSwap: null,
  };
}

/** No refusal standing, whatever time the standing one had left. */
export function clearRefusal(state: FacetState): FacetState {
  return { ...state, refusal: null, refusalTimer: 0 };
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
  return { ...state, level: requireWhole("setLevel(level)", level, 1) };
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
  return {
    ...state,
    bestChain: requireWhole("setBestChain(chainStep)", chainStep, 0),
  };
}

/** `bestMove` set. Nothing else changes, and `moveScore` is its own figure. */
export function setBestMove(state: FacetState, points: number): FacetState {
  return { ...state, bestMove: points };
}

/** `moveScore` set. Nothing else changes, and `bestMove` is its own figure. */
export function setMoveScore(state: FacetState, points: number): FacetState {
  return { ...state, moveScore: points };
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

// Refract — the debugging and automation surface.
//
// The surface is specified by `specs/instrumentation.md` and implemented here.
// `createDebugApi()` builds it, `initialize` returns it beside the state it
// built as `[state, createDebugApi()]`, and the engine hands that same object
// back from `engine.debug` — the one way a caller reaches it. It holds no
// state, reaches nothing global, and is inert during normal play: nothing
// below runs until something calls it.
//
// Every operation is written in the shape of `update`. A POSE takes the
// current state and returns the next — `loadBoard(state, board)` — and a
// caller drives it through `engine.apply((s) => debug.loadBoard(s, board))`;
// a READING takes the state and returns what it read —
// `snapshot(engine.state)`. The pointer operations do not stand in for the
// engine's pointer: they feed the SAME resolution path a player's pointer
// feeds (`src/tracing.ts`), so the hit radius, the grab table, the limits, and
// the completion test all run exactly as they do in play, and each call takes
// effect immediately in the state it returns rather than waiting on a frame.

import { cellCenter, emptyBeams, parseBoard } from "./board";
import { DEFAULT_SEED, REFRACT_DEBUG_VERSION } from "./constants";
import { createInitialState, startMode as startModePose } from "./flow";
import { beamComplete, boardSolved, spentAt } from "./rules";
import { clearBeams, pointerDown, pointerMove, pointerUp } from "./tracing";
import type { Channel, Mode, NodeKind, RefractState, Screen } from "./game";
import type { DeepReadonly } from "ts-essentials";

// ---- The snapshot shape (specs/instrumentation.md) -----------------------

export interface SnapshotNode {
  col: number;
  row: number;
  /** The cell center on the stage, derived from the board's dimensions. */
  x: number;
  y: number;
  kind: NodeKind;
  channel: Channel | null;
  charges: number | null;
  /** A crystal's spent charge count; `null` for an emitter and a lens. */
  spent: number | null;
}

export interface SnapshotBeam {
  /** The cells the beam runs through, in the order they were drawn. */
  cells: { col: number; row: number }[];
  /** R6 and R7, derived rather than stored. */
  complete: boolean;
}

export interface RefractSnapshot {
  version: number;
  screen: Screen;
  mode: Mode;
  menuIndex: number;
  boardIndex: number;
  solvedBoards: number[];
  unlockedCount: number;
  selectIndex: number;
  solvedCount: number;
  tier: number;
  board: {
    cols: number;
    rows: number;
    nodes: SnapshotNode[];
  };
  /** One entry per channel present on the board, and none for the rest. */
  beams: Partial<Record<Channel, SnapshotBeam>>;
  /** R9, derived rather than stored. */
  solved: boolean;
  tracing: { channel: Channel; live: { col: number; row: number } } | null;
  pointer: { x: number; y: number; down: boolean };
  muted: boolean;
  simTime: number;
}

// ---- The surface ---------------------------------------------------------

/**
 * The surface. Every pose takes the current state and returns the next; the
 * one reading, `snapshot`, takes the current state and returns what it read.
 */
export interface RefractDebugApi {
  version: number;
  reset(
    state: DeepReadonly<RefractState>,
    options?: { seed?: number },
  ): RefractState;
  snapshot(state: DeepReadonly<RefractState>): RefractSnapshot;
  startMode(state: DeepReadonly<RefractState>, mode: Mode): RefractState;
  loadBoard(
    state: DeepReadonly<RefractState>,
    board: readonly string[],
  ): RefractState;
  pointerDown(
    state: DeepReadonly<RefractState>,
    x: number,
    y: number,
  ): RefractState;
  pointerMove(
    state: DeepReadonly<RefractState>,
    x: number,
    y: number,
  ): RefractState;
  pointerUp(state: DeepReadonly<RefractState>): RefractState;
  trace(
    state: DeepReadonly<RefractState>,
    cells: readonly { col: number; row: number }[],
  ): RefractState;
  clear(state: DeepReadonly<RefractState>): RefractState;
}

/** Build the surface. It holds nothing: every operation is handed its state. */
export function createDebugApi(): RefractDebugApi {
  return {
    version: REFRACT_DEBUG_VERSION,

    /**
     * Every declared field back at its title-screen value, with `rngState`
     * seeded. `muted` is deliberately untouched: muting is a player
     * preference the runtime owns, and a reset is not a reason to start
     * making noise again.
     */
    reset(state, options) {
      return {
        ...createInitialState(),
        muted: state.muted,
        rngState: options?.seed ?? DEFAULT_SEED,
      };
    },

    /** A pure read. It never changes anything. */
    snapshot(state) {
      const beams: Partial<Record<Channel, SnapshotBeam>> = {};
      for (const beam of state.beams) {
        beams[beam.channel] = {
          cells: beam.cells.map(({ col, row }) => ({ col, row })),
          complete: beamComplete(state.board, beam),
        };
      }
      const liveBeam =
        state.tracing === null
          ? null
          : (state.beams.find(
              (beam) => beam.channel === state.tracing?.channel,
            ) ?? null);
      const live =
        liveBeam && liveBeam.cells.length > 0
          ? liveBeam.cells[liveBeam.cells.length - 1]
          : null;
      return {
        version: REFRACT_DEBUG_VERSION,
        screen: state.screen,
        mode: state.mode,
        menuIndex: state.menuIndex,
        boardIndex: state.boardIndex,
        solvedBoards: [...state.solvedBoards],
        unlockedCount: state.unlockedCount,
        selectIndex: state.selectIndex,
        solvedCount: state.solvedCount,
        tier: state.tier,
        board: {
          cols: state.board.cols,
          rows: state.board.rows,
          nodes: state.board.nodes.map((node) => {
            const [x, y] = cellCenter(node, state.board);
            return {
              col: node.col,
              row: node.row,
              x,
              y,
              kind: node.kind,
              channel: node.channel,
              charges: node.charges,
              spent:
                node.kind === "crystal" ? spentAt(state.beams, node) : null,
            };
          }),
        },
        beams,
        solved: boardSolved(state.board, state.beams),
        tracing:
          state.tracing !== null && live !== null
            ? {
                channel: state.tracing.channel,
                live: { col: live.col, row: live.row },
              }
            : null,
        pointer: {
          x: state.pointer.x,
          y: state.pointer.y,
          down: state.pointer.down,
        },
        muted: state.muted,
        simTime: state.simTime,
      };
    },

    /**
     * The choice of a mode from the title menu, exactly as choosing its item
     * does: Campaign to its select grid with the session's progress as it
     * stands, Cascade to a fresh sequence from tier 1 on a generated board.
     */
    startMode(state, mode) {
      return startModePose(state, mode);
    },

    /**
     * An arbitrary board posed onto the `playing` screen with every beam
     * empty and no trace live — the surface's main lever. The notation is
     * validated as it is parsed, and a board posed this way is a board like
     * any other: the rules apply to it unchanged.
     */
    loadBoard(state, board) {
      const parsed = parseBoard(board);
      return {
        ...state,
        board: parsed,
        beams: emptyBeams(parsed),
        tracing: null,
        screen: "playing",
        menuIndex: 0,
      };
    },

    /** A press, resolved immediately through the real input path. */
    pointerDown(state, x, y) {
      return pointerDown(state, x, y).state;
    },

    /** A move, resolved immediately: extend, retract, or a refused no-op. */
    pointerMove(state, x, y) {
      return pointerMove(state, x, y).state;
    },

    /** A release: the trace ends and the beam stays exactly as drawn. */
    pointerUp(state) {
      return pointerUp(state).state;
    },

    /**
     * Sugar over the three pointer operations: a press at the first cell's
     * center, a move to each remaining center in turn, then a release. A list
     * the limits refuse part way through leaves the beam ending at the last
     * segment they permitted.
     */
    trace(state, cells) {
      if (cells.length === 0) return { ...state };
      const [firstX, firstY] = cellCenter(cells[0], state.board);
      let next = pointerDown(state, firstX, firstY).state;
      for (const cell of cells.slice(1)) {
        const [x, y] = cellCenter(cell, next.board);
        next = pointerMove(next, x, y).state;
      }
      return pointerUp(next).state;
    },

    /** The `clear` action: every beam emptied, on the playing screen alone. */
    clear(state) {
      return clearBeams(state).state;
    },
  };
}

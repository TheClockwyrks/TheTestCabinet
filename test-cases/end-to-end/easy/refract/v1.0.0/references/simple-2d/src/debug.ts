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
import { generateBoard } from "./cascade";
import { REFRACT_DEBUG_VERSION } from "./constants";
import { createInitialState } from "./flow";
import { beamComplete, boardSolved, spentAt } from "./rules";
import { pointerDown, pointerMove, pointerUp } from "./pointer";
import { clearBeams } from "./tracing";
import { targetsFor } from "./layout";
import type {
  BoardState,
  Channel,
  Mode,
  NodeKind,
  PointerDevice,
  RefractState,
  Screen,
} from "./game";
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
  pointer: {
    x: number;
    y: number;
    down: boolean;
    device: PointerDevice;
  };
  /** The current screen's pointer targets, in the order specs/controls.md fixes. */
  targets: SnapshotTarget[];
  muted: boolean;
  simTime: number;
}

/** One pointer target, as the snapshot reports it. */
export interface SnapshotTarget {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

// ---- The surface ---------------------------------------------------------

/**
 * The surface. Every pose takes the current state and returns the next; the
 * one reading, `snapshot`, takes the current state and returns what it read.
 */
export interface RefractDebugApi {
  version: number;
  reset(state: DeepReadonly<RefractState>): RefractState;
  snapshot(state: DeepReadonly<RefractState>): RefractSnapshot;
  setMode(state: DeepReadonly<RefractState>, mode: Mode): RefractState;
  setScreen(state: DeepReadonly<RefractState>, screen: Screen): RefractState;
  setMenuIndex(state: DeepReadonly<RefractState>, index: number): RefractState;
  setSolvedCount(
    state: DeepReadonly<RefractState>,
    count: number,
  ): RefractState;
  setTier(state: DeepReadonly<RefractState>, tier: number): RefractState;
  generateBoard(state: DeepReadonly<RefractState>, tier: number): RefractState;
  loadBoard(
    state: DeepReadonly<RefractState>,
    board: readonly string[],
  ): RefractState;
  pointerDown(
    state: DeepReadonly<RefractState>,
    x: number,
    y: number,
    device?: PointerDevice,
  ): RefractState;
  pointerMove(
    state: DeepReadonly<RefractState>,
    x: number,
    y: number,
    device?: PointerDevice,
  ): RefractState;
  pointerUp(
    state: DeepReadonly<RefractState>,
    device?: PointerDevice,
  ): RefractState;
  clear(state: DeepReadonly<RefractState>): RefractState;
}

/**
 * A board put in play on `playing` with every beam empty and no trace live —
 * what `loadBoard` and `generateBoard` both do with the board they hold.
 */
function poseBoard(
  state: DeepReadonly<RefractState>,
  board: BoardState,
): RefractState {
  return {
    ...state,
    board,
    beams: emptyBeams(board),
    tracing: null,
    screen: "playing",
    menuIndex: 0,
  };
}

/** Build the surface. It holds nothing: every operation is handed its state. */
export function createDebugApi(): RefractDebugApi {
  return {
    version: REFRACT_DEBUG_VERSION,

    /**
     * Every declared field back at its title-screen value. `muted` is
     * deliberately untouched: muting is a player preference the runtime owns,
     * and a reset is not a reason to start making noise again.
     */
    reset(state) {
      return { ...createInitialState(), muted: state.muted };
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
          device: state.pointer.device,
        },
        targets: targetsFor(state).map((target) => ({ ...target })),
        muted: state.muted,
        simTime: state.simTime,
      };
    },

    /** The mode field alone. No screen moves, and no board is generated. */
    setMode(state, mode) {
      return { ...state, mode };
    },

    /**
     * The screen field alone. Everything the screen draws is left as it is,
     * and nothing stays armed, exactly as leaving a screen in play disarms it.
     */
    setScreen(state, screen) {
      return { ...state, screen, armedTarget: null };
    },

    /** The highlighted item on whichever menu the current screen shows. */
    setMenuIndex(state, index) {
      return { ...state, menuIndex: index };
    },

    /** The run's boards-solved count alone; the tier waits for the next solve. */
    setSolvedCount(state, count) {
      return { ...state, solvedCount: count };
    },

    /** The tier the next cascade board is generated at, and nothing else. */
    setTier(state, tier) {
      return { ...state, tier };
    },

    /**
     * A board the generator emits at `tier`, posed exactly as `loadBoard`
     * poses one. The run's progression is untouched: the tier named here is
     * the operation's argument, never written into `state.tier`.
     */
    generateBoard(state, tier) {
      return poseBoard(state, generateBoard(tier));
    },

    /**
     * An arbitrary board posed onto the `playing` screen with every beam
     * empty and no trace live — the surface's main lever. The notation is
     * validated as it is parsed, and a board posed this way is a board like
     * any other: the rules apply to it unchanged.
     */
    loadBoard(state, board) {
      return poseBoard(state, parseBoard(board));
    },

    /**
     * A press, resolved immediately through the real input path: the target it
     * lands in, or the board behind it.
     */
    pointerDown(state, x, y, device = "mouse") {
      return pointerDown(state, x, y, device).state;
    },

    /** A move, resolved immediately: a hover, an extend, a retract, or a no-op. */
    pointerMove(state, x, y, device = "mouse") {
      return pointerMove(state, x, y, device).state;
    },

    /** A release: it takes an armed target, or ends a trace as drawn. */
    pointerUp(state, device = "mouse") {
      return pointerUp(state, device).state;
    },

    /** The `clear` action: every beam emptied, on the playing screen alone. */
    clear(state) {
      return clearBeams(state).state;
    },
  };
}

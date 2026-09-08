// Refract — the debugging and automation surface, `window.__refract`.
//
// `specs/instrumentation.md` specifies it and this file implements it, in two
// layers. `createDebugApi()` builds the POSE SURFACE: every operation a read
// or a pose over `RefractState`, state in and state out, holding nothing. The
// game's `initialize` returns it beside the state, and the runtime hands it
// back from `runtime.debug`. `installDebugApi` then wraps that surface and the
// runtime into the object `window.__refract` carries, whose operations apply
// each pose to the live state — plus the two operations that are not poses at
// all: `setAutoStep` and `advance`, the CLOCK. This build stands on no engine,
// so nothing outside it owns its clock; without those two a scenario could
// only be driven by waiting, and a check that waits measures the machine it
// ran on.
//
// The pointer operations do not stand in for the runtime's pointer: they feed
// the SAME resolution path a player's pointer feeds (`src/tracing.ts`), so the
// hit radius, the grab table, the limits, and the completion test all run
// exactly as they do in play, and each call takes effect immediately in the
// state it returns rather than waiting on a frame. Everything else about
// driving a browser game stays absent: there is no operation for the
// registered actions (the runtime's keyboard is driven by dispatching real key
// events at the page) and no overlay toggle (the runtime owns the backtick
// key and the panel).
//
// The surface is inert during normal play: nothing below runs until something
// calls it.

import { cellCenter, emptyBeams, parseBoard } from "./board";
import { generateBoard } from "./cascade";
import { REFRACT_DEBUG_VERSION } from "./constants";
import { createInitialState } from "./flow";
import { beamComplete, boardSolved, spentAt } from "./rules";
import { pointerDown, pointerMove, pointerUp } from "./game-pointer";
import { targetsFor } from "./layout";
import { performClearBeams } from "./tracing";
import type {
  BoardState,
  Channel,
  Mode,
  NodeKind,
  PointerDevice,
  RefractState,
  Screen,
} from "./game";

/** The `window` property the installed API is published on. */
export const REFRACT_HANDLE = "__refract";

// ---- The snapshot shape (specs/instrumentation.md) -----------------------

/** One pointer target, as the snapshot reports it. */
export interface SnapshotTarget {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

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
  /** The screen's highlighted menu item; rests at `0` on `playing`. */
  menuIndex: number;
  boardIndex: number;
  solvedBoards: number[];
  unlockedCount: number;
  /** The board highlighted on the campaign select grid. */
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

// ---- The pose surface ----------------------------------------------------

/**
 * The pose surface. Every pose takes the current state and returns the next;
 * the one reading, `snapshot`, takes the current state and returns what it
 * read.
 */
export interface RefractDebugApi {
  version: number;
  reset(state: RefractState): RefractState;
  snapshot(state: RefractState): RefractSnapshot;
  /** Bring every reported reading into agreement with the board as it stands. */
  reconcile(state: RefractState): RefractState;
  setMode(state: RefractState, mode: Mode): RefractState;
  setScreen(state: RefractState, screen: Screen): RefractState;
  setMenuIndex(state: RefractState, index: number): RefractState;
  setSolvedCount(state: RefractState, count: number): RefractState;
  setTier(state: RefractState, tier: number): RefractState;
  generateBoard(state: RefractState, tier: number): RefractState;
  loadBoard(state: RefractState, board: readonly string[]): RefractState;
  pointerDown(
    state: RefractState,
    x: number,
    y: number,
    device?: PointerDevice,
  ): RefractState;
  pointerMove(
    state: RefractState,
    x: number,
    y: number,
    device?: PointerDevice,
  ): RefractState;
  pointerUp(state: RefractState, device?: PointerDevice): RefractState;
  clear(state: RefractState): RefractState;
}

/**
 * A board put in play on `playing` with every beam empty and no trace live —
 * what `loadBoard` and `generateBoard` both do with the board they hold.
 */
function poseBoard(state: RefractState, board: BoardState): RefractState {
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

    /**
     * Bring every reported reading into agreement with the board as it stands.
     *
     * Every derived reading this build reports — a node's `x` and `y`, a
     * crystal's `spent`, a beam's `complete`, `solved`, and `targets` — is
     * worked out at the read, in `snapshot` above, from the board's dimensions,
     * the drawn beams and the current screen. Nothing is held that a pose can
     * leave behind, so there is nothing here to rewrite. The operation is
     * required of every build, including one that keeps those readings as stored
     * copies, and this is what it comes to in a build that does not.
     *
     * It advances nothing and it corrects nothing either way: the clock stays
     * where it is, nothing is drawn from the generator, no cue plays, and a beam
     * drawn past a crystal's charges reads as it was drawn rather than being
     * trimmed back to a legal route.
     */
    reconcile(state) {
      return { ...state };
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

    /** A press, resolved immediately through the real input path. */
    pointerDown(state, x, y, device = "mouse") {
      return pointerDown(state, x, y, device).state;
    },

    /** A move, resolved immediately: extend, retract, or a refused no-op. */
    pointerMove(state, x, y, device = "mouse") {
      return pointerMove(state, x, y, device).state;
    },

    /** A release: the trace ends and the beam stays exactly as drawn. */
    pointerUp(state, device = "mouse") {
      return pointerUp(state, device).state;
    },

    /**
     * The `clear` action's own transaction: every beam on the board emptied and
     * any live trace ended, from wherever the game stands.
     *
     * It does NOT ask which screen is up. That is the player's route to the
     * action — `specs/controls.md` reads the key on `playing` alone, and
     * `tryClearBeams` is where that lives — and an operation never asks whether
     * a player could have pressed it (specs/instrumentation.md, "The
     * operations"). A check about the action being unreachable presses the key.
     */
    clear(state) {
      return performClearBeams(state).state;
    },
  };
}

// ---- The installed surface -----------------------------------------------

/**
 * What the installed surface reaches on the runtime: the live state, the pose
 * applier, and the clock. Structural on purpose — `src/runtime.ts` satisfies
 * it without knowing this file exists, and a test can hand the surface a host
 * of its own.
 */
export interface DebugHost {
  readonly state: RefractState;
  /** Replace the live state with what `pose` returns for it. */
  apply(pose: (state: RefractState) => RefractState): void;
  /** Take the game off the wall clock, or give it back. */
  setAutoStep(enabled: boolean): void;
  /** Run `frames` whole frames covering `seconds` of game time. */
  advance(seconds: number, frames?: number): void;
}

/**
 * The object `window.__refract` carries: the pose surface applied to the live
 * state, plus the clock (specs/instrumentation.md).
 */
export interface RefractWindowApi {
  version: number;
  setAutoStep(enabled: boolean): void;
  advance(seconds: number, frames?: number): void;
  reset(): void;
  snapshot(): RefractSnapshot;
  /** Bring every reported reading into agreement with the board as it stands. */
  reconcile(): void;
  setMode(mode: Mode): void;
  setScreen(screen: Screen): void;
  setMenuIndex(index: number): void;
  setSolvedCount(count: number): void;
  setTier(tier: number): void;
  generateBoard(tier: number): void;
  loadBoard(board: readonly string[]): void;
  pointerDown(x: number, y: number, device?: PointerDevice): void;
  pointerMove(x: number, y: number, device?: PointerDevice): void;
  pointerUp(device?: PointerDevice): void;
  clear(): void;
}

/** Build the installed surface over one runtime and its pose surface. */
export function createWindowApi(
  host: DebugHost,
  api: RefractDebugApi,
): RefractWindowApi {
  return {
    version: api.version,

    /**
     * Take the game off real time, and give it back. `false` stops the frame
     * loop advancing the simulation from the wall clock, so the game changes
     * only when `advance` says so; `true` returns it to running itself, which
     * is how a build starts and how it is played. Drawing is unaffected
     * either way: the loop keeps rendering, so the canvas shows the state the
     * most recent frame left.
     */
    setAutoStep(enabled) {
      host.setAutoStep(Boolean(enabled));
    },

    /**
     * Run `frames` whole frames covering `seconds` of game time, each worth
     * `seconds / frames`, immediately and in order. Each is a real frame —
     * the same update the loop runs, then a render — so the game's own
     * completion test and animation produce the result and the canvas
     * reflects it. Advancing while the game is still stepping automatically
     * ADDS to what the wall clock is already doing, so a scenario that wants
     * exactly the frames it asked for calls `setAutoStep(false)` first.
     */
    advance(seconds, frames = 1) {
      host.advance(seconds, frames);
    },

    reset() {
      host.apply((state) => api.reset(state));
    },

    snapshot() {
      return api.snapshot(host.state);
    },

    reconcile() {
      host.apply((state) => api.reconcile(state));
    },

    setMode(mode) {
      host.apply((state) => api.setMode(state, mode));
    },

    setScreen(screen) {
      host.apply((state) => api.setScreen(state, screen));
    },

    setMenuIndex(index) {
      host.apply((state) => api.setMenuIndex(state, index));
    },

    setSolvedCount(count) {
      host.apply((state) => api.setSolvedCount(state, count));
    },

    setTier(tier) {
      host.apply((state) => api.setTier(state, tier));
    },

    generateBoard(tier) {
      host.apply((state) => api.generateBoard(state, tier));
    },

    loadBoard(board) {
      host.apply((state) => api.loadBoard(state, board));
    },

    // The three pointer poses take effect the moment they are called, in the
    // state `apply` stores back — no frame need pass between them, so a whole
    // route draws from code without advancing the game.
    pointerDown(x, y, device = "mouse") {
      host.apply((state) => api.pointerDown(state, x, y, device));
    },

    pointerMove(x, y, device = "mouse") {
      host.apply((state) => api.pointerMove(state, x, y, device));
    },

    pointerUp(device = "mouse") {
      host.apply((state) => api.pointerUp(state, device));
    },

    clear() {
      host.apply((state) => api.clear(state));
    },
  };
}

/**
 * Install the surface on `window.__refract` and return the function that
 * removes it again, while the installed object is still the one this call
 * published. `window` is the global object, so the same install serves the
 * browser and an in-process test alike.
 */
export function installDebugApi(
  host: DebugHost,
  api: RefractDebugApi,
): () => void {
  const installed = createWindowApi(host, api);
  const target = globalThis as unknown as Record<string, unknown>;
  target[REFRACT_HANDLE] = installed;
  return () => {
    if (target[REFRACT_HANDLE] === installed) delete target[REFRACT_HANDLE];
  };
}

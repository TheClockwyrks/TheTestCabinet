// Refract — the debug surface as the CASE specifies it. CASE-PROVIDED.
//
// specs/instrumentation.md fixes the surface a build's `initialize` returns
// beside its state, as `[state, debug]`, and this module is that specification
// written down as types: the operations, their arguments, the snapshot shape,
// and the version. It is the ONLY description of the surface the validators
// read. The build implements the surface under whatever module it likes and
// declares its own `RefractDebugApi` for it; nothing here imports it, and the
// harness reaches the object itself through `engine.debug` alone. So a build
// whose surface departs from the specification is held against the
// specification, not against its own idea of what it wrote.
//
// HOW THE SURFACE IS DRIVEN. The engine holds the state by value and hands it
// out read-only, so the surface holds no state of its own and nothing on it
// mutates anything. Every operation is written in the shape of the game's
// `update`: a POSE takes the current state and returns the next one
// (`loadBoard(state, board)`, `clear(state)`), and a READING takes the
// current state and returns what it read (`snapshot(state)`). A caller drives
// a pose through `engine.apply((s) => debug.clear(s))` — the engine stores what
// the pose returned, and the next frame's `update` receives it — and a reading
// through `debug.snapshot(engine.state)`. `version` is a plain number.
//
// The clock, the keyboard, and the overlay are the engine's under this engine
// (specs/instrumentation.md "What the runtime provides instead"), so the
// surface carries no `setAutoStep` and no `advance`: those two exist under the
// engineless build alone, and demanding them here would fail a conformant
// build.
//
// The surface is generic over the build's state type, because this module
// imports nothing of the build: `harness.ts` binds it to the `RefractState`
// the build declared, and the `Driver` there is what gives the checks the
// imperative reading (`h.debug.loadBoard(rows)`, `h.debug.snapshot()`) over
// the pure shape declared here.

import type { DeepReadonly } from "ts-essentials";

/** The surface's version, reported as `version` (REFRACT_DEBUG_VERSION). */
export const REFRACT_DEBUG_VERSION = 2;

/** The seed `reset()` restores when the caller names none (DEFAULT_SEED). */
export const DEFAULT_SEED = 1;

/** The screens the state machine moves between. */
export type Screen =
  | "title"
  | "howto"
  | "select"
  | "playing"
  | "solved"
  | "complete";

/** The two ways to play, chosen from the title menu. */
export type Mode = "campaign" | "cascade";

/** One beam identity; the three are the members of CHANNELS in this order. */
export type Channel = "triangle" | "square" | "diamond";

/** The three kinds of node specs/board.md defines. */
export type NodeKind = "emitter" | "lens" | "crystal";

/** Which device drove the pointer, as `specs/controls.md` names them. */
export type PointerDevice = "mouse" | "pen" | "touch";

/**
 * One pointer target: the rectangle a screen is worked through, in the stage's
 * logical units, under the id `specs/controls.md` fixes for it.
 */
export interface TargetSnapshot {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One cell address, `col` and `row` zero-indexed from the top-left. */
export interface CellRef {
  col: number;
  row: number;
}

/** One node, as the snapshot reports it. `x`/`y` are derived from the cell
 * center formula in specs/board.md; a crystal's `spent` from the crossings the
 * drawn beams have begun on it. */
export interface NodeSnapshot {
  col: number;
  row: number;
  x: number;
  y: number;
  kind: NodeKind;
  /** `null` for a crystal, which is channel-neutral. */
  channel: Channel | null;
  /** `null` for an emitter and for a lens. */
  charges: number | null;
  /** `null` for an emitter and for a lens. */
  spent: number | null;
}

/** One channel's beam, as the snapshot reports it. `complete` is derived from
 * R6 and R7 in specs/beams.md. `cells` is the drawn order: the last cell is
 * the end the most recent trace worked from. */
export interface BeamSnapshot {
  cells: CellRef[];
  complete: boolean;
}

/** The live trace: the channel being extended, and the live end's cell. */
export interface TracingSnapshot {
  channel: string;
  live: CellRef;
}

/** The plain, JSON-serializable view `snapshot` returns
 * (specs/instrumentation.md "Snapshot shape"). */
export interface RefractSnapshot {
  version: number;
  screen: Screen;
  mode: Mode;
  /** The screen's highlighted menu item, from 0; rests at 0 on `playing`. */
  menuIndex: number;
  /** The campaign board being played, counted from 0. Rests at 0. */
  boardIndex: number;
  /** The campaign indices solved so far, ascending. Rests empty. */
  solvedBoards: number[];
  /** How many campaign boards are open to the player. Rests at 1. */
  unlockedCount: number;
  /** The board highlighted on select, counted from 0. Rests at 0. */
  selectIndex: number;
  /** Boards solved in the current cascade run. Rests at 0. */
  solvedCount: number;
  /** The tier the next cascade board is generated at. Rests at 1. */
  tier: number;
  board: {
    cols: number;
    rows: number;
    nodes: NodeSnapshot[];
  };
  /** One entry per channel present on the board, and no entry for a channel
   * the board does not use. */
  beams: Partial<Record<Channel, BeamSnapshot>>;
  /** Derived from R9 in specs/beams.md. */
  solved: boolean;
  tracing: TracingSnapshot | null;
  pointer: { x: number; y: number; down: boolean; device: PointerDevice };
  /** The current screen's pointer targets, under the ids and in the order
   * specs/controls.md fixes for that screen. */
  targets: TargetSnapshot[];
  muted: boolean;
  /** Accumulated simulation time, in seconds. */
  simTime: number;
  /** The seeded generator's current state. */
  rngState: number;
}

/**
 * The surface a build returns beside its state from `initialize`, over the
 * build's own state type `S`.
 *
 * Each pose is a transition — the current state in, the next state out — and
 * `snapshot` is a reading of the current state. None of them touches the state
 * it was handed: `DeepReadonly<S>` is the view the engine hands out, and the
 * compiler is what says a pose returns a new value rather than mutating.
 *
 * The pointer operations feed the same immediate input path a player's pointer
 * feeds, and each takes effect in the state the call returns, so a whole route
 * is drawn from code without a frame passing between the calls.
 */
export interface RefractDebugApi<S = unknown> {
  version: number;
  reset(state: DeepReadonly<S>, options?: { seed?: number }): S;
  snapshot(state: DeepReadonly<S>): RefractSnapshot;
  /**
   * Bring every value the snapshot reports into agreement with the board as it
   * stands, without advancing anything. A node's `x`/`y`, a crystal's `spent`, a
   * beam's `complete`, `solved` and `targets` are all derived, and a build that
   * keeps any of them as a stored copy rewrites that copy here. It moves no
   * clock, runs no system, plays no cue, and corrects nothing.
   */
  reconcile(state: DeepReadonly<S>): S;
  /** The mode field alone: no screen moves and no board is generated. */
  setMode(state: DeepReadonly<S>, mode: Mode): S;
  /** The screen field alone: the board, the beams and the menus stay as they are. */
  setScreen(state: DeepReadonly<S>, screen: Screen): S;
  /** The highlighted item on whichever menu the current screen shows. */
  setMenuIndex(state: DeepReadonly<S>, index: number): S;
  /** `board` is the board notation specs/board.md defines, one string per row. */
  loadBoard(state: DeepReadonly<S>, board: readonly string[]): S;
  pointerDown(
    state: DeepReadonly<S>,
    x: number,
    y: number,
    device?: PointerDevice,
  ): S;
  pointerMove(
    state: DeepReadonly<S>,
    x: number,
    y: number,
    device?: PointerDevice,
  ): S;
  pointerUp(state: DeepReadonly<S>, device?: PointerDevice): S;
  /**
   * The `clear` action's own transaction: every beam emptied and any live trace
   * ended, from wherever the game stands. The screen the action is read on is
   * the player's route to it, not this operation's condition.
   */
  clear(state: DeepReadonly<S>): S;
}

/**
 * The operations that READ the state rather than replace it.
 *
 * A driver over the surface needs to know which members to call with the
 * current state and hand back, and which to run through `engine.apply`; the
 * surface's shape alone cannot say at runtime, so the specification names them.
 */
export const READINGS = ["snapshot"] as const;

/** Every operation the surface must carry under an engine build. `setAutoStep`
 * and `advance` belong to the engineless build alone. */
export const REQUIRED_OPS = [
  "reset",
  "snapshot",
  "reconcile",
  "setMode",
  "setScreen",
  "setMenuIndex",
  "loadBoard",
  "pointerDown",
  "pointerMove",
  "pointerUp",
  "clear",
] as const;

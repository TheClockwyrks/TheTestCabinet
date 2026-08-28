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
// (`loadBoard(state, board)`, `trace(state, cells)`), and a READING takes the
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
export const REFRACT_DEBUG_VERSION = 1;

/** The seed `reset()` restores when the caller names none (DEFAULT_SEED). */
export const DEFAULT_SEED = 1;

/** The screens the state machine moves between. */
export type Screen =
  "title" | "howto" | "select" | "playing" | "solved" | "complete";

/** The two ways to play, chosen from the title menu. */
export type Mode = "campaign" | "cascade";

/** One beam identity; the three are the members of CHANNELS in this order. */
export type Channel = "triangle" | "square" | "diamond";

/** The three kinds of node specs/board.md defines. */
export type NodeKind = "emitter" | "lens" | "crystal";

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
  pointer: { x: number; y: number; down: boolean };
  muted: boolean;
  /** Accumulated simulation time, in seconds. */
  simTime: number;
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
  startMode(state: DeepReadonly<S>, mode: Mode): S;
  /** `board` is the board notation specs/board.md defines, one string per row. */
  loadBoard(state: DeepReadonly<S>, board: readonly string[]): S;
  pointerDown(state: DeepReadonly<S>, x: number, y: number): S;
  pointerMove(state: DeepReadonly<S>, x: number, y: number): S;
  pointerUp(state: DeepReadonly<S>): S;
  /** Sugar over the three pointer operations: press at the first cell's
   * center, a move to each remaining center in turn, then a release. A list
   * the limits refuse part way through leaves the beam ending at the last
   * segment they permitted. */
  trace(state: DeepReadonly<S>, cells: readonly CellRef[]): S;
  /** The `clear` action: every beam emptied, on `playing` alone. */
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
  "startMode",
  "loadBoard",
  "pointerDown",
  "pointerMove",
  "pointerUp",
  "trace",
  "clear",
] as const;

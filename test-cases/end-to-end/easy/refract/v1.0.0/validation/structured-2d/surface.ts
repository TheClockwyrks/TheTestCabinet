// Refract — the debug surface as the CASE specifies it. CASE-PROVIDED.
//
// specs/instrumentation.md fixes the surface the game instance's `initialize`
// builds and returns, and this module is that specification written down as
// types: the operations, their arguments, the snapshot shape, and the version.
// It is the ONLY description of the surface the validators read. The build
// implements the surface under whatever module it likes and declares its own
// type for it — the `D` of its `GameDefinition<D>`; nothing here imports it, and
// the harness reaches the object itself through `engine.debug` alone. So a
// build whose surface departs from the specification is held against the
// specification, not against its own idea of what it wrote.
//
// HOW THE SURFACE IS DRIVEN. Each operation is a method that acts on the
// running game at the moment of the call, through the same systems play uses:
// a POSE takes only the arguments its heading names, returns nothing, and
// arranges the live world (`loadBoard(rows)`, `setScreen("select")`), and a
// READING takes no arguments and returns plain data read off the world at the
// instant of the call (`snapshot()`). A caller therefore drives both directly —
// `engine.debug.loadBoard(rows)`, `engine.debug.snapshot()` — with no wrapper
// in between. `version` is a plain number.
//
// The three pointer operations are the exception worth naming: the
// specification says each takes effect the moment it is called, resolved
// against the live state before the call returns, so a whole route is drawn
// from code with no frame advanced between the calls. The clock, the keyboard,
// the pointer, and the overlay belong to the engine under this engine, so the
// surface carries no operation for any of them — `setAutoStep` and `advance`
// exist under the engineless build alone, and demanding either here would fail
// a perfectly conformant build.

/** The surface's version, reported as `version`. */
export const REFRACT_DEBUG_VERSION = 2;

/** The seed `reset()` restores when the caller names none. */
export const DEFAULT_SEED = 1;

/** The screens the state machine moves between. */
export type Screen =
  | "title"
  | "howto"
  | "select"
  | "playing"
  | "solved"
  | "complete";

/** The two ways Refract is played. */
export type Mode = "campaign" | "cascade";

/** The three channel identifiers, in the order `CHANNELS` fixes. */
export type Channel = "triangle" | "square" | "diamond";

/** The three kinds of node a cell may hold. */
export type NodeKind = "emitter" | "lens" | "crystal";

/** One cell address, `col` and `row` zero-indexed from the top-left. */
export interface CellRef {
  col: number;
  row: number;
}

/**
 * One node, as a snapshot reports it. `x` and `y` are derived from the cell
 * center formula in specs/board.md; `channel` is `null` for a crystal, and
 * `charges` and `spent` are `null` for an emitter and for a lens. `spent` is
 * derived from the crossings the drawn beams have begun on the crystal.
 */
export interface NodeSnapshot {
  col: number;
  row: number;
  x: number;
  y: number;
  kind: NodeKind;
  channel: Channel | null;
  charges: number | null;
  spent: number | null;
}

/** The board being played, as a snapshot reports it. */
export interface BoardSnapshot {
  cols: number;
  rows: number;
  nodes: NodeSnapshot[];
}

/**
 * One channel's beam. `cells` lists the cells its segments join, in the order
 * they were drawn, so the last cell is the end the most recent trace worked
 * from; `complete` is derived from R6 and R7 in specs/beams.md.
 */
export interface BeamSnapshot {
  cells: CellRef[];
  complete: boolean;
}

/** The live trace: its channel, and the cell of the live end. */
export interface TracingSnapshot {
  channel: string;
  live: CellRef;
}

/** The pointer as of the current frame, in logical stage units. */
export type PointerDevice = "mouse" | "pen" | "touch";

export interface PointerSnapshot {
  x: number;
  y: number;
  down: boolean;
  device: PointerDevice;
}

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

/**
 * The plain, JSON-serializable view `snapshot()` returns.
 *
 * The shape is fixed and every field is present whatever the mode: a field the
 * current mode does not use reports its resting value rather than going
 * missing (specs/instrumentation.md gives the table). `beams` carries one
 * entry per channel present on the board and no entry for a channel the board
 * does not use. `solved` is derived from R9 in specs/beams.md.
 */
export interface RefractSnapshot {
  version: number;
  screen: Screen;
  mode: Mode;
  /** The screen's highlighted menu item, from 0; rests at 0 on `playing`. */
  menuIndex: number;
  /** The campaign board being played, counted from 0. */
  boardIndex: number;
  /** The campaign indices solved so far, ascending. */
  solvedBoards: number[];
  /** How many campaign boards are open to the player. */
  unlockedCount: number;
  /** The board highlighted on select, counted from 0. */
  selectIndex: number;
  /** Boards solved in the current cascade run. */
  solvedCount: number;
  /** The tier the next cascade board is generated at. */
  tier: number;
  board: BoardSnapshot;
  beams: Partial<Record<Channel, BeamSnapshot>>;
  solved: boolean;
  tracing: TracingSnapshot | null;
  pointer: PointerSnapshot;
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
 * The surface the game instance's `initialize` returns, which the engine hands
 * back from `engine.debug`.
 *
 * Each pose acts on the live game and returns nothing, and `snapshot` is a
 * reading of that same running game. The pointer operations take
 * effect at the call; a SCREEN-CHANGING pose (`reset`, `setScreen`,
 * `loadBoard`) may land at the call or as late as the end of the next advanced
 * frame — the spec fixes the arrangement, not the moment — so a scenario
 * poses, advances a frame, and then reads.
 */
export interface RefractDebugApi {
  version: number;
  reset(options?: { seed?: number }): void;
  snapshot(): RefractSnapshot;
  /**
   * Bring every value the snapshot reports into agreement with the board as it
   * stands, without advancing anything. A node's `x`/`y`, a crystal's `spent`, a
   * beam's `complete`, `solved` and `targets` are all derived, and a build that
   * keeps any of them as a stored copy rewrites that copy here. It moves no
   * clock, runs no system, plays no cue, and corrects nothing.
   */
  reconcile(): void;
  /** The mode field alone: no screen moves and no board is generated. */
  setMode(mode: Mode): void;
  /** The screen field alone: the board, the beams and the menus stay as they are. */
  setScreen(screen: Screen): void;
  /** The highlighted item on whichever menu the current screen shows. */
  setMenuIndex(index: number): void;
  /** Poses a board written in specs/board.md notation, one string per row. */
  loadBoard(board: readonly string[]): void;
  pointerDown(x: number, y: number, device?: PointerDevice): void;
  pointerMove(x: number, y: number, device?: PointerDevice): void;
  pointerUp(device?: PointerDevice): void;
  /**
   * The `clear` action's own transaction: every beam emptied and any live trace
   * ended, from wherever the game stands. The screen the action is read on is
   * the player's route to it, not this operation's condition.
   */
  clear(): void;
}

/**
 * The operations that READ the running game rather than pose it.
 *
 * The surface's shape alone cannot say at runtime which members return a value
 * and which arrange the world, so the specification names them: a check that
 * sweeps the surface (instrumentation/surface-present) calls a reading for its
 * value and a pose for its effect.
 */
export const READINGS = ["snapshot"] as const;

/**
 * Every operation the surface must carry under this engine. `setAutoStep` and
 * `advance` belong to the engineless build alone (specs/instrumentation.md):
 * the engine owns the clock here, so they are deliberately absent.
 */
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

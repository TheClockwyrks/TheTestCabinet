// Coil — the debug and automation surface, as types. CASE-PROVIDED.
//
// This file is the ONLY description of the surface this project holds, and it is
// declared from `specs/instrumentation.md` rather than imported from anything a
// build wrote. That is the whole point of it: a check that reached into the
// build's own module for the shape of the thing it is grading would grade the
// build against itself, and would pass a build whose surface disagreed with the
// specification as long as it disagreed consistently. The build declares its own
// `CoilDebugApi` in `src/game.ts`; nothing here imports it, and the harness
// reaches the object itself through `engine.debug` alone.
//
// HOW THE SURFACE IS DRIVEN UNDER THIS ENGINE. The engine holds the state by
// value and hands it out read-only, so the surface holds no state of its own and
// nothing on it mutates anything. Every operation is written in the shape of the
// game's `update`: a POSE takes the current state and returns the next one
// (`setScore(state, 120)`), and a READING takes the current state and returns
// what it read (`snapshot(state)`). A caller drives a pose through the engine's
// `apply`, as `engine.apply((s) => debug.setScore(s, 120))`, and a reading
// against the engine's current state, as `debug.snapshot(engine.state)`.
// `version` is a plain number rather than an operation.
//
// There is NO clock operation and NO key operation here, and that is a
// difference from the engineless spelling of the same surface rather than an
// omission: the engine owns the frame loop and the keyboard, so a check steps
// the game with `engine.advance` under a clock of its own and dispatches a
// keyboard-shaped event at the surface's own listener.
//
// The surface is generic over the build's state type, because this module
// imports nothing of the build: `harness.ts` binds it to the `CoilState` the
// build declared, and the `Driver` there is what gives the checks the imperative
// reading (`h.debug.setScore(120)`, `h.debug.snapshot()`) over the pure shape
// declared here.
//
// WHAT IS OPTIONAL, AND WHY. `clearObstacles` and `addObstacle` are laid on the
// surface only by a mode that places obstacle cells, which `specs/mode.md` makes
// the Maze mode alone. So they are declared optional, and a check that needs
// them reaches them through the harness's obstacle helpers, which say what is
// missing rather than throwing a `TypeError` several frames later.

import type { DeepReadonly } from "ts-essentials";

/** One cell of the board, addressed from the top-left as `specs/board.md` does. */
export interface Cell {
  col: number;
  row: number;
}

/** The direction the snake travels in. */
export type Dir = "up" | "down" | "left" | "right";

/** Every screen the state machine moves between. The game opens on `title`. */
export type Screen =
  | "title"
  | "howto"
  | "playing"
  | "paused"
  | "gameover"
  | "cleared";

/** The two modes a variant of this case ships, as the snapshot reports one. */
export type Mode = "classic" | "maze";

/**
 * Every operation the surface carries in every mode.
 *
 * Ordered as `specs/instrumentation.md` states them, so a build's surface can be
 * read against the file that specifies it without hunting.
 */
export const REQUIRED_OPS = [
  "reset",
  "snapshot",
  "menuItemRect",
  "setScreen",
  "setMenuIndex",
  "setScore",
  "setBest",
  "setCombo",
  "setComboWindow",
  "setSnake",
  "setDirection",
  "clearTurns",
  "setSnakeSteering",
  "setSnakeTravel",
  "setPellet",
  "clearPellet",
  "setPelletRespawn",
] as const;

/** The operations a mode that lays obstacle cells adds, and no other mode has. */
export const OBSTACLE_OPS = ["clearObstacles", "addObstacle"] as const;

/** The name of one operation the surface carries. */
export type OperationName =
  | (typeof REQUIRED_OPS)[number]
  | (typeof OBSTACLE_OPS)[number];

/**
 * The operations that READ the state rather than replace it.
 *
 * A driver over the surface needs to know which members to call with the current
 * state and hand back, and which to run through `engine.apply`; the surface's
 * shape alone cannot say at runtime, so the specification names them.
 */
export const READINGS = ["snapshot", "menuItemRect"] as const;

/** `reset`'s options: the seed the pellet generator is laid with. */
export interface ResetOptions {
  seed?: number;
}

/**
 * The hit region a menu item occupies, in the logical units of
 * `specs/overview.md`: `x` and `y` are its top-left corner, `w` and `h` its size.
 *
 * `specs/ui.md` leaves the LAYOUT of a menu to the build and fixes only that a
 * pointer over an item's region selects it, so the region is something the build
 * reports rather than something this project knows.
 */
export interface MenuRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The plain object `snapshot(state)` returns, field for field as
 * `specs/instrumentation.md` states it.
 *
 * Every field is present on every screen. `snake` runs head first, `turns` runs
 * oldest first, and `pellet` is `null` only when no pellet is on the board.
 */
export interface CoilSnapshot {
  version: number;
  screen: Screen;
  /** The highlighted item, `0` on a screen with no menu. */
  menuIndex: number;
  /** The title menu's remembered selection. */
  titleIndex: number;
  mode: Mode;
  score: number;
  /** The best score of the session. */
  best: number;
  /** The multiplier M, in `[1, COMBO_MAX]`. */
  combo: number;
  /** Seconds left on the window; `0` is closed. */
  comboWindow: number;
  muted: boolean;
  /** Ticks resolved since the last reset. */
  ticks: number;
  /** Simulation time accumulated since then, in seconds. */
  simTime: number;
  dir: Dir;
  /** Buffered steering requests, oldest first, at most `TURN_QUEUE_MAX`. */
  turns: Dir[];
  /** The chain, head at index `0` and tail at the last index. */
  snake: Cell[];
  pellet: Cell | null;
  /** The obstacle cells on the board, in any order. */
  obstacles: Cell[];
  /** Whether the snake's steering is running. */
  steering: boolean;
  /** Whether the snake's body travels. */
  travel: boolean;
  /** Whether an eaten pellet is replaced. */
  pelletRespawn: boolean;
}

/**
 * The surface a build returns beside its state from `initialize`, over the
 * build's own state type `S`.
 *
 * Each pose sets ONE thing and leaves the rest of the game as it stands, and the
 * game's own tick, turning, collision, pellet placement and scoring run from
 * there exactly as they do in play. A caller that wants several things arranged
 * makes several calls, which is why every compound sequence in this project
 * lives in `harness.ts` rather than here.
 *
 * None of them touches the state it was handed: `DeepReadonly<S>` is the view
 * the engine hands out, and the compiler is what says a pose returns a new value
 * rather than mutating.
 */
export interface CoilDebugApi<S = unknown> {
  /** `COIL_DEBUG_VERSION`, a plain number rather than an operation. */
  version: number;

  reset(state: DeepReadonly<S>, options?: ResetOptions): S;
  snapshot(state: DeepReadonly<S>): CoilSnapshot;
  /**
   * The hit region of item `index` on the menu the current screen shows, or
   * `null` on `"playing"` and for an index that menu has no item at.
   */
  menuItemRect(state: DeepReadonly<S>, index: number): MenuRect | null;

  setScreen(state: DeepReadonly<S>, screen: Screen): S;
  setMenuIndex(state: DeepReadonly<S>, index: number): S;

  setScore(state: DeepReadonly<S>, points: number): S;
  setBest(state: DeepReadonly<S>, points: number): S;
  setCombo(state: DeepReadonly<S>, multiplier: number): S;
  setComboWindow(state: DeepReadonly<S>, seconds: number): S;

  setSnake(state: DeepReadonly<S>, cells: readonly Cell[]): S;
  setDirection(state: DeepReadonly<S>, dir: Dir): S;
  clearTurns(state: DeepReadonly<S>): S;
  setSnakeSteering(state: DeepReadonly<S>, enabled: boolean): S;
  setSnakeTravel(state: DeepReadonly<S>, enabled: boolean): S;

  setPellet(state: DeepReadonly<S>, col: number, row: number): S;
  clearPellet(state: DeepReadonly<S>): S;
  setPelletRespawn(state: DeepReadonly<S>, enabled: boolean): S;

  /** Laid only by a mode that places obstacle cells. */
  clearObstacles?(state: DeepReadonly<S>): S;
  /** Laid only by a mode that places obstacle cells. */
  addObstacle?(state: DeepReadonly<S>, col: number, row: number): S;
}

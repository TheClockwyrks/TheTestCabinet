// Coil — the debug and automation surface, as types. CASE-PROVIDED.
//
// This file is the ONLY description of the surface this project holds, and it is
// declared from `specs/instrumentation.md` rather than imported from anything a
// build wrote. That is the whole point of it: a check that reached into the
// build's own module for the shape of the thing it is grading would grade the
// build against itself, and would pass a build whose surface disagreed with the
// specification as long as it disagreed consistently.
//
// TWO SHAPES OF THE SAME SURFACE. {@link CoilDebugApi} is the surface as the
// specification words it and as the build installs it on `window.__coil`: plain,
// synchronous operations over plain values. {@link DrivenSurface} is that same
// surface as a suite reaches it — every operation crossing into the page, so
// every one returning a promise. The second is derived from the first, so the
// two can never drift: adding an operation here adds it to both.
//
// WHAT IS OPTIONAL, AND WHY. `clearObstacles` and `addObstacle` are laid on the
// surface only by a mode that places obstacle cells, which `specs/mode.md` makes
// the Maze mode alone. So they are declared optional, and a check that needs them
// reaches them through the harness's obstacle helpers, which say what is missing
// rather than throwing a `TypeError` several frames later.

import type { Cell, Dir, Mode, Screen } from "./constants";

/** The `window` property `specs/instrumentation.md` fixes the surface on. */
export const HANDLE = "__coil";

/**
 * Every operation the surface carries in every mode.
 *
 * The two clock operations are here because they exist under this engine alone:
 * nothing outside an engineless build owns its loop, so `specs/instrumentation.md`
 * puts the clock on the surface.
 */
export const REQUIRED_OPS = [
  "setAutoStep",
  "advance",
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
 * The plain object `snapshot()` returns, field for field as
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
  /** Whether the frame loop advances the simulation. This engine alone. */
  autoStep: boolean;
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
 * The surface as `specs/instrumentation.md` words it, and as the build installs
 * it on `window.__coil`.
 *
 * Each pose sets ONE thing and leaves the rest of the game as it stands, and the
 * game's own tick, turning, collision, pellet placement and scoring run from
 * there exactly as they do in play. A caller that wants several things arranged
 * makes several calls, which is why every compound sequence in this project lives
 * in `harness.ts` rather than here.
 */
export interface CoilDebugApi {
  /** `COIL_DEBUG_VERSION`, a plain number rather than an operation. */
  version: number;

  // The clock, which exists under this engine alone.
  setAutoStep(enabled: boolean): void;
  advance(seconds: number, frames?: number): void;

  reset(options?: ResetOptions): void;
  snapshot(): CoilSnapshot;
  /**
   * The hit region of item `index` on the menu the current screen shows, or
   * `null` on `"playing"` and for an index that menu has no item at.
   */
  menuItemRect(index: number): MenuRect | null;

  setScreen(screen: Screen): void;
  setMenuIndex(index: number): void;

  setScore(points: number): void;
  setBest(points: number): void;
  setCombo(multiplier: number): void;
  setComboWindow(seconds: number): void;

  setSnake(cells: readonly Cell[]): void;
  setDirection(dir: Dir): void;
  clearTurns(): void;
  setSnakeSteering(enabled: boolean): void;
  setSnakeTravel(enabled: boolean): void;

  setPellet(col: number, row: number): void;
  clearPellet(): void;
  setPelletRespawn(enabled: boolean): void;

  /** Laid only by a mode that places obstacle cells. */
  clearObstacles?(): void;
  /** Laid only by a mode that places obstacle cells. */
  addObstacle?(col: number, row: number): void;
}

/**
 * The same surface as a suite drives it: every operation crossing into the page,
 * so every one awaited.
 *
 * `version` is a value rather than an operation, and a value cannot cross a page
 * boundary by being read, so it is not carried here; the harness reports it from
 * `probe` instead, which is also where a check that is ABOUT the version reads it.
 */
export type DrivenSurface = {
  [K in keyof Omit<CoilDebugApi, "version">]-?: CoilDebugApi[K] extends (
    ...args: infer A
  ) => infer R
    ? (...args: A) => Promise<R>
    : never;
};

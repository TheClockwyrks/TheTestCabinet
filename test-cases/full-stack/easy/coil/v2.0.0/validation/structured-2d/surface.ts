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
// HOW THE SURFACE IS DRIVEN UNDER THIS ENGINE. The game's state lives in the
// framework objects the engine owns, and the game instance holds the engine, so
// the surface acts on the LIVE world at the moment of the call. Every operation
// is a method that takes only the parameters its own heading names: a POSE
// arranges the running game and returns nothing (`setScore(120)`), and a READING
// takes no parameters and returns plain data built at the call
// (`snapshot()`). A caller therefore drives both directly —
// `engine.debug.setScore(120)`, `engine.debug.snapshot()` — with no wrapper in
// between, which is why the harness's `h.debug` IS this object rather than a
// driver over it. `version` is a plain number rather than an operation.
//
// There is NO clock operation and NO key operation here, and that is a
// difference from the engineless spelling of the same surface rather than an
// omission: the engine owns the frame loop and the keyboard, so a check steps
// the game with `engine.advance` under a clock of its own and dispatches a
// keyboard-shaped event at the surface's own listener.
//
// WHAT IS OPTIONAL, AND WHY. `clearObstacles` and `addObstacle` are laid on the
// surface only by a mode that places obstacle cells, which `specs/mode.md` makes
// the Maze mode alone. So they are declared optional, and a check that needs
// them reaches them through the harness's obstacle helpers, which say what is
// missing rather than throwing a `TypeError` several frames later.

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
  "setNextPellet",
  "drawPelletCell",
] as const;

/** The operations a mode that lays obstacle cells adds, and no other mode has. */
export const OBSTACLE_OPS = ["clearObstacles", "addObstacle"] as const;

/** The name of one operation the surface carries. */
export type OperationName =
  | (typeof REQUIRED_OPS)[number]
  | (typeof OBSTACLE_OPS)[number];

/**
 * The operations that READ the running game rather than pose it.
 *
 * The surface's shape alone cannot say at runtime which members return a value
 * and which arrange the world, so the specification names them: a check that
 * sweeps the surface (`instrumentation/debug-api`) calls a reading for its value
 * and a pose for its effect.
 */
export const READINGS = ["snapshot", "menuItemRect"] as const;

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
  /** The cell `setNextPellet` posed for the next spawn; `null` once consumed. */
  nextPellet: Cell | null;
}

/**
 * The surface the game instance's `initialize` returns, which the engine hands
 * back from `engine.debug`.
 *
 * Each pose sets ONE thing on the live game and leaves the rest of it as it
 * stands, and the game's own tick, turning, collision, pellet placement and
 * scoring run from there exactly as they do in play. A caller that wants several
 * things arranged makes several calls, which is why every compound sequence in
 * this project lives in `harness.ts` rather than here.
 *
 * Coil runs in one level for the whole session and every screen is a value of
 * the state's screen field, so a pose that changes the screen takes effect at
 * the call rather than riding a level transition: a check reads the result
 * without advancing a frame first.
 */
export interface CoilDebugApi {
  /** `COIL_DEBUG_VERSION`, a plain number rather than an operation. */
  version: number;

  reset(): void;
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
  /** Poses the cell the next spawn places the pellet on. */
  setNextPellet(col: number, row: number): void;
  /**
   * The pellet draw alone: a cell drawn uniformly from the valid set as the
   * board stands, or `null` when that set is empty. It changes nothing.
   */
  drawPelletCell(): Cell | null;

  /** Laid only by a mode that places obstacle cells. */
  clearObstacles?(): void;
  /** Laid only by a mode that places obstacle cells. */
  addObstacle?(col: number, row: number): void;
}

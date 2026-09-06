// Coil — the debugging and automation surface (specs/instrumentation.md).
//
// `createDebugApi` builds it, the game instance's `initialize` returns it, and
// the engine holds that same object and returns it from `engine.debug` — the one
// way a caller reaches it. Nothing is installed on the page.
//
// Every operation acts on the LIVE game at the moment it is called, reaching the
// open world through the accessor the instance supplies — `engine.world` at the
// call. A POSE takes only the parameters its own heading names, sets ONE thing
// through the same state play writes, and returns nothing; a READING takes no
// parameters, returns plain data built at the call, and changes nothing. The
// game's own tick, turning, collision, pellet placement and scoring run from
// there exactly as they do in play, so a scenario driven from code behaves
// exactly like one played by hand. Nothing here fabricates an outcome.
//
// There is no clock operation and no key operation, because the engine owns
// both: a caller steps the game with `engine.advance` under a clock of its own,
// and dispatches a keyboard event at the engine's own listener. There is no
// overlay operation either, for the same reason.
//
// An argument outside the domain its operation states is invalid, and the call
// fails loudly rather than guessing what was meant.

import { cellsHold, isAdjacent, isInterior } from "./board";
import {
  COIL_DEBUG_VERSION,
  COMBO_MAX,
  COMBO_WINDOW,
  DIRECTIONS,
  GRID_COLS,
  GRID_ROWS,
  MODE,
  SCREENS,
  type Cell,
  type Direction,
  type Screen,
} from "./constants";
import { resetSession } from "./flow";
import { coilState, type CoilState } from "./game";
import { menuItemRect, menuItems, type MenuRect } from "./menus";
import { HAS_OBSTACLES } from "./mode";
import { drawPelletCell } from "./sim";
import type { World } from "@clockwyrks/structured-2d";

// ---- The snapshot shape (specs/instrumentation.md) ------------------------

/** The plain, JSON-serializable read `snapshot` returns. */
export interface CoilSnapshot {
  version: number;
  screen: Screen;
  menuIndex: number;
  titleIndex: number;
  mode: typeof MODE;
  score: number;
  best: number;
  combo: number;
  comboWindow: number;
  muted: boolean;
  ticks: number;
  simTime: number;
  dir: Direction;
  turns: Direction[];
  snake: Cell[];
  pellet: Cell | null;
  obstacles: Cell[];
  steering: boolean;
  travel: boolean;
  pelletRespawn: boolean;
  nextPellet: Cell | null;
}

// ---- The surface ---------------------------------------------------------

export interface CoilDebugApi {
  version: number;
  reset(): void;
  snapshot(): CoilSnapshot;
  menuItemRect(index: number): MenuRect | null;
  setScreen(screen: Screen): void;
  setMenuIndex(index: number): void;
  setScore(points: number): void;
  setBest(points: number): void;
  setCombo(multiplier: number): void;
  setComboWindow(seconds: number): void;
  setSnake(cells: readonly Cell[]): void;
  setDirection(dir: Direction): void;
  clearTurns(): void;
  setSnakeSteering(enabled: boolean): void;
  setSnakeTravel(enabled: boolean): void;
  setPellet(col: number, row: number): void;
  clearPellet(): void;
  setPelletRespawn(enabled: boolean): void;
  setNextPellet(col: number, row: number): void;
  drawPelletCell(): Cell | null;
  /** Laid only by a mode that places obstacle cells. */
  clearObstacles?(): void;
  addObstacle?(col: number, row: number): void;
}

// ---- Argument checking ---------------------------------------------------

function fail(message: string): never {
  throw new Error(`Coil debug: ${message}`);
}

function requireBoolean(name: string, value: unknown): boolean {
  if (typeof value !== "boolean") {
    fail(`${name} takes true or false; got ${String(value)}`);
  }
  return value;
}

function requireInteger(name: string, value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    fail(`${name} takes a whole number; got ${String(value)}`);
  }
  return value;
}

function requireWhole(name: string, value: unknown, min: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min) {
    fail(
      `${name} takes a whole number of at least ${min}; got ${String(value)}`,
    );
  }
  return value;
}

function requireDirection(name: string, value: unknown): Direction {
  if (!DIRECTIONS.includes(value as Direction)) {
    fail(`${name} takes one of ${DIRECTIONS.join(", ")}; got ${String(value)}`);
  }
  return value as Direction;
}

function requireInterior(name: string, col: unknown, row: unknown): Cell {
  const c = requireInteger(`${name} col`, col);
  const r = requireInteger(`${name} row`, row);
  if (!isInterior(c, r)) {
    fail(`${name} takes an interior cell; (${c}, ${r}) is not one`);
  }
  return { col: c, row: r };
}

function requireCell(name: string, col: unknown, row: unknown): Cell {
  const c = requireInteger(`${name} col`, col);
  const r = requireInteger(`${name} row`, row);
  if (c < 0 || c >= GRID_COLS || r < 0 || r >= GRID_ROWS) {
    fail(`${name} takes a cell of the grid; (${c}, ${r}) is not one`);
  }
  return { col: c, row: r };
}

/** A plain, caller-owned copy of a cell, so no reading shares the state's. */
function copyCell(cell: Cell): Cell {
  return { col: cell.col, row: cell.row };
}

// ---- Building the surface ------------------------------------------------

/**
 * Build the surface over an accessor for the open world. It holds nothing: every
 * operation reads the world — and the state it carries — at the moment it is
 * called, so the surface follows the live game for the life of the engine.
 */
export function createDebugApi(world: () => World): CoilDebugApi {
  const state = (): CoilState => coilState(world());

  const api: CoilDebugApi = {
    version: COIL_DEBUG_VERSION,

    /**
     * Every field the snapshot reports back to its opening value. `muted` is
     * untouched: muting is a player preference the engine owns, and a reset is
     * not a reason to start making noise again.
     */
    reset() {
      resetSession(state());
    },

    /** A pure read of the state. It changes nothing. */
    snapshot() {
      const live = state();
      return {
        version: COIL_DEBUG_VERSION,
        screen: live.screen,
        menuIndex: live.menuIndex,
        titleIndex: live.titleIndex,
        mode: MODE,
        score: live.score,
        best: live.best,
        combo: live.combo,
        comboWindow: live.comboWindow,
        muted: live.muted,
        ticks: live.ticks,
        simTime: live.simTime,
        dir: live.dir,
        turns: [...live.turns],
        snake: live.snake.map(copyCell),
        pellet: live.pellet === null ? null : copyCell(live.pellet),
        obstacles: live.obstacles.map(copyCell),
        steering: live.steering,
        travel: live.travel,
        pelletRespawn: live.pelletRespawn,
        nextPellet: live.nextPellet === null ? null : copyCell(live.nextPellet),
      };
    },

    /**
     * The hit region item `index` occupies on the menu the current screen shows,
     * in logical units. It reports position alone and changes nothing.
     *
     * `null` on `playing`, which shows no menu, and whenever `index` names no
     * item of the current menu: a caller asks where an item is before it knows
     * what the menu holds, so an item that is not there is answered rather than
     * refused.
     */
    menuItemRect(index) {
      const value = requireWhole("menuItemRect(index)", index, 0);
      return menuItemRect(state().screen, value);
    },

    /**
     * Set the screen alone. The highlight stays where it stood and the board
     * keeps whatever the other operations posed on it, so moving to `playing`
     * runs the tick over the board as it stands rather than laying out a fresh
     * round.
     */
    setScreen(screen) {
      if (!SCREENS.includes(screen)) {
        fail(
          `setScreen(screen) takes one of ${SCREENS.join(", ")}; got ${String(screen)}`,
        );
      }
      state().screen = screen;
    },

    /** Set the highlighted item of the current screen's menu. */
    setMenuIndex(index) {
      const live = state();
      const value = requireWhole("setMenuIndex(index)", index, 0);
      // The playing screen carries no menu, so 0 is the only index it holds.
      const limit = Math.max(1, menuItems(live.screen).length);
      if (value >= limit) {
        fail(
          `setMenuIndex(${value}) — the ${live.screen} screen holds no such menu item`,
        );
      }
      live.menuIndex = value;
    },

    /** Set the running score, leaving the best as it stands at the call. */
    setScore(points) {
      state().score = requireWhole("setScore(points)", points, 0);
    },

    /** Set the session's best, leaving the running score as it stands. */
    setBest(points) {
      state().best = requireWhole("setBest(points)", points, 0);
    },

    /** Set the multiplier M, leaving the window as it stands. */
    setCombo(multiplier) {
      const value = requireWhole("setCombo(multiplier)", multiplier, 1);
      if (value > COMBO_MAX) {
        fail(
          `setCombo(multiplier) takes a whole number in [1, ${COMBO_MAX}]; got ${value}`,
        );
      }
      state().combo = value;
    },

    /** Set the seconds left on the combo window, leaving M as it stands. */
    setComboWindow(seconds) {
      if (
        typeof seconds !== "number" ||
        !Number.isFinite(seconds) ||
        seconds < 0 ||
        seconds > COMBO_WINDOW
      ) {
        fail(
          `setComboWindow(seconds) takes a number in [0, ${COMBO_WINDOW}]; got ${String(seconds)}`,
        );
      }
      state().comboWindow = seconds;
    },

    /**
     * Pose the chain, head first. It sets the chain alone: the direction, the
     * turn buffer, the pellet and the score are left as they stand.
     */
    setSnake(cells) {
      const live = state();
      if (!Array.isArray(cells) || cells.length < 1) {
        fail("setSnake(cells) takes a chain of at least one cell");
      }
      const seen = new Set<string>();
      const chain: Cell[] = [];
      for (let i = 0; i < cells.length; i++) {
        const given = cells[i] as Cell | undefined;
        const cell = requireInterior(
          `setSnake(cells)[${i}]`,
          given?.col,
          given?.row,
        );
        if (cellsHold(live.obstacles, cell.col, cell.row)) {
          fail(
            `setSnake(cells)[${i}] — (${cell.col}, ${cell.row}) carries an obstacle`,
          );
        }
        const key = `${cell.col},${cell.row}`;
        if (seen.has(key)) {
          fail(
            `setSnake(cells)[${i}] — (${cell.col}, ${cell.row}) is repeated`,
          );
        }
        seen.add(key);
        const previous = chain[i - 1];
        if (previous && !isAdjacent(previous, cell)) {
          fail(
            `setSnake(cells)[${i}] — (${cell.col}, ${cell.row}) is not adjacent to (${previous.col}, ${previous.row})`,
          );
        }
        chain.push(cell);
      }
      live.snake = chain;
    },

    /** Set the direction the snake travels in, moving it nowhere. */
    setDirection(dir) {
      state().dir = requireDirection("setDirection(dir)", dir);
    },

    /** Empty the buffer of steering requests, turning nothing. */
    clearTurns() {
      state().turns = [];
    },

    /** Turn the snake's steering on or off. */
    setSnakeSteering(enabled) {
      state().steering = requireBoolean("setSnakeSteering(enabled)", enabled);
    },

    /** Turn the snake's travel on or off. */
    setSnakeTravel(enabled) {
      state().travel = requireBoolean("setSnakeTravel(enabled)", enabled);
    },

    /**
     * Place the live pellet, replacing whatever pellet was on the board. Placing
     * a pellet is not spawning one, so a posed next pellet stays posed.
     */
    setPellet(col, row) {
      const live = state();
      const cell = requireInterior("setPellet(col, row)", col, row);
      if (cellsHold(live.snake, cell.col, cell.row)) {
        fail(
          `setPellet(${cell.col}, ${cell.row}) — the cell holds a snake segment`,
        );
      }
      if (cellsHold(live.obstacles, cell.col, cell.row)) {
        fail(
          `setPellet(${cell.col}, ${cell.row}) — the cell carries an obstacle`,
        );
      }
      live.pellet = cell;
    },

    /** Take the pellet off the board, eating nothing and placing nothing. */
    clearPellet() {
      state().pellet = null;
    },

    /** Turn the pellet's respawn on or off. */
    setPelletRespawn(enabled) {
      state().pelletRespawn = requireBoolean(
        "setPelletRespawn(enabled)",
        enabled,
      );
    },

    /**
     * Pose the cell the next spawn places the pellet on. Whether the cell is
     * valid is decided at the spawn rather than here, so the cell may be a wall
     * cell, or hold a snake segment or an obstacle, at the call.
     */
    setNextPellet(col, row) {
      const cell = requireCell("setNextPellet(col, row)", col, row);
      state().nextPellet = cell;
    },

    /**
     * The pellet draw alone: a cell drawn uniformly from the valid set as the
     * board stands, or `null` when that set is empty. A reading, so nothing is
     * placed and a posed next cell is left standing.
     */
    drawPelletCell() {
      return drawPelletCell(state());
    },
  };

  if (HAS_OBSTACLES) {
    /** Take every obstacle cell off the board, leaving the wall border alone. */
    api.clearObstacles = (): void => {
      state().obstacles = [];
    };

    /** Add one obstacle cell, fatal and closed to a pellet from the call onward. */
    api.addObstacle = (col: number, row: number): void => {
      const live = state();
      const cell = requireInterior("addObstacle(col, row)", col, row);
      if (cellsHold(live.snake, cell.col, cell.row)) {
        fail(
          `addObstacle(${cell.col}, ${cell.row}) — the cell holds a snake segment`,
        );
      }
      if (live.pellet && cellsHold([live.pellet], cell.col, cell.row)) {
        fail(
          `addObstacle(${cell.col}, ${cell.row}) — the cell holds the pellet`,
        );
      }
      // A cell that already carries an obstacle is left exactly as it is.
      if (cellsHold(live.obstacles, cell.col, cell.row)) return;
      live.obstacles.push(cell);
    };
  }

  return api;
}

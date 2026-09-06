// Coil — the debugging and automation surface (specs/instrumentation.md).
//
// `createDebugApi()` builds it, `initialize` returns it beside the state it built
// as `[state, createDebugApi()]`, and the engine hands that same object back from
// `engine.debug` — the one way a caller reaches it. It holds no state, reaches
// nothing global, and is inert during normal play: nothing below runs until
// something calls it.
//
// Every operation is written in the shape of `update`. A POSE takes the current
// state and returns the next — `setScore(state, points)` — and a caller drives it
// through `engine.apply((s) => debug.setScore(s, 120))`; a READING takes the state
// and returns what it read — `debug.snapshot(engine.state)`. A pose sets ONE thing
// and leaves the rest of the game as it stands, and the game's own tick, turning,
// collision, pellet placement and scoring run from there exactly as they do in
// play, so a scenario driven from code behaves exactly like one played by hand.
// Nothing here fabricates an outcome.
//
// There is no clock operation and no key operation, because the engine owns both:
// a caller steps the game with `engine.advance` under a clock of its own, and
// dispatches a keyboard event at the engine's own listener. There is no overlay
// operation either, for the same reason.
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
import { resetSession, type CoilState } from "./game";
import { HAS_OBSTACLES } from "./mode";
import { menuItemRect, menuItems, type MenuRect } from "./menus";
import { drawPelletCell } from "./sim";
import type { DeepReadonly } from "ts-essentials";

/** The state every operation is handed: the engine's read-only view of it. */
type View = DeepReadonly<CoilState>;

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
  reset(state: View): CoilState;
  snapshot(state: View): CoilSnapshot;
  menuItemRect(state: View, index: number): MenuRect | null;
  setScreen(state: View, screen: Screen): CoilState;
  setMenuIndex(state: View, index: number): CoilState;
  setScore(state: View, points: number): CoilState;
  setBest(state: View, points: number): CoilState;
  setCombo(state: View, multiplier: number): CoilState;
  setComboWindow(state: View, seconds: number): CoilState;
  setSnake(state: View, cells: readonly Cell[]): CoilState;
  setDirection(state: View, dir: Direction): CoilState;
  clearTurns(state: View): CoilState;
  setSnakeSteering(state: View, enabled: boolean): CoilState;
  setSnakeTravel(state: View, enabled: boolean): CoilState;
  setPellet(state: View, col: number, row: number): CoilState;
  clearPellet(state: View): CoilState;
  setPelletRespawn(state: View, enabled: boolean): CoilState;
  setNextPellet(state: View, col: number, row: number): CoilState;
  drawPelletCell(state: View): Cell | null;
  /** Laid only by a mode that places obstacle cells. */
  clearObstacles?(state: View): CoilState;
  addObstacle?(state: View, col: number, row: number): CoilState;
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
function copyCell(cell: DeepReadonly<Cell>): Cell {
  return { col: cell.col, row: cell.row };
}

// ---- Building the surface ------------------------------------------------

/** Build the surface. It holds nothing: every operation is handed its state. */
export function createDebugApi(): CoilDebugApi {
  const api: CoilDebugApi = {
    version: COIL_DEBUG_VERSION,

    /**
     * Every field the snapshot reports back to its opening value. `muted` is
     * untouched: muting is a player preference the engine owns, and a reset is
     * not a reason to start making noise again.
     */
    reset(state) {
      return resetSession(state);
    },

    /** A pure read of the state. It poses nothing, so it returns no state. */
    snapshot(state) {
      return {
        version: COIL_DEBUG_VERSION,
        screen: state.screen,
        menuIndex: state.menuIndex,
        titleIndex: state.titleIndex,
        mode: MODE,
        score: state.score,
        best: state.best,
        combo: state.combo,
        comboWindow: state.comboWindow,
        muted: state.muted,
        ticks: state.ticks,
        simTime: state.simTime,
        dir: state.dir,
        turns: [...state.turns],
        snake: state.snake.map(copyCell),
        pellet: state.pellet === null ? null : copyCell(state.pellet),
        obstacles: state.obstacles.map(copyCell),
        steering: state.steering,
        travel: state.travel,
        pelletRespawn: state.pelletRespawn,
        nextPellet:
          state.nextPellet === null ? null : copyCell(state.nextPellet),
      };
    },

    /**
     * The hit region item `index` occupies on the menu the current screen shows,
     * in logical units. It reports position alone, so it poses nothing and
     * returns no state.
     *
     * `null` on `playing`, which shows no menu, and whenever `index` names no
     * item of the current menu: a caller asks where an item is before it knows
     * what the menu holds, so an item that is not there is answered rather than
     * refused.
     */
    menuItemRect(state, index) {
      const value = requireWhole("menuItemRect(index)", index, 0);
      return menuItemRect(state.screen, value);
    },

    /**
     * Set the screen alone. The highlight stays where it stood and the board keeps
     * whatever the other operations posed on it, so moving to `playing` runs the
     * tick over the board as it stands rather than laying out a fresh round.
     */
    setScreen(state, screen) {
      if (!SCREENS.includes(screen)) {
        fail(
          `setScreen(screen) takes one of ${SCREENS.join(", ")}; got ${String(screen)}`,
        );
      }
      return { ...state, screen };
    },

    /** Set the highlighted item of the current screen's menu. */
    setMenuIndex(state, index) {
      const value = requireWhole("setMenuIndex(index)", index, 0);
      // The playing screen carries no menu, so 0 is the only index it holds.
      const limit = Math.max(1, menuItems(state.screen).length);
      if (value >= limit) {
        fail(
          `setMenuIndex(${value}) — the ${state.screen} screen holds no such menu item`,
        );
      }
      return { ...state, menuIndex: value };
    },

    /** Set the running score, leaving the best as it stands at the call. */
    setScore(state, points) {
      return { ...state, score: requireWhole("setScore(points)", points, 0) };
    },

    /** Set the session's best, leaving the running score as it stands. */
    setBest(state, points) {
      return { ...state, best: requireWhole("setBest(points)", points, 0) };
    },

    /** Set the multiplier M, leaving the window as it stands. */
    setCombo(state, multiplier) {
      const value = requireWhole("setCombo(multiplier)", multiplier, 1);
      if (value > COMBO_MAX) {
        fail(
          `setCombo(multiplier) takes a whole number in [1, ${COMBO_MAX}]; got ${value}`,
        );
      }
      return { ...state, combo: value };
    },

    /** Set the seconds left on the combo window, leaving M as it stands. */
    setComboWindow(state, seconds) {
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
      return { ...state, comboWindow: seconds };
    },

    /**
     * Pose the chain, head first. It sets the chain alone: the direction, the turn
     * buffer, the pellet and the score are left as they stand.
     */
    setSnake(state, cells) {
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
        if (cellsHold(state.obstacles, cell.col, cell.row)) {
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
      return { ...state, snake: chain };
    },

    /** Set the direction the snake travels in, moving it nowhere. */
    setDirection(state, dir) {
      return { ...state, dir: requireDirection("setDirection(dir)", dir) };
    },

    /** Empty the buffer of steering requests, turning nothing. */
    clearTurns(state) {
      return { ...state, turns: [] };
    },

    /** Turn the snake's steering on or off. */
    setSnakeSteering(state, enabled) {
      return {
        ...state,
        steering: requireBoolean("setSnakeSteering(enabled)", enabled),
      };
    },

    /** Turn the snake's travel on or off. */
    setSnakeTravel(state, enabled) {
      return {
        ...state,
        travel: requireBoolean("setSnakeTravel(enabled)", enabled),
      };
    },

    /**
     * Place the live pellet, replacing whatever pellet was on the board. Placing a
     * pellet is not spawning one, so a posed next pellet stays posed.
     */
    setPellet(state, col, row) {
      const cell = requireInterior("setPellet(col, row)", col, row);
      if (cellsHold(state.snake, cell.col, cell.row)) {
        fail(
          `setPellet(${cell.col}, ${cell.row}) — the cell holds a snake segment`,
        );
      }
      if (cellsHold(state.obstacles, cell.col, cell.row)) {
        fail(
          `setPellet(${cell.col}, ${cell.row}) — the cell carries an obstacle`,
        );
      }
      return { ...state, pellet: cell };
    },

    /** Take the pellet off the board, eating nothing and placing nothing. */
    clearPellet(state) {
      return { ...state, pellet: null };
    },

    /** Turn the pellet's respawn on or off. */
    setPelletRespawn(state, enabled) {
      return {
        ...state,
        pelletRespawn: requireBoolean("setPelletRespawn(enabled)", enabled),
      };
    },

    /**
     * Pose the cell the next spawn places the pellet on. Whether the cell is
     * valid is decided at the spawn rather than here, so the cell may be a wall
     * cell, or hold a snake segment or an obstacle, at the call.
     */
    setNextPellet(state, col, row) {
      const cell = requireCell("setNextPellet(col, row)", col, row);
      return { ...state, nextPellet: cell };
    },

    /**
     * The pellet draw alone: a cell drawn uniformly from the valid set as the
     * board stands, or `null` when that set is empty. A reading, so it returns
     * no state: nothing is placed and a posed next cell is left standing.
     */
    drawPelletCell(state) {
      return drawPelletCell(state);
    },
  };

  if (HAS_OBSTACLES) {
    /** Take every obstacle cell off the board, leaving the wall border alone. */
    api.clearObstacles = (state: View): CoilState => ({
      ...state,
      obstacles: [],
    });

    /** Add one obstacle cell, fatal and closed to a pellet from the call onward. */
    api.addObstacle = (state: View, col: number, row: number): CoilState => {
      const cell = requireInterior("addObstacle(col, row)", col, row);
      if (cellsHold(state.snake, cell.col, cell.row)) {
        fail(
          `addObstacle(${cell.col}, ${cell.row}) — the cell holds a snake segment`,
        );
      }
      if (state.pellet && cellsHold([state.pellet], cell.col, cell.row)) {
        fail(
          `addObstacle(${cell.col}, ${cell.row}) — the cell holds the pellet`,
        );
      }
      // A cell that already carries an obstacle is left exactly as it is.
      if (cellsHold(state.obstacles, cell.col, cell.row)) {
        return { ...state };
      }
      return { ...state, obstacles: [...state.obstacles, cell] };
    };
  }

  return api;
}

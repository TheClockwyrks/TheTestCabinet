// Coil — the debugging and automation surface, `window.__coil`
// (specs/instrumentation.md).
//
// Every operation is a read of the game's state or a pose of one part of it. A pose
// sets ONE thing and leaves the rest of the game as it stands, and the game's own
// tick, turning, collision, pellet placement and scoring run from there exactly as
// they do in play, so a scenario driven from code behaves exactly like one played
// by hand. Nothing here fabricates an outcome.
//
// The clock is the exception, because this build stands on no engine and nothing
// outside it owns its clock. `setAutoStep` and `advance` reach past the state into
// the runtime. Everything else about driving a browser game stays absent: there is
// no key operation, because the runtime's own listener is driven by dispatching a
// real keyboard event at the page, and no overlay operation, because the runtime
// draws the panel and owns the backtick key.
//
// An argument outside the domain its operation states is invalid, and the call
// fails loudly rather than guessing what was meant.

import {
  COIL_DEBUG_VERSION,
  COMBO_MAX,
  COMBO_WINDOW,
  GRID_COLS,
  GRID_ROWS,
  cellKey,
  isInterior,
  type Cell,
  type Dir,
} from "./constants";
import { SCREENS, type Game, type Screen } from "./game";
import { menuItemRect, menuItems, type MenuRect } from "./menus";
import { HAS_OBSTACLES, MODE, type Mode } from "./mode";
import { isAdjacent } from "./sim";

/** The `window` property the surface is installed on. */
export const COIL_HANDLE = "__coil";

/** The plain, JSON-serializable read `snapshot()` returns. */
export interface CoilSnapshot {
  version: number;
  screen: Screen;
  menuIndex: number;
  titleIndex: number;
  mode: Mode;
  score: number;
  best: number;
  combo: number;
  comboWindow: number;
  muted: boolean;
  autoStep: boolean;
  ticks: number;
  simTime: number;
  dir: Dir;
  turns: Dir[];
  snake: Cell[];
  pellet: Cell | null;
  obstacles: Cell[];
  steering: boolean;
  travel: boolean;
  pelletRespawn: boolean;
  nextPellet: Cell | null;
}

/**
 * The runtime's clock, as the surface reaches it.
 *
 * Structural on purpose: `src/runtime.ts` satisfies it without knowing this file
 * exists, and a test can hand the surface a clock of its own.
 */
export interface DebugClock {
  autoStep: boolean;
  advance(seconds: number, frames: number): void;
}

export interface CoilDebugApi {
  version: number;
  setAutoStep(enabled: boolean): void;
  advance(seconds: number, frames?: number): void;
  reset(): void;
  /** Bring every reported reading into agreement with the game as it stands. */
  reconcile(): void;
  snapshot(): CoilSnapshot;
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
  setNextPellet(col: number, row: number): void;
  drawPelletCell(): Cell | null;
  /** Laid only by a mode that places obstacle cells. */
  clearObstacles?(): void;
  addObstacle?(col: number, row: number): void;
}

const DIRECTIONS: readonly Dir[] = ["up", "down", "left", "right"];

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

function requireDir(name: string, value: unknown): Dir {
  if (!DIRECTIONS.includes(value as Dir)) {
    fail(`${name} takes one of ${DIRECTIONS.join(", ")}; got ${String(value)}`);
  }
  return value as Dir;
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

/** Build the surface over one live game and the runtime driving it. */
export function createDebugApi(game: Game, clock: DebugClock): CoilDebugApi {
  const sim = game.sim;

  const obstacleAt = (col: number, row: number): boolean =>
    sim.obstacles.some((cell) => cell.col === col && cell.row === row);

  const snakeAt = (col: number, row: number): boolean =>
    sim.snake.some((cell) => cell.col === col && cell.row === row);

  const api: CoilDebugApi = {
    version: COIL_DEBUG_VERSION,

    /**
     * Take the game off real time, and give it back. It changes no game state, and
     * drawing and input are unaffected either way.
     */
    setAutoStep(enabled) {
      clock.autoStep = requireBoolean("setAutoStep(enabled)", enabled);
    },

    /**
     * Run `frames` whole frames covering `seconds` of game time, each worth
     * `seconds / frames`, immediately and in order. Each is a real frame, so the
     * tick resolves exactly as the loop resolves it and the canvas reflects it.
     */
    advance(seconds, frames = 1) {
      if (
        typeof seconds !== "number" ||
        !Number.isFinite(seconds) ||
        seconds < 0
      ) {
        fail(
          `advance(seconds) takes a number of at least 0; got ${String(seconds)}`,
        );
      }
      clock.advance(seconds, requireWhole("advance(frames)", frames, 1));
    },

    /**
     * Restore every field the snapshot reports to its opening value. `muted` is
     * untouched: muting is a player preference rather than a value a round opens
     * with. A reset also re-arms manual stepping.
     */
    reset() {
      game.reset();
      clock.autoStep = false;
    },

    /**
     * Bring every reported reading into agreement with the game as it stands,
     * advancing nothing.
     *
     * Coil reports its board, its switches and its figures straight off the
     * state, so the only reading here that follows from something else is
     * `muted` — the game's copy of the runtime's mute bit — and the hit regions
     * `menuItemRect` answers, which are worked out from the current screen at
     * the read and so have nothing to bring into agreement.
     *
     * `Game.reconcile` is the same call the update ends with, so the copy is
     * rewritten by exactly the code that owns it rather than by a restatement of
     * the rule. Nothing else moves: no tick resolves, no accumulator advances,
     * no cue plays, and the generator is not drawn from.
     */
    reconcile() {
      game.reconcile();
    },

    /** A pure read of the state. It changes nothing. */
    snapshot() {
      return {
        version: COIL_DEBUG_VERSION,
        screen: game.screen,
        menuIndex: game.menuIndex,
        titleIndex: game.titleIndex,
        mode: MODE,
        score: sim.score,
        best: game.best,
        combo: sim.combo,
        comboWindow: sim.comboWindow,
        muted: game.muted,
        autoStep: clock.autoStep,
        ticks: game.ticks,
        simTime: game.simTime,
        dir: sim.dir,
        turns: [...sim.turns],
        snake: sim.snake.map((cell) => ({ col: cell.col, row: cell.row })),
        pellet: sim.pellet
          ? { col: sim.pellet.col, row: sim.pellet.row }
          : null,
        obstacles: sim.obstacles.map((cell) => ({
          col: cell.col,
          row: cell.row,
        })),
        steering: sim.steering,
        travel: sim.travel,
        pelletRespawn: sim.pelletRespawn,
        nextPellet: sim.nextPellet
          ? { col: sim.nextPellet.col, row: sim.nextPellet.row }
          : null,
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
      return menuItemRect(game.screen, value);
    },

    /**
     * Set the screen alone. The highlight stays where it stood and the board keeps
     * whatever the other operations posed on it, so moving to `playing` runs the
     * tick over the board as it stands rather than laying out a fresh round.
     */
    setScreen(screen) {
      if (!SCREENS.includes(screen)) {
        fail(
          `setScreen(screen) takes one of ${SCREENS.join(", ")}; got ${String(screen)}`,
        );
      }
      game.setScreen(screen);
    },

    /** Set the highlighted item of the current screen's menu. */
    setMenuIndex(index) {
      const value = requireWhole("setMenuIndex(index)", index, 0);
      // The playing screen carries no menu, so 0 is the only index it holds.
      const limit = Math.max(1, menuItems(game.screen).length);
      if (value >= limit) {
        fail(
          `setMenuIndex(${value}) — the ${game.screen} screen holds no such menu item`,
        );
      }
      game.menuIndex = value;
    },

    /** Set the running score, leaving the best as it stands at the call. */
    setScore(points) {
      sim.score = requireWhole("setScore(points)", points, 0);
    },

    /** Set the session's best, leaving the running score as it stands. */
    setBest(points) {
      game.best = requireWhole("setBest(points)", points, 0);
    },

    /** Set the multiplier M, leaving the window as it stands. */
    setCombo(multiplier) {
      const value = requireWhole("setCombo(multiplier)", multiplier, 1);
      if (value > COMBO_MAX) {
        fail(
          `setCombo(multiplier) takes a whole number in [1, ${COMBO_MAX}]; got ${value}`,
        );
      }
      sim.combo = value;
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
      sim.comboWindow = seconds;
    },

    /**
     * Pose the chain, head first. It sets the chain alone: the direction, the turn
     * buffer, the pellet and the score are left as they stand.
     */
    setSnake(cells) {
      if (!Array.isArray(cells) || cells.length < 1) {
        fail("setSnake(cells) takes a chain of at least one cell");
      }
      const seen = new Set<number>();
      const chain: Cell[] = [];
      for (let i = 0; i < cells.length; i++) {
        const cell = requireInterior(
          `setSnake(cells)[${i}]`,
          (cells[i] as Cell | undefined)?.col,
          (cells[i] as Cell | undefined)?.row,
        );
        if (obstacleAt(cell.col, cell.row)) {
          fail(
            `setSnake(cells)[${i}] — (${cell.col}, ${cell.row}) carries an obstacle`,
          );
        }
        const key = cellKey(cell.col, cell.row);
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
      sim.setSnake(chain);
    },

    /** Set the direction the snake travels in, moving it nowhere. */
    setDirection(dir) {
      sim.dir = requireDir("setDirection(dir)", dir);
    },

    /** Empty the buffer of steering requests, turning nothing. */
    clearTurns() {
      sim.turns.length = 0;
    },

    /** Turn the snake's steering on or off. */
    setSnakeSteering(enabled) {
      sim.steering = requireBoolean("setSnakeSteering(enabled)", enabled);
    },

    /** Turn the snake's travel on or off. */
    setSnakeTravel(enabled) {
      sim.travel = requireBoolean("setSnakeTravel(enabled)", enabled);
    },

    /**
     * Place the live pellet, replacing whatever pellet was on the board. Placing a
     * pellet is not spawning one, so a posed next pellet stays posed.
     */
    setPellet(col, row) {
      const cell = requireInterior("setPellet(col, row)", col, row);
      if (snakeAt(cell.col, cell.row)) {
        fail(
          `setPellet(${cell.col}, ${cell.row}) — the cell holds a snake segment`,
        );
      }
      if (obstacleAt(cell.col, cell.row)) {
        fail(
          `setPellet(${cell.col}, ${cell.row}) — the cell carries an obstacle`,
        );
      }
      sim.setPellet(cell.col, cell.row);
    },

    /** Take the pellet off the board, eating nothing and placing nothing. */
    clearPellet() {
      sim.clearPellet();
    },

    /** Turn the pellet's respawn on or off. */
    setPelletRespawn(enabled) {
      sim.pelletRespawn = requireBoolean("setPelletRespawn(enabled)", enabled);
    },

    /**
     * Pose the cell the next spawn places the pellet on. Whether the cell is
     * valid is decided at the spawn rather than here, so the cell may be a wall
     * cell, or hold a snake segment or an obstacle, at the call.
     */
    setNextPellet(col, row) {
      const cell = requireCell("setNextPellet(col, row)", col, row);
      sim.setNextPellet(cell.col, cell.row);
    },

    /**
     * The pellet draw alone: a cell drawn uniformly from the valid set as the
     * board stands, or `null` when that set is empty. It places nothing, and a
     * posed next cell is left standing.
     */
    drawPelletCell() {
      return sim.drawPelletCell();
    },
  };

  if (HAS_OBSTACLES) {
    /** Take every obstacle cell off the board, leaving the wall border alone. */
    api.clearObstacles = (): void => {
      sim.clearObstacles();
    };

    /** Add one obstacle cell, fatal and closed to a pellet from the call onward. */
    api.addObstacle = (col: number, row: number): void => {
      const cell = requireInterior("addObstacle(col, row)", col, row);
      if (snakeAt(cell.col, cell.row)) {
        fail(
          `addObstacle(${cell.col}, ${cell.row}) — the cell holds a snake segment`,
        );
      }
      if (
        sim.pellet &&
        sim.pellet.col === cell.col &&
        sim.pellet.row === cell.row
      ) {
        fail(
          `addObstacle(${cell.col}, ${cell.row}) — the cell holds the pellet`,
        );
      }
      sim.addObstacle(cell.col, cell.row);
    };
  }

  return api;
}

/** Install the surface on `window.__coil`, as soon as the game has initialized. */
export function installDebugApi(game: Game, clock: DebugClock): CoilDebugApi {
  const api = createDebugApi(game, clock);
  (window as unknown as Record<string, unknown>)[COIL_HANDLE] = api;
  return api;
}

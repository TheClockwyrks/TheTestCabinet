// Coil — the round, one whole tick at a time (specs/movement.md, specs/board.md,
// specs/scoring.md).
//
// The framework's game states are LIVE objects, so everything here WRITES THE
// STATE IT IS GIVEN: `tick` advances `world.state` in place and returns only what
// that tick raised, for the cues and the bite to read. Nothing here reads the
// clock, the canvas or the page, and the whole model works in the integer cell
// coordinates `src/board.ts` addresses, so an interval of game time reaches the
// same state however it was divided into frames.
//
// The six steps of `tick` are exactly the ones `specs/movement.md` fixes, and the
// three driver switches `specs/instrumentation.md` fixes gate them: `steering`
// gates step 1, `travel` gates steps 2 to 5, and `pelletRespawn` gates the
// placement inside step 5. Step 6 runs whatever the switches say.

import { cellsHold, isWall, validPelletCells } from "./board";
import {
  BITE_SECONDS,
  COMBO_MAX,
  COMBO_WINDOW,
  PELLET_POINTS,
  START_CELLS,
  START_DIR,
  TICK_SECONDS,
  TURN_QUEUE_MAX,
  type Cell,
  type Direction,
} from "./constants";
import { drawBelow } from "./rng";
import type { CoilState } from "./game";

/** How a round ended, or `null` while it is still running. */
export type EndReason = "dead" | "cleared";

/** What one tick resolved, for the cues and the bite animation to read. */
export interface TickEvents {
  readonly ate: boolean;
  readonly comboRose: boolean;
  readonly died: boolean;
}

/** What `tick` leaves behind: what it raised, and any ending. */
export interface TickResult {
  readonly events: TickEvents;
  readonly ended: EndReason | null;
}

const DELTA: Readonly<Record<Direction, Cell>> = {
  up: { col: 0, row: -1 },
  down: { col: 0, row: 1 },
  left: { col: -1, row: 0 },
  right: { col: 1, row: 0 },
};

const AXIS: Readonly<Record<Direction, "horizontal" | "vertical">> = {
  up: "vertical",
  down: "vertical",
  left: "horizontal",
  right: "horizontal",
};

/** Whether a turn to `request` is perpendicular to travelling in `dir`. */
export function isPerpendicular(request: Direction, dir: Direction): boolean {
  return AXIS[request] !== AXIS[dir];
}

/** The axis a direction runs along, which is what a bend is read from. */
export function axisOf(dir: Direction): "horizontal" | "vertical" {
  return AXIS[dir];
}

/** The cell one step from `(col, row)` in `dir`. */
export function step(cell: Cell, dir: Direction): Cell {
  return { col: cell.col + DELTA[dir].col, row: cell.row + DELTA[dir].row };
}

/**
 * Lay the opening chain, heading, buffer, score and combo of a round.
 *
 * It lays no pellet: `startRound` places the first one after the chain is laid, so
 * it never lands under a starting cell (specs/board.md).
 */
export function layChain(state: CoilState): void {
  state.snake = START_CELLS.map((cell) => ({ col: cell.col, row: cell.row }));
  state.dir = START_DIR;
  state.turns = [];
  state.score = 0;
  state.combo = 1;
  state.comboWindow = 0;
}

/**
 * Take a steering request onto the buffer.
 *
 * Whether it turns the snake is decided at step 1 of the next tick rather than
 * here, so a request that repeats or reverses the direction still occupies the
 * buffer until that tick discards it. A request arriving at a full buffer, or
 * while steering is held off, is discarded outright.
 */
export function requestTurn(state: CoilState, dir: Direction): void {
  if (!state.steering) return;
  if (state.turns.length >= TURN_QUEUE_MAX) return;
  state.turns.push(dir);
}

/**
 * Whether a head entering `(col, row)` on this tick ends the round.
 *
 * `willEat` decides the tail's cell alone: the tail vacates it unless the tick
 * eats, in which case it stays and the whole chain is solid (specs/movement.md,
 * "The tail rule"). Every other body cell is solid on every tick.
 */
export function fatal(
  state: CoilState,
  col: number,
  row: number,
  willEat: boolean,
): boolean {
  if (isWall(col, row)) return true;
  if (cellsHold(state.obstacles, col, row)) return true;
  const solid = willEat ? state.snake.length : state.snake.length - 1;
  for (let i = 0; i < solid; i++) {
    const segment = state.snake[i]!;
    if (segment.col === col && segment.row === row) return true;
  }
  return false;
}

/** One cell drawn uniformly from `free`, or `null` when there is none to draw. */
function drawFrom(free: readonly Cell[]): Cell | null {
  if (free.length === 0) return null;
  const cell = free[drawBelow(free.length)]!;
  return { col: cell.col, row: cell.row };
}

/**
 * The pellet draw alone: a cell drawn uniformly from the valid set as the board
 * stands, or `null` when that set is empty. It is what a spawn draws when no
 * valid pose stands, performed on its own for the surface's `drawPelletCell`, so
 * it writes nothing: a posed next cell is left standing.
 */
export function drawPelletCell(state: CoilState): Cell | null {
  return drawFrom(validPelletCells(state.snake, state.pellet, state.obstacles));
}

/**
 * Place the next pellet on the posed cell if one stands and is valid, and
 * otherwise on a cell drawn uniformly from the valid set.
 *
 * The spawn consumes the pose either way, so a posed cell the board no longer
 * allows is discarded rather than kept for a later spawn, and so is a pose
 * standing when the valid set is empty. Returns `false` in that case, which is
 * the board-cleared win; the board is left without a pellet.
 */
export function spawnPellet(state: CoilState): boolean {
  const posed = state.nextPellet;
  state.nextPellet = null;
  const free = validPelletCells(state.snake, state.pellet, state.obstacles);
  state.pellet =
    posed !== null && cellsHold(free, posed.col, posed.row)
      ? { col: posed.col, row: posed.row }
      : drawFrom(free);
  return state.pellet !== null;
}

/** Resolve one whole tick, in the six steps `specs/movement.md` fixes. */
export function tick(state: CoilState): TickResult {
  let ate = false;
  let comboRose = false;
  let ended: EndReason | null = null;

  // 1 — take the oldest buffered turn and apply it if it is perpendicular.
  if (state.steering && state.turns.length > 0) {
    const request = state.turns.shift()!;
    if (isPerpendicular(request, state.dir)) state.dir = request;
  }

  if (state.travel) {
    // 2 — the new head cell.
    const head = state.snake[0]!;
    const ahead = step(head, state.dir);
    const willEat =
      state.pellet !== null &&
      ahead.col === state.pellet.col &&
      ahead.row === state.pellet.row;

    // 3 — a fatal cell ends the round, and steps 4 to 6 do not run.
    if (fatal(state, ahead.col, ahead.row, willEat)) {
      state.ticks += 1;
      return {
        events: { ate: false, comboRose: false, died: true },
        ended: "dead",
      };
    }

    // 4 — prepend the head, and keep the tail only on the tick that eats.
    state.snake.unshift(ahead);
    if (!willEat) state.snake.pop();

    // 5 — the score, the combo, and the next pellet.
    if (willEat) {
      ate = true;
      const raised =
        state.comboWindow > 0 ? Math.min(COMBO_MAX, state.combo + 1) : 1;
      comboRose = raised > state.combo;
      state.combo = raised;
      state.score += PELLET_POINTS * raised;
      state.comboWindow = COMBO_WINDOW;
      state.biteRemaining = BITE_SECONDS;
      if (state.pelletRespawn) {
        if (!spawnPellet(state)) ended = "cleared";
      } else {
        state.pellet = null;
      }
    }
  }

  // 6 — drain the combo window, and lapse it at zero.
  if (state.comboWindow > 0) {
    const left = state.comboWindow - TICK_SECONDS;
    if (left > 0) {
      state.comboWindow = left;
    } else {
      state.comboWindow = 0;
      state.combo = 1;
    }
  }

  state.ticks += 1;
  return { events: { ate, comboRose, died: false }, ended };
}

/** The combo window as a fraction of a full one, for the draining HUD bar. */
export function comboFraction(state: { readonly comboWindow: number }): number {
  return Math.max(0, Math.min(1, state.comboWindow / COMBO_WINDOW));
}

/** The head's sprite frame: 0 at rest, and 1 to 3 through the bite an eat began. */
export function biteFrame(state: { readonly biteRemaining: number }): number {
  // The remainder is compared against a tolerance rather than zero, because a
  // caller that delivers BITE_SECONDS in sixty frames leaves a float dust behind
  // that a caller delivering it in one does not, and the two must agree.
  if (state.biteRemaining <= 1e-6) return 0;
  const spent = BITE_SECONDS - state.biteRemaining;
  return 1 + Math.min(2, Math.floor((spent / BITE_SECONDS) * 3));
}

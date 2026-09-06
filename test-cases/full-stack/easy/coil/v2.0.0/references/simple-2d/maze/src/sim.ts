// Coil — the round, one whole tick at a time (specs/movement.md, specs/board.md,
// specs/scoring.md).
//
// Everything here is a TRANSITION over `CoilState`: current state in, next state
// out, built by spreading what it keeps around what it changes. Nothing is written
// into a state it was handed, nothing reads the clock, the canvas or the page, and
// the whole model works in the integer cell coordinates `src/board.ts` addresses,
// so an interval of game time reaches the same state however it was divided into
// updates.
//
// The six steps of `tick` are exactly the ones `specs/movement.md` fixes, and the
// three driver switches `specs/instrumentation.md` fixes gate them: `steering`
// gates step 1, `travel` gates steps 2 to 5, and `pelletRespawn` gates the
// placement inside step 5. Step 6 runs whatever the switches say.

import { cellsHold, isWall, validPelletCells } from "./board";
import {
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

/** A tick that resolved nothing worth hearing. */
export const NO_TICK_EVENTS: TickEvents = {
  ate: false,
  comboRose: false,
  died: false,
};

/** What `tick` leaves behind: the next state, what it raised, and any ending. */
export interface TickResult {
  readonly state: CoilState;
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
 * The opening chain, heading, buffer, score and combo of a round.
 *
 * It lays no pellet: `startRound` places the first one after the chain is laid, so
 * it never lands under a starting cell (specs/board.md).
 */
export function layChain(state: CoilState): CoilState {
  return {
    ...state,
    snake: START_CELLS.map((cell) => ({ col: cell.col, row: cell.row })),
    dir: START_DIR,
    turns: [],
    score: 0,
    combo: 1,
    comboWindow: 0,
  };
}

/**
 * Take a steering request onto the buffer.
 *
 * Whether it turns the snake is decided at step 1 of the next tick rather than
 * here, so a request that repeats or reverses the direction still occupies the
 * buffer until that tick discards it. A request arriving at a full buffer, or
 * while steering is held off, is discarded outright.
 */
export function requestTurn(state: CoilState, dir: Direction): CoilState {
  if (!state.steering) return state;
  if (state.turns.length >= TURN_QUEUE_MAX) return state;
  return { ...state, turns: [...state.turns, dir] };
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

/**
 * Place the next pellet on the posed cell if one stands and is valid, and
 * otherwise on a cell drawn uniformly from the valid set.
 *
 * The spawn consumes the pose either way, so a posed cell the board no longer
 * allows is discarded rather than kept for a later spawn. `placed` is `false`
 * when the valid set is empty, which is the board-cleared win; the board is left
 * without a pellet in that case.
 */
export function spawnPellet(state: CoilState): {
  readonly state: CoilState;
  readonly placed: boolean;
} {
  const free = validPelletCells(state.snake, state.pellet, state.obstacles);
  if (free.length === 0) {
    return {
      state: { ...state, pellet: null, nextPellet: null },
      placed: false,
    };
  }
  const posed = state.nextPellet;
  const pellet =
    posed !== null && cellsHold(free, posed.col, posed.row)
      ? { col: posed.col, row: posed.row }
      : free[drawBelow(free.length)]!;
  return { state: { ...state, pellet, nextPellet: null }, placed: true };
}

/** Resolve one whole tick, in the six steps `specs/movement.md` fixes. */
export function tick(state: CoilState): TickResult {
  let next = state;
  let ate = false;
  let comboRose = false;
  let ended: EndReason | null = null;

  // 1 — take the oldest buffered turn and apply it if it is perpendicular.
  if (next.steering && next.turns.length > 0) {
    const [request, ...rest] = next.turns;
    next = {
      ...next,
      turns: rest,
      dir: isPerpendicular(request, next.dir) ? request : next.dir,
    };
  }

  if (next.travel) {
    // 2 — the new head cell.
    const head = next.snake[0]!;
    const ahead = step(head, next.dir);
    const willEat =
      next.pellet !== null &&
      ahead.col === next.pellet.col &&
      ahead.row === next.pellet.row;

    // 3 — a fatal cell ends the round, and steps 4 to 6 do not run.
    if (fatal(next, ahead.col, ahead.row, willEat)) {
      return {
        state: { ...next, ticks: next.ticks + 1 },
        events: { ate: false, comboRose: false, died: true },
        ended: "dead",
      };
    }

    // 4 — prepend the head, and keep the tail only on the tick that eats.
    const chain = [ahead, ...next.snake];
    if (!willEat) chain.pop();
    next = { ...next, snake: chain };

    // 5 — the score, the combo, and the next pellet.
    if (willEat) {
      ate = true;
      const raised =
        next.comboWindow > 0 ? Math.min(COMBO_MAX, next.combo + 1) : 1;
      comboRose = raised > next.combo;
      next = {
        ...next,
        combo: raised,
        score: next.score + PELLET_POINTS * raised,
        comboWindow: COMBO_WINDOW,
      };
      if (next.pelletRespawn) {
        const spawned = spawnPellet(next);
        next = spawned.state;
        if (!spawned.placed) ended = "cleared";
      } else {
        next = { ...next, pellet: null };
      }
    }
  }

  // 6 — drain the combo window, and lapse it at zero.
  if (next.comboWindow > 0) {
    const left = next.comboWindow - TICK_SECONDS;
    next =
      left > 0
        ? { ...next, comboWindow: left }
        : { ...next, comboWindow: 0, combo: 1 };
  }

  return {
    state: { ...next, ticks: next.ticks + 1 },
    events: { ate, comboRose, died: false },
    ended,
  };
}

/** The combo window as a fraction of a full one, for the draining HUD bar. */
export function comboFraction(state: { readonly comboWindow: number }): number {
  return Math.max(0, Math.min(1, state.comboWindow / COMBO_WINDOW));
}

// Coil — the round simulation (specs/movement.md, specs/board.md, specs/scoring.md).
//
// A headless model of one round: the chain, the single pellet, the obstacle course,
// the combo and the score, advanced one whole tick at a time. It works entirely in
// integer cell coordinates and reads nothing from the renderer, the wall clock or
// the page, so an interval of game time reaches the same state however it was
// divided into updates.
//
// The six steps of `tick()` are exactly the ones `specs/movement.md` fixes, and the
// three driver switches `specs/instrumentation.md` fixes gate them: `steering` gates
// step 1, `travel` gates steps 2 to 5, and `pelletRespawn` gates the placement
// inside step 5. Step 6 runs whatever the switches say.

import {
  COMBO_MAX,
  COMBO_WINDOW,
  INTERIOR_COL_MAX,
  INTERIOR_COL_MIN,
  INTERIOR_ROW_MAX,
  INTERIOR_ROW_MIN,
  PELLET_POINTS,
  START_CELLS,
  START_DIR,
  TICK_SECONDS,
  TURN_QUEUE_MAX,
  cellKey,
  isWall,
  type Cell,
  type Dir,
} from "./constants";
import { OBSTACLE_CELLS } from "./mode";
import { Rng } from "./rng";

/** How a round ended, or `null` while it is still running. */
export type EndReason = "dead" | "cleared";

/** What one tick resolved, for the cues and the bite animation to read. */
export interface TickEvents {
  ate: boolean;
  comboRose: boolean;
  died: boolean;
}

const DELTA: Record<Dir, { col: number; row: number }> = {
  up: { col: 0, row: -1 },
  down: { col: 0, row: 1 },
  left: { col: -1, row: 0 },
  right: { col: 1, row: 0 },
};

const AXIS: Record<Dir, "horizontal" | "vertical"> = {
  up: "vertical",
  down: "vertical",
  left: "horizontal",
  right: "horizontal",
};

/** Whether a turn to `request` is perpendicular to travelling in `dir`. */
export function isPerpendicular(request: Dir, dir: Dir): boolean {
  return AXIS[request] !== AXIS[dir];
}

/** Whether two cells are orthogonally adjacent. */
export function isAdjacent(a: Cell, b: Cell): boolean {
  return Math.abs(a.col - b.col) + Math.abs(a.row - b.row) === 1;
}

export class Sim {
  /** The chain, head at index 0 and tail at the last index. */
  snake: Cell[] = [];
  /** The direction the head advances in on the next tick. */
  dir: Dir = START_DIR;
  /** The steering requests waiting on the buffer, oldest first. */
  turns: Dir[] = [];
  /** The live pellet, or `null` while no pellet is on the board. */
  pellet: Cell | null = null;
  /** The running score of the current round. */
  score = 0;
  /** The combo multiplier M. */
  combo = 1;
  /** Seconds of simulation time left on the combo window; 0 is closed. */
  comboWindow = 0;
  /** Whether the round has ended, and how. */
  ended = false;
  endReason: EndReason | null = null;

  /** Step 1 of the tick, and whether a steering request is taken at all. */
  steering = true;
  /** Steps 2 to 5 of the tick. */
  travel = true;
  /** The placement inside step 5. */
  pelletRespawn = true;

  private obstacleCells: Cell[] = [];
  private obstacleSet = new Set<number>();
  private rng: Rng;

  constructor(seed: number) {
    this.rng = new Rng(seed);
    this.restore(seed);
  }

  /** The obstacle cells currently on the board. */
  get obstacles(): readonly Cell[] {
    return this.obstacleCells;
  }

  /**
   * Every field back to its opening value, the course back to the mode's, the
   * three switches back on, and the generator reseeded. No pellet is placed: a
   * round lays the first one, and `reset()` leaves the game on the title screen.
   */
  restore(seed: number): void {
    this.rng = new Rng(seed);
    this.setObstacles(OBSTACLE_CELLS);
    this.steering = true;
    this.travel = true;
    this.pelletRespawn = true;
    this.layChain();
    this.pellet = null;
  }

  /** A fresh round on the board as the mode lays it, with its first pellet. */
  layRound(): void {
    this.layChain();
    // Placed after the chain is laid, so it never lands under a starting cell.
    this.spawnPellet();
  }

  /** The opening chain, heading, buffer, score and combo of a round. */
  private layChain(): void {
    this.snake = START_CELLS.map((cell) => ({ ...cell }));
    this.dir = START_DIR;
    this.turns = [];
    this.score = 0;
    this.combo = 1;
    this.comboWindow = 0;
    this.ended = false;
    this.endReason = null;
  }

  /**
   * Take a steering request onto the buffer. Whether it turns the snake is decided
   * at step 1 of the next tick rather than here, so a request that repeats or
   * reverses the direction still occupies the buffer until that tick discards it.
   */
  requestTurn(dir: Dir): void {
    if (!this.steering) return;
    if (this.ended) return;
    if (this.turns.length >= TURN_QUEUE_MAX) return;
    this.turns.push(dir);
  }

  /** Whether a head entering `(col, row)` this tick ends the round. */
  fatal(col: number, row: number, willEat: boolean): boolean {
    if (isWall(col, row)) return true;
    if (this.obstacleSet.has(cellKey(col, row))) return true;
    // The tail vacates its cell unless the tick eats, in which case it stays and
    // the whole chain is solid (specs/movement.md, "The tail rule").
    const solid = willEat ? this.snake.length : this.snake.length - 1;
    for (let i = 0; i < solid; i++) {
      const segment = this.snake[i]!;
      if (segment.col === col && segment.row === row) return true;
    }
    return false;
  }

  /** Resolve one whole tick, in the six steps `specs/movement.md` fixes. */
  tick(): TickEvents {
    const events: TickEvents = { ate: false, comboRose: false, died: false };
    if (this.ended) return events;

    // 1 — take the oldest buffered turn and apply it if it is perpendicular.
    if (this.steering && this.turns.length > 0) {
      const request = this.turns.shift()!;
      if (isPerpendicular(request, this.dir)) this.dir = request;
    }

    if (this.travel) {
      // 2 — the new head cell.
      const head = this.snake[0]!;
      const delta = DELTA[this.dir];
      const col = head.col + delta.col;
      const row = head.row + delta.row;
      const willEat =
        this.pellet !== null &&
        col === this.pellet.col &&
        row === this.pellet.row;

      // 3 — a fatal cell ends the round, and steps 4 to 6 do not run.
      if (this.fatal(col, row, willEat)) {
        this.ended = true;
        this.endReason = "dead";
        events.died = true;
        return events;
      }

      // 4 — prepend the head, and keep the tail only on the tick that eats.
      this.snake.unshift({ col, row });
      if (!willEat) this.snake.pop();

      // 5 — the score, the combo, and the next pellet.
      if (willEat) {
        events.ate = true;
        const open = this.comboWindow > 0;
        const raised = open ? Math.min(COMBO_MAX, this.combo + 1) : 1;
        if (raised > this.combo) events.comboRose = true;
        this.combo = raised;
        this.score += PELLET_POINTS * this.combo;
        this.comboWindow = COMBO_WINDOW;
        if (this.pelletRespawn) {
          if (!this.spawnPellet()) {
            this.ended = true;
            this.endReason = "cleared";
          }
        } else {
          this.pellet = null;
        }
      }
    }

    // 6 — drain the combo window, and lapse it at zero.
    if (this.comboWindow > 0) {
      this.comboWindow -= TICK_SECONDS;
      if (this.comboWindow <= 0) {
        this.comboWindow = 0;
        this.combo = 1;
      }
    }
    return events;
  }

  /** The combo window as a fraction of a full one, for the draining HUD bar. */
  comboFraction(): number {
    return Math.max(0, Math.min(1, this.comboWindow / COMBO_WINDOW));
  }

  // ---- Posing (specs/instrumentation.md) --------------------------------------
  //
  // Each of these sets one thing and leaves the rest of the round as it stands. A
  // pose never fabricates an outcome: the next tick advances and resolves from
  // exactly the configuration it left, through the same systems play runs.

  /** Replace the chain, leaving the direction, the buffer and the pellet alone. */
  setSnake(cells: readonly Cell[]): void {
    this.snake = cells.map((cell) => ({ col: cell.col, row: cell.row }));
  }

  /** Place the live pellet, replacing whatever pellet was on the board. */
  setPellet(col: number, row: number): void {
    this.pellet = { col, row };
  }

  /** Take the pellet off the board without eating it. */
  clearPellet(): void {
    this.pellet = null;
  }

  /** Take every obstacle cell off the board at once. */
  clearObstacles(): void {
    this.setObstacles([]);
  }

  /** Add one obstacle cell, leaving a cell that already carries one as it is. */
  addObstacle(col: number, row: number): void {
    const key = cellKey(col, row);
    if (this.obstacleSet.has(key)) return;
    this.obstacleCells.push({ col, row });
    this.obstacleSet.add(key);
  }

  private setObstacles(cells: readonly Cell[]): void {
    this.obstacleCells = cells.map((cell) => ({ ...cell }));
    this.obstacleSet = new Set(
      this.obstacleCells.map((cell) => cellKey(cell.col, cell.row)),
    );
  }

  /**
   * Place the next pellet on a cell drawn uniformly from the valid set, and report
   * whether one was found. The free cells are collected once and one is drawn from
   * the list, so a nearly full board picks its pellet without a rejection-sampling
   * stall. `false` means the valid set is empty, which is the board-cleared win.
   */
  private spawnPellet(): boolean {
    const occupied = new Set<number>();
    for (const segment of this.snake) {
      occupied.add(cellKey(segment.col, segment.row));
    }
    if (this.pellet) occupied.add(cellKey(this.pellet.col, this.pellet.row));
    const free: Cell[] = [];
    for (let row = INTERIOR_ROW_MIN; row <= INTERIOR_ROW_MAX; row++) {
      for (let col = INTERIOR_COL_MIN; col <= INTERIOR_COL_MAX; col++) {
        const key = cellKey(col, row);
        if (occupied.has(key) || this.obstacleSet.has(key)) continue;
        free.push({ col, row });
      }
    }
    if (free.length === 0) {
      this.pellet = null;
      return false;
    }
    this.pellet = free[this.rng.below(free.length)]!;
    return true;
  }
}

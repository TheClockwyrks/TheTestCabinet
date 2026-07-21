// Coil — the round simulation (specs/mechanics.md, specs/playfield.md).
//
// A pure, headless model of one round: the snake, the single pellet, the combo, and the
// score, advanced by a fixed-timestep `tick()`. It works entirely in integer cell
// coordinates and knows nothing about rendering, audio, menus, or the wall clock — the
// game loop (main.ts) calls `tick(TICK_DT)` every 125 ms while playing, and the headless
// test harness calls it through `window.__coil.step(ticks)`. It is the object exposed as
// `window.__coil.sim`.
//
// The per-tick order of operations is EXACTLY the one specs/mechanics.md fixes:
//   1 apply one buffered turn  2 advance head  3 resolve collision (fatal ⇒ end, skip 4–6)
//   4 eat(grow)/move(prepend+drop tail)  5 resolve food (score, combo, spawn pellet)
//   6 decrement the combo window, expire at 0.

import {
  COLS,
  COMBO_MAX,
  COMBO_WINDOW,
  IN_COL0,
  IN_COL1,
  IN_ROW0,
  IN_ROW1,
  MAZE_OBSTACLES,
  POINTS_PER_PELLET,
  START_CELLS,
  isWall,
} from "./constants";
import type { Mode } from "./mode";

export type Dir = "up" | "down" | "left" | "right";
export interface Cell {
  col: number;
  row: number;
}

const DELTA: Record<Dir, { dcol: number; drow: number }> = {
  up: { dcol: 0, drow: -1 },
  down: { dcol: 0, drow: 1 },
  left: { dcol: -1, drow: 0 },
  right: { dcol: 1, drow: 0 },
};

const AXIS: Record<Dir, "h" | "v"> = { up: "v", down: "v", left: "h", right: "h" };

function key(col: number, row: number): number {
  return row * COLS + col;
}

export type EndReason = "dead" | "cleared";

// Random source — swappable so a scenario can seed a deterministic stream. Defaults to
// Math.random; the pellet is chosen uniformly over the valid-cell set (specs/playfield.md).
export type Rng = () => number;

// A small, self-contained seeded generator (mulberry32) so reseeding and replaying the same
// calls reproduces the same pellet sequence exactly (specs/instrumentation.md). Pure and
// deterministic; used only when a seed is supplied.
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Sim {
  readonly mode: Mode;
  snake: Cell[] = [];
  dir: Dir = "right";
  pellet: Cell | null = { col: 0, row: 0 }; // null once the board is cleared
  score = 0;
  combo = 1; // M in [1, COMBO_MAX]
  comboWindow = 0; // seconds of sim-time left on the window; > 0 ⇒ open
  ticks = 0; // fixed ticks elapsed this round
  simTime = 0; // accumulated sim seconds this round
  ended = false;
  endReason: EndReason | null = null;
  obstacles: Cell[];

  // Per-tick presentation flags (read by the loop after each tick, then reset next tick).
  ateThisTick = false;
  comboRoseThisTick = false;
  diedThisTick = false;

  private readonly obstacleSet: Set<number>;
  private turnBuffer: Dir[] = [];
  private readonly rng: Rng;

  constructor(mode: Mode, rng: Rng = Math.random) {
    this.mode = mode;
    this.rng = rng;
    this.obstacles = mode === "maze" ? MAZE_OBSTACLES.map((o) => ({ ...o })) : [];
    this.obstacleSet = new Set(this.obstacles.map((o) => key(o.col, o.row)));
    this.reset();
  }

  reset(): void {
    this.snake = START_CELLS.map((c) => ({ ...c }));
    this.dir = "right";
    this.turnBuffer = [];
    this.score = 0;
    this.combo = 1;
    this.comboWindow = 0;
    this.ticks = 0;
    this.simTime = 0;
    this.ended = false;
    this.endReason = null;
    this.ateThisTick = false;
    this.comboRoseThisTick = false;
    this.diedThisTick = false;
    // First pellet spawns AFTER the snake is placed, so it never overlaps the start body.
    this.spawnPellet();
  }

  // The player-facing steering entry point — the same call a key press makes. Buffers a
  // requested turn (holds at most two). Validity vs. the direction actually moving is
  // decided at step 1 of the tick, not here (specs/mechanics.md, "One turn per tick").
  requestTurn(dir: Dir): void {
    if (dir !== "up" && dir !== "down" && dir !== "left" && dir !== "right") return;
    if (this.ended) return;
    if (this.turnBuffer.length >= 2) return;
    // Dedupe an immediate repeat so a held key can't stuff the buffer with no-ops; the
    // reference-against is the last buffered turn, or the committed direction if empty.
    const against = this.turnBuffer.length > 0 ? this.turnBuffer[this.turnBuffer.length - 1]! : this.dir;
    if (dir === against) return;
    this.turnBuffer.push(dir);
  }

  private perpendicular(a: Dir, b: Dir): boolean {
    return AXIS[a] !== AXIS[b];
  }

  // Collision test against the POST-MOVE body (specs/mechanics.md "The tail rule"). On a
  // normal tick the tail vacates, so the head may enter the current tail cell; on a growth
  // tick the tail stays, so the whole body (including the tail) is solid.
  private fatal(col: number, row: number, willEat: boolean): boolean {
    if (isWall(col, row)) return true;
    if (this.obstacleSet.has(key(col, row))) return true;
    const solidCount = willEat ? this.snake.length : this.snake.length - 1;
    for (let i = 0; i < solidCount; i++) {
      const s = this.snake[i]!;
      if (s.col === col && s.row === row) return true;
    }
    return false;
  }

  tick(dt: number): void {
    if (this.ended) return;
    this.ateThisTick = false;
    this.comboRoseThisTick = false;
    this.diedThisTick = false;
    // A tick has elapsed (counted even on the fatal tick that ends the round).
    this.ticks++;
    this.simTime += dt;

    // 1 — apply input: take the oldest buffered turn, apply only if it is perpendicular to
    // the direction actually moving this tick; discard otherwise (straight and reversal both).
    if (this.turnBuffer.length > 0) {
      const req = this.turnBuffer.shift()!;
      if (this.perpendicular(req, this.dir)) this.dir = req;
    }

    // 2 — advance the head.
    const head = this.snake[0]!;
    const d = DELTA[this.dir];
    const nCol = head.col + d.dcol;
    const nRow = head.row + d.drow;

    const willEat = this.pellet !== null && nCol === this.pellet.col && nRow === this.pellet.row;

    // 3 — resolve collision. Fatal ⇒ end immediately; steps 4–6 do not run.
    if (this.fatal(nCol, nRow, willEat)) {
      this.ended = true;
      this.endReason = "dead";
      this.diedThisTick = true;
      return;
    }

    // 4 — eat or move.
    this.snake.unshift({ col: nCol, row: nRow });
    if (!willEat) {
      this.snake.pop();
    }

    // 5 — resolve food: score, combo, and the next pellet.
    if (willEat) {
      this.ateThisTick = true;
      const wasOpen = this.comboWindow > 0;
      const newM = wasOpen ? Math.min(COMBO_MAX, this.combo + 1) : 1;
      if (newM > this.combo) this.comboRoseThisTick = true;
      this.combo = newM;
      this.score += POINTS_PER_PELLET * this.combo;
      this.comboWindow = COMBO_WINDOW; // (re)open the window for another 3.5 s
      if (!this.spawnPellet()) {
        // No valid cell remains — the snake filled the board. Clean win (specs/playfield.md).
        this.ended = true;
        this.endReason = "cleared";
      }
    }

    // 6 — advance timers: drain the combo window; expiring it resets the multiplier.
    if (this.comboWindow > 0) {
      this.comboWindow -= dt;
      if (this.comboWindow <= 0) {
        this.comboWindow = 0;
        this.combo = 1;
      }
    }
  }

  // Combo window as a 0..1 fraction of full, for the draining HUD bar (specs/flow.md).
  comboFraction(): number {
    return Math.max(0, Math.min(1, this.comboWindow / COMBO_WINDOW));
  }

  // Place the pellet uniformly at random over the valid cells: an interior cell not on the
  // snake and (in Maze) not on an obstacle (specs/playfield.md). Returns false when no
  // valid cell remains (board cleared). Stays correct/fast even with few cells left: it
  // collects the free cells once and picks one, so there is no rejection-sampling stall.
  private spawnPellet(): boolean {
    const occupied = new Set<number>();
    for (const s of this.snake) occupied.add(key(s.col, s.row));
    const free: Cell[] = [];
    for (let row = IN_ROW0; row <= IN_ROW1; row++) {
      for (let col = IN_COL0; col <= IN_COL1; col++) {
        const k = key(col, row);
        if (occupied.has(k) || this.obstacleSet.has(k)) continue;
        free.push({ col, row });
      }
    }
    if (free.length === 0) {
      this.pellet = null;
      return false;
    }
    const idx = Math.min(free.length - 1, Math.floor(this.rng() * free.length));
    this.pellet = free[idx]!;
    return true;
  }

  // ---- Control surface (specs/instrumentation.md) --------------------------------
  //
  // Preconditions set directly on the real model, so the next tick advances and resolves
  // from exactly this configuration through the ordinary systems. They never fabricate the
  // outcome a check observes — a following tick() runs it forward.

  // Pose the snake as the head-first chain `cells` with facing `dir`, clearing any buffered
  // turn so the next tick advances from exactly this configuration.
  setSnake(cells: Cell[], dir: Dir): void {
    this.snake = cells.map((c) => ({ col: c.col, row: c.row }));
    this.dir = dir;
    this.turnBuffer = [];
  }

  // Place the current pellet; the next tick eats it normally if the head advances into it.
  setPellet(cell: Cell): void {
    this.pellet = { col: cell.col, row: cell.row };
  }

  // Set the combo multiplier and the seconds left on its window as a precondition; the next
  // eat or the window's lapse resolves through the real tick.
  setCombo(multiplier: number, windowSeconds: number): void {
    this.combo = Math.max(1, Math.min(COMBO_MAX, Math.round(multiplier)));
    this.comboWindow = Math.max(0, windowSeconds);
  }

  // Set the current score as a precondition; BEST still resolves through real play.
  setScore(points: number): void {
    this.score = Math.max(0, Math.floor(points));
  }
}

// Meltdown — the Surge unit (specs/creeps.md). Ground units steer down a
// distance field (the maze the player built); flyers ignore the maze and fly a
// straight line to their assigned opposite exhaust. Targeting, damage, bounties,
// and leaks are handled by game.ts.

import { COLS, FLOOR_X1, FLOOR_Y1 } from "./constants";
import { SURGE_DEFS, type SurgeDef } from "./defs";
import type { Grid } from "./grid";
import { tileAtPixel, tileCenter } from "./grid";
import type { SurgeType, Vent } from "./types";

const SLOW_DURATION = 1.5; // seconds a slow lasts, refreshed by further hits

export type Goal = "right" | "bottom";

let NEXT_SURGE_ID = 1;

export class Surge {
  readonly id = NEXT_SURGE_ID++;
  readonly type: SurgeType;
  readonly def: SurgeDef;
  readonly vent: Vent;
  readonly goal: Goal;

  x: number;
  y: number;
  hp: number;
  readonly maxHp: number;

  // Flyer straight-line target.
  private readonly targetX: number;
  private readonly targetY: number;

  // Slow state.
  private slowStrength = 0;
  private slowExpire = 0;

  alive = true;
  leaked = false;

  constructor(type: SurgeType, vent: Vent, spawnTile: number, hp: number) {
    this.type = type;
    this.def = SURGE_DEFS[type];
    this.vent = vent;
    this.goal = vent === "left" ? "right" : "bottom";
    this.hp = hp;
    this.maxHp = hp;

    const c = spawnTile % COLS;
    const r = Math.floor(spawnTile / COLS);
    const ctr = tileCenter(c, r);
    this.x = ctr.x;
    this.y = ctr.y;

    // A flyer flies straight from its vent to the opposite exhaust opening,
    // keeping its cross-axis coordinate (specs/playfield.md).
    if (this.goal === "right") {
      this.targetX = FLOOR_X1;
      this.targetY = this.y;
    } else {
      this.targetX = this.x;
      this.targetY = FLOOR_Y1;
    }
  }

  get flies(): boolean {
    return this.def.flies;
  }

  currentSlow(now: number): number {
    return now < this.slowExpire ? this.slowStrength : 0;
  }

  // The unit's unslowed speed at this wave (px/s). Speed does not scale with the
  // wave in this build, so this is the definition speed.
  get baseSpeed(): number {
    return this.def.speed;
  }

  // The unit's current speed (px/s), reflecting any active Rime slow. Read by the
  // debug snapshot (specs/instrumentation.md).
  speedAt(now: number): number {
    return this.speed(now);
  }

  applySlow(factor: number, now: number): void {
    if (!this.def.slowable || factor <= 0) return;
    if (now >= this.slowExpire) this.slowStrength = 0;
    this.slowStrength = Math.max(this.slowStrength, factor);
    this.slowExpire = now + SLOW_DURATION;
  }

  // Apply `amount` damage and return how much was actually dealt (clamped to the
  // remaining hp, so overkill on the killing blow isn't over-counted). The caller
  // credits the firing tower's instance tallies (game.fire, specs/playfield.md).
  damage(amount: number): number {
    const dealt = Math.min(amount, this.hp);
    this.hp -= amount;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
    }
    return dealt;
  }

  private speed(now: number): number {
    return this.def.speed * (1 - this.currentSlow(now));
  }

  // Flyer step: straight line toward the opposite exhaust. Returns true on leak.
  updateFly(now: number, dt: number): boolean {
    const dx = this.targetX - this.x;
    const dy = this.targetY - this.y;
    const dist = Math.hypot(dx, dy);
    const move = this.speed(now) * dt;
    if (dist <= move || dist === 0) {
      this.leaked = true;
      this.alive = false;
      return true;
    }
    this.x += (dx / dist) * move;
    this.y += (dy / dist) * move;
    // Reaching the exhaust edge leaks it.
    if (
      (this.goal === "right" && this.x >= FLOOR_X1) ||
      (this.goal === "bottom" && this.y >= FLOOR_Y1)
    ) {
      this.leaked = true;
      this.alive = false;
      return true;
    }
    return false;
  }

  // Ground step: steer down the distance field toward the exhaust. Re-paths live
  // because the next tile is chosen from the current tile every step. Returns
  // true on leak (reached an exhaust tile).
  updateGround(grid: Grid, field: Float64Array, exhaustTiles: number[], now: number, dt: number): boolean {
    const cur = tileAtPixel(this.x, this.y);
    const curIdx = cur.r * COLS + cur.c;
    if (exhaustTiles.includes(curIdx)) {
      this.leaked = true;
      this.alive = false;
      return true;
    }
    const next = grid.bestNext(cur.c, cur.r, field);
    if (!next) return false; // fully walled (should not happen: can't-seal rule)
    const ctr = tileCenter(next.c, next.r);
    const dx = ctr.x - this.x;
    const dy = ctr.y - this.y;
    const dist = Math.hypot(dx, dy);
    const move = this.speed(now) * dt;
    if (dist <= move || dist === 0) {
      this.x = ctr.x;
      this.y = ctr.y;
    } else {
      this.x += (dx / dist) * move;
      this.y += (dy / dist) * move;
    }
    return false;
  }

  // Remaining distance to the exhaust — used to pick the target "furthest along
  // its path" (smaller = further along). Flyers use straight-line distance.
  progressRemaining(field: Float64Array): number {
    if (this.flies) return Math.hypot(this.targetX - this.x, this.targetY - this.y);
    const cur = tileAtPixel(this.x, this.y);
    const d = field[cur.r * COLS + cur.c];
    return isFinite(d) ? d : Infinity;
  }
}

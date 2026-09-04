// Meltdown — targeting, the fire clock, and what a shot removes.
//
// specs/combat.md fixes all of it: range as a radius from the footprint centre,
// the target as the in-range unit with the smallest `remaining` (ties by lowest
// id), an accumulator that grows only while the tower has a target and is
// online, and a shot that removes `baseDamage(level) * heatMultiplier(H,
// redline)` with NO exception — a Rime's shot deals ordinary damage and its
// slow is an addition to it.
//
// The heat a shot is scaled by is the heat the FRAME opened with, because
// specs/heat.md writes the frame's new heats only after every flow is known.
// That is what makes a frame's damage independent of the order the towers
// resolve in.

import { SLOW_TIME, SURGE_DEFS, TILE } from "./constants";
import {
  SPLASH_RADIUS,
  damageOf,
  emitterOf,
  slowFactorOf,
  slowable,
  towerCentre,
} from "./stats";
import { remainingOf } from "./surge";
import type { Routes } from "./routes";
import type { TowerState, UnitState } from "./game";

/**
 * The slack every accumulator comparison carries. Every rate in this game is
 * integrated by repeated addition of a frame's delta, so a run of frames that
 * covers exactly one interval can land a hair under it in binary floating
 * point. The slack is far smaller than any figure the specification fixes and
 * far larger than the error a frame's addition introduces, so an interval that
 * was meant to be covered is.
 */
const EPS = 1e-9;

/** A unit being resolved during the frame. */
interface Live {
  unit: UnitState;
  hp: number;
  slowFactor: number;
  slowTimer: number;
  dead: boolean;
}

/** A tower being resolved during the frame. */
interface Gun {
  tower: TowerState;
  fireClock: number;
  firing: boolean;
  targeting: number | null;
  kills: number;
  damageDealt: number;
  shots: number;
}

/** What one frame of targeting and firing left behind. */
export interface CombatFrame {
  readonly towers: TowerState[];
  readonly surge: UnitState[];
  /** How many shots each tower, by roster index, resolved this frame. */
  readonly shots: number[];
  readonly money: number;
  readonly score: number;
  readonly fired: boolean;
  readonly died: boolean;
}

/**
 * One frame of combat: each emitter picks its target from the floor as it
 * stands, runs its accumulator forward by `dt`, and resolves whatever shots
 * that covers.
 */
export function resolveCombat(
  towers: readonly TowerState[],
  surge: readonly UnitState[],
  routes: Routes,
  dt: number,
  money: number,
  score: number,
): CombatFrame {
  const live: Live[] = surge.map((unit) => ({
    unit,
    hp: unit.hp,
    slowFactor: unit.slowFactor,
    slowTimer: unit.slowTimer,
    dead: false,
  }));
  const guns: Gun[] = towers.map((tower) => ({
    tower,
    fireClock: tower.fireClock,
    firing: false,
    targeting: null,
    kills: tower.kills,
    damageDealt: tower.damageDealt,
    shots: 0,
  }));
  const remaining = new Map<number, number>();
  for (const unit of surge) remaining.set(unit.id, remainingOf(unit, routes));

  let purse = money;
  let points = score;
  let fired = false;
  let died = false;

  for (const gun of guns) {
    const tower = gun.tower;
    const stats = emitterOf(tower);
    if (!stats) continue;
    if (tower.tripped || !tower.firingEnabled) continue;
    const target = pickTarget(tower, live, remaining);
    if (!target) continue;
    gun.firing = true;
    gun.targeting = target.unit.id;
    gun.fireClock += dt;
    const interval = 1 / stats.fireRate;
    while (gun.fireClock >= interval - EPS) {
      if (target.dead) break;
      gun.fireClock -= interval;
      gun.shots += 1;
      fired = true;
      const damage = damageOf(tower);
      const struck = tower.type === "bloom" ? splashOf(target, live) : [target];
      for (const victim of struck) {
        const removed = Math.min(victim.hp, damage);
        victim.hp -= removed;
        gun.damageDealt += removed;
        if (victim.hp <= 0 && !victim.dead) {
          victim.hp = 0;
          victim.dead = true;
          gun.kills += 1;
          const bounty = SURGE_DEFS[victim.unit.type].bounty;
          purse += bounty;
          points += bounty;
          died = true;
        }
      }
      if (tower.type === "rime") applySlow(target, slowFactorOf(tower));
    }
  }

  return {
    towers: guns.map((gun) => ({
      ...gun.tower,
      fireClock: gun.fireClock,
      firing: gun.firing,
      targeting: gun.targeting,
      kills: gun.kills,
      damageDealt: gun.damageDealt,
    })),
    surge: live
      .filter((entry) => !entry.dead)
      .map((entry) => ({
        ...entry.unit,
        hp: entry.hp,
        slowFactor: entry.slowFactor,
        slowTimer: entry.slowTimer,
      })),
    shots: guns.map((gun) => gun.shots),
    money: purse,
    score: points,
    fired,
    died,
  };
}

/**
 * The in-range unit with the smallest `remaining`, ties broken by the lowest
 * id. The Flak targets flying units alone; every other emitter targets ground
 * and air alike, and a unit immune to slowing is an ordinary target.
 */
function pickTarget(
  tower: TowerState,
  live: readonly Live[],
  remaining: ReadonlyMap<number, number>,
): Live | null {
  const stats = emitterOf(tower);
  if (!stats) return null;
  const centre = towerCentre(tower);
  const reach = stats.range * TILE;
  let best: Live | null = null;
  let bestRemaining = Infinity;
  for (const entry of live) {
    if (entry.dead) continue;
    const def = SURGE_DEFS[entry.unit.type];
    if (tower.type === "flak" && !def.flies) continue;
    const dx = entry.unit.x - centre.x;
    const dy = entry.unit.y - centre.y;
    if (Math.hypot(dx, dy) > reach) continue;
    const left = remaining.get(entry.unit.id) ?? Infinity;
    if (
      best === null ||
      left < bestRemaining ||
      (left === bestRemaining && entry.unit.id < best.unit.id)
    ) {
      best = entry;
      bestRemaining = left;
    }
  }
  return best;
}

/** Every live unit inside the Bloom's splash radius of the target's centre. */
function splashOf(target: Live, live: readonly Live[]): Live[] {
  return live.filter(
    (entry) =>
      !entry.dead &&
      Math.hypot(entry.unit.x - target.unit.x, entry.unit.y - target.unit.y) <=
        SPLASH_RADIUS,
  );
}

/**
 * The one-slow-per-unit rule of specs/combat.md, in its three flat cases: a
 * stronger slow replaces the live one and resets the timer, an equal one leaves
 * the factor and resets the timer, and a weaker one changes neither.
 */
function applySlow(target: Live, factor: number): void {
  if (factor <= 0) return;
  if (!slowable(target.unit.type)) return;
  if (factor > target.slowFactor) {
    target.slowFactor = factor;
    target.slowTimer = SLOW_TIME;
    return;
  }
  if (factor === target.slowFactor) target.slowTimer = SLOW_TIME;
}

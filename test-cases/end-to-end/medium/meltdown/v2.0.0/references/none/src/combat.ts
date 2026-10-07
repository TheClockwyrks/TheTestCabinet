// Meltdown — targeting, the fire clock, and what a shot removes
// (specs/combat.md).
//
// An emitter fires on its own: there is no trigger. Every frame it picks the
// in-range unit furthest along its route, adds the frame's game time to its fire
// clock while it holds one, and resolves a shot each time that clock reaches its
// interval — so a long frame resolves several shots in order and the remainder
// carries. A shot removes `baseDamage(level) * heatMultiplier(H, redline)` with
// NO exception: a Rime's slow is an addition to that damage, never a replacement
// for it.
//
// The heat a shot is scaled by is the heat the frame opened with, because
// `src/heat.ts` writes the new heats only after this pass has counted the frame's
// shots.

import { BLOOM_SPLASH, SLOW_TIME, TILE } from "./constants";
import { SURGE_DEFS } from "./defs";
import type { MeltdownState, Tower, Unit } from "./state";
import {
  centreOf,
  damageOf,
  emitterDef,
  rangeUnits,
  slowFactorOf,
  statsOf,
} from "./towers";
import { remainingOf } from "./units";

/** What one frame of firing did, for the heat pass and the economy to read. */
export interface CombatFrame {
  /** How many shots each tower resolved, by tower id. */
  shotsFired: Map<number, number>;
  /** Whether any shot at all resolved, which the `fire` cue answers. */
  anyShot: boolean;
  /** The units this frame's shots took to `0` hp, in the order they fell. */
  deaths: Unit[];
}

/** Whether `unit` is inside `tower`'s range and is a kind it will fire on. */
export function isTargetable(
  tower: Tower,
  unit: Unit,
  def: ReturnType<typeof emitterDef>,
): boolean {
  if (def === null) return false;
  if (unit.hp <= 0) return false;
  if (def.airOnly && !SURGE_DEFS[unit.type].flies) return false;
  const centre = centreOf(tower);
  return Math.hypot(unit.x - centre.x, unit.y - centre.y) <= rangeUnits(tower);
}

/**
 * The unit `tower` fires on this frame: the in-range unit with the smallest
 * `remaining`, separated by the lower id (specs/combat.md).
 */
export function acquire(tower: Tower, state: MeltdownState): Unit | null {
  const def = emitterDef(tower);
  if (def === null) return null;
  let best: Unit | null = null;
  let bestRemaining = Infinity;
  for (const unit of state.surge) {
    if (!isTargetable(tower, unit, def)) continue;
    const remaining = remainingOf(unit, state.floor);
    if (
      best === null ||
      remaining < bestRemaining ||
      (remaining === bestRemaining && unit.id < best.id)
    ) {
      best = unit;
      bestRemaining = remaining;
    }
  }
  return best;
}

/**
 * Apply an incoming slow to a unit, in the three flat cases the rule states: a
 * stronger slow replaces the live one and resets the timer, an equal slow leaves
 * the factor and resets the timer, a weaker slow changes neither.
 */
export function applySlow(unit: Unit, factor: number): void {
  if (!SURGE_DEFS[unit.type].slowable || factor <= 0) return;
  if (factor > unit.slowFactor) {
    unit.slowFactor = factor;
    unit.slowTimer = SLOW_TIME;
  } else if (factor === unit.slowFactor) {
    unit.slowTimer = SLOW_TIME;
  }
}

/** Remove `amount` hp, and report how much was actually there to remove. */
function hurt(unit: Unit, amount: number): number {
  const dealt = Math.min(amount, unit.hp);
  unit.hp = Math.max(0, unit.hp - amount);
  return dealt;
}

/** Every unit one shot removes hp from: the target, plus a Bloom's splash. */
function struck(tower: Tower, target: Unit, state: MeltdownState): Unit[] {
  const def = emitterDef(tower);
  if (def?.splash === undefined) return [target];
  const radius = BLOOM_SPLASH * TILE;
  return state.surge.filter(
    (unit) =>
      unit.hp > 0 && Math.hypot(unit.x - target.x, unit.y - target.y) <= radius,
  );
}

/** Resolve one shot from `tower` at `target`, and collect what it killed. */
function fireOnce(
  tower: Tower,
  target: Unit,
  state: MeltdownState,
  deaths: Unit[],
): void {
  const damage = damageOf(tower);
  for (const unit of struck(tower, target, state)) {
    const dealt = hurt(unit, damage);
    tower.damageDealt += dealt;
    if (unit.hp <= 0) {
      tower.kills += 1;
      deaths.push(unit);
    }
  }
  const slow = slowFactorOf(tower);
  if (slow > 0 && target.hp > 0) applySlow(target, slow);

  const centre = centreOf(tower);
  const splash = emitterDef(tower)?.splash;
  state.shots.push({
    x1: centre.x,
    y1: centre.y,
    x2: target.x,
    y2: target.y,
    splash: splash === undefined ? 0 : splash * TILE,
    life: 0.08,
    color: tower.type === "rime" ? "#9ff6ff" : "#ffd9a0",
  });
}

/**
 * One frame of targeting and firing over every tower on the floor.
 *
 * `dt` is the game time the frame advanced by, already scaled by the game speed.
 */
export function resolveCombat(state: MeltdownState, dt: number): CombatFrame {
  const frame: CombatFrame = {
    shotsFired: new Map(),
    anyShot: false,
    deaths: [],
  };

  for (const tower of state.towers) {
    const stats = statsOf(tower);
    if (stats === null || tower.tripped || !tower.firingEnabled) {
      tower.targeting = null;
      tower.firing = false;
      continue;
    }
    const target = acquire(tower, state);
    if (target === null) {
      tower.targeting = null;
      tower.firing = false;
      continue;
    }
    tower.targeting = target.id;
    tower.firing = true;
    tower.fireAcc += dt;
    const interval = 1 / stats.fireRate;
    let shots = 0;
    while (tower.fireAcc >= interval) {
      tower.fireAcc -= interval;
      // The target is re-acquired between shots of one frame, so a burst does
      // not go on hitting a unit its first shot already removed.
      const live = target.hp > 0 ? target : acquire(tower, state);
      if (live === null) break;
      fireOnce(tower, live, state, frame.deaths);
      shots += 1;
    }
    if (shots > 0) {
      frame.shotsFired.set(tower.id, shots);
      frame.anyShot = true;
    }
  }

  return frame;
}

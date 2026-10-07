// Meltdown — targeting, the fire clock, and what a shot removes.
//
// An emitter fires on its own: it takes the in-range unit furthest along its
// route, accumulates the frame's game time only while it has a target and is
// online, and resolves one shot each time the accumulator reaches its interval
// — so a run of firing lands its first shot one full interval in, and a frame
// long enough to cover several intervals resolves that many in order with the
// remainder carried (specs/combat.md).
//
// The heat a shot is scaled by is the heat the FRAME OPENED with, because the
// heat pass runs after this one and writes nothing before it. That is what lets
// a combat measurement be taken at a pinned heat, and it is why the two-phase
// rule in `src/heat.ts` and the fire clock here never have to agree about an
// order.

import { SLOW_TIME, SURGE_DEFS } from "./constants";
import {
  SPLASH_UNITS,
  damageOf,
  emitterDef,
  liveStats,
  rangeUnits,
  slowFactorOf,
  towerCentre,
} from "./stats";
import { dropUnit, unitRemaining, unitsWithin } from "./surge";
import type { MeltdownState, TowerState, UnitState } from "./game";

/** What one frame of combat produced. */
export interface CombatOutcome {
  /** How many shots each tower resolved, for the heat pass. */
  shots: Map<number, number>;
  /** Whether any shot resolved at all. */
  fired: boolean;
  /** Whether any unit was taken to zero hp. */
  killed: boolean;
  /** Whether any unit left the roster, which is what can clear a wave. */
  removed: boolean;
}

/** How many shots one tower may resolve in one frame before the loop gives up. */
const MAX_SHOTS_PER_FRAME = 512;

/**
 * The unit this emitter fires on: the in-range unit with the smallest
 * `remaining`, ties broken by the lower id. The Flak sees flying units alone.
 */
export function acquire(
  state: MeltdownState,
  tower: TowerState,
  remaining: ReadonlyMap<number, number>,
): UnitState | null {
  const centre = towerCentre(tower);
  const reach = rangeUnits(tower);
  let best: UnitState | null = null;
  let bestRemaining = Infinity;
  for (const unit of state.surge) {
    if (tower.type === "flak" && !SURGE_DEFS[unit.type].flies) continue;
    const distance = Math.hypot(unit.x - centre.x, unit.y - centre.y);
    if (distance > reach + 1e-9) continue;
    const left = remaining.get(unit.id) ?? unitRemaining(state, unit);
    if (
      best === null ||
      left < bestRemaining - 1e-9 ||
      (Math.abs(left - bestRemaining) <= 1e-9 && unit.id < best.id)
    ) {
      best = unit;
      bestRemaining = left;
    }
  }
  return best;
}

/**
 * Apply an incoming slow to a unit, in the three flat cases of
 * `specs/combat.md`: a stronger slow replaces the live one and resets its
 * timer, an equal one resets the timer alone, a weaker one changes nothing.
 */
export function applySlow(unit: UnitState, factor: number): void {
  if (!SURGE_DEFS[unit.type].slowable) return;
  if (factor <= 0) return;
  if (factor > unit.slowFactor + 1e-12) {
    unit.slowFactor = factor;
    unit.slowTimer = SLOW_TIME;
    return;
  }
  if (Math.abs(factor - unit.slowFactor) <= 1e-12) unit.slowTimer = SLOW_TIME;
}

/** Remove hp from one unit, tallying what the shot actually took. */
function hit(
  state: MeltdownState,
  tower: TowerState,
  unit: UnitState,
  damage: number,
  outcome: CombatOutcome,
): void {
  const dealt = Math.min(unit.hp, damage);
  unit.hp = Math.max(0, unit.hp - damage);
  tower.damageDealt += dealt;
  if (unit.hp > 0) return;
  tower.kills += 1;
  const bounty = SURGE_DEFS[unit.type].bounty;
  state.money += bounty;
  state.score += bounty;
  dropUnit(state, unit.id);
  outcome.killed = true;
  outcome.removed = true;
}

/** Resolve one shot: its damage, the Bloom's splash, and the Rime's slow. */
function resolveShot(
  state: MeltdownState,
  tower: TowerState,
  target: UnitState,
  outcome: CombatOutcome,
): void {
  const damage = damageOf(tower);
  const victims =
    tower.type === "bloom"
      ? unitsWithin(state, target.x, target.y, SPLASH_UNITS)
      : [target];
  for (const victim of victims) hit(state, tower, victim, damage, outcome);
  if (tower.type !== "rime") return;
  // The slow lands on the target alone, and only while it is still on the
  // floor: a shot that killed it has nothing left to slow.
  if (state.surge.includes(target)) applySlow(target, slowFactorOf(tower));
}

/**
 * Run one frame of targeting and firing for every emitter on the floor.
 *
 * A tripped emitter and one whose firing gate is off acquire nothing, fire
 * nothing, and leave their accumulator exactly where it stands.
 */
export function resolveCombat(state: MeltdownState, dt: number): CombatOutcome {
  const outcome: CombatOutcome = {
    shots: new Map<number, number>(),
    fired: false,
    killed: false,
    removed: false,
  };

  const remaining = new Map<number, number>();
  for (const unit of state.surge) {
    remaining.set(unit.id, unitRemaining(state, unit));
  }

  for (const tower of state.towers) {
    if (emitterDef(tower.type) === null) {
      tower.targeting = null;
      tower.firing = false;
      continue;
    }
    if (tower.tripped || !tower.firingEnabled) {
      tower.targeting = null;
      tower.firing = false;
      continue;
    }

    let target = acquire(state, tower, remaining);
    tower.targeting = target?.id ?? null;
    tower.firing = target !== null;
    if (target === null) continue;

    tower.fireClock += dt;
    const interval = 1 / liveStats(tower).fireRate;
    for (
      let guard = 0;
      guard < MAX_SHOTS_PER_FRAME && tower.fireClock >= interval;
      guard += 1
    ) {
      if (!state.surge.includes(target)) {
        // The shot's target went during this frame, so the next shot takes the
        // next unit under the same rule rather than firing into nothing.
        remaining.delete(target.id);
        target = acquire(state, tower, remaining);
        if (target === null) {
          tower.targeting = null;
          break;
        }
        tower.targeting = target.id;
      }
      tower.fireClock -= interval;
      resolveShot(state, tower, target, outcome);
      outcome.shots.set(tower.id, (outcome.shots.get(tower.id) ?? 0) + 1);
      outcome.fired = true;
    }
  }

  return outcome;
}

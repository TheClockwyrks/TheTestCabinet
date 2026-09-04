// Meltdown — the surge: what crosses the floor, and what leaving it costs.
//
// A ground unit walks between tile centres along the route `src/routes.ts`
// measures, one step at a time, spending the frame's travel budget until it
// runs out; a flyer takes no route at all and travels the straight line to the
// midpoint of its assigned exhaust's opening. Both leave the floor when the
// tile their centre occupies is one of that exhaust's opening tiles, and
// leaving costs the type's leak value in lives (specs/mazing.md,
// specs/surge.md).
//
// A unit's route is always measured FROM THE TILE ITS CENTRE OCCUPIES, so a
// wall dropped in front of it lengthens `remaining` on the frame the floor
// changed without moving the unit an inch — which is the whole of live
// re-pathing.

import {
  OPPOSITE,
  SURGE_DEFS,
  TILE,
  WAVE_SPAWN_INTERVAL,
  type ExhaustName,
  type SurgeType,
  type VentName,
} from "./constants";
import {
  exhaustPoint,
  isExhaustTile,
  tileAt,
  tileCentre,
  tileIndex,
  ventTiles,
  type Tile,
} from "./geometry";
import { nextState, unitValue } from "./rng";
import { nextStep, remainingFrom } from "./routes";
import { hpFactor, speedOf } from "./stats";
import { releaseTypeFor } from "./waves";
import type { MeltdownState, UnitState } from "./game";

/** The exhaust a unit is assigned, which its vent fixes for its whole life. */
export function exhaustOf(unit: UnitState): ExhaustName {
  return OPPOSITE[unit.vent];
}

/** The tile a unit's centre falls in. It may be off the grid. */
export function unitTile(unit: UnitState): Tile {
  return tileAt(unit.x, unit.y);
}

/** Whether a unit is standing on an opening tile of its assigned exhaust. */
export function atExhaust(unit: UnitState): boolean {
  const tile = unitTile(unit);
  return isExhaustTile(exhaustOf(unit), tile.col, tile.row);
}

/**
 * The route length a unit still has to travel, in tiles: its own route for a
 * walker, and the straight-line distance divided by the tile size for a flyer.
 */
export function unitRemaining(state: MeltdownState, unit: UnitState): number {
  const exhaust = exhaustOf(unit);
  if (SURGE_DEFS[unit.type].flies) {
    const target = exhaustPoint(exhaust);
    return Math.hypot(target.x - unit.x, target.y - unit.y) / TILE;
  }
  const tile = unitTile(unit);
  return remainingFrom(state.routes, exhaust, tile.col, tile.row);
}

/** Every unit whose centre lies within `radius` of a point. */
export function unitsWithin(
  state: MeltdownState,
  x: number,
  y: number,
  radius: number,
): UnitState[] {
  return state.surge.filter(
    (unit) => Math.hypot(unit.x - x, unit.y - y) <= radius + 1e-9,
  );
}

/** Take a unit off the floor, paying nothing and costing nothing. */
export function dropUnit(state: MeltdownState, id: number): boolean {
  const index = state.surge.findIndex((unit) => unit.id === id);
  if (index < 0) return false;
  state.surge.splice(index, 1);
  return true;
}

/**
 * Add one unit at a vent, entered into the same pathing and combat systems the
 * spawner uses. Its centre appears on the centre of an OPEN opening tile of
 * that vent, its exhaust is that vent's fixed opposite, and its maximum hp is
 * its base hp scaled for the wave the run is on.
 */
export function spawnUnit(
  state: MeltdownState,
  type: SurgeType,
  vent: VentName,
): UnitState {
  const tiles = ventTiles(vent);
  const entry =
    tiles.find(
      (tile) => state.routes.blocked[tileIndex(tile.col, tile.row)] === 0,
    ) ?? tiles[0];
  const centre = tileCentre(entry.col, entry.row);
  const maxHp = SURGE_DEFS[type].hp * hpFactor(state.mode, state.wave);
  const unit: UnitState = {
    id: state.nextId,
    type,
    x: centre.x,
    y: centre.y,
    hp: maxHp,
    maxHp,
    slowFactor: 0,
    slowTimer: 0,
    vent,
    motion: true,
  };
  state.nextId += 1;
  state.surge.push(unit);
  return unit;
}

/** Draw a vent from the seeded generator, the two equally likely. */
export function drawVent(state: MeltdownState): VentName {
  state.rngState = nextState(state.rngState);
  return unitValue(state.rngState) < 0.5 ? "left" : "top";
}

/** Count every live slow down against the game time this frame advanced by. */
export function tickSlows(state: MeltdownState, dt: number): void {
  for (const unit of state.surge) {
    if (unit.slowTimer <= 0) {
      unit.slowTimer = 0;
      unit.slowFactor = 0;
      continue;
    }
    unit.slowTimer = Math.max(0, unit.slowTimer - dt);
    if (unit.slowTimer <= 0) {
      unit.slowTimer = 0;
      unit.slowFactor = 0;
    }
  }
}

/** What one frame of movement produced. */
export interface MovementOutcome {
  /** Whether any unit reached its exhaust. */
  leaked: boolean;
  /** Whether any unit left the roster, which is what can clear a wave. */
  removed: boolean;
  /** Whether the lives ran out on this frame. */
  lost: boolean;
}

/** How many segments one unit may walk in one frame before the loop gives up. */
const MAX_SEGMENTS = 256;

/** Move one walker along its route, spending its travel budget. */
function walk(state: MeltdownState, unit: UnitState, budget: number): void {
  const exhaust = exhaustOf(unit);
  let left = budget;
  for (let guard = 0; guard < MAX_SEGMENTS && left > 1e-9; guard += 1) {
    if (atExhaust(unit)) return;
    const tile = unitTile(unit);
    const step = nextStep(state.routes, exhaust, tile.col, tile.row);
    if (step === null) return;
    const target = tileCentre(step.col, step.row);
    const dx = target.x - unit.x;
    const dy = target.y - unit.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= 1e-9) return;
    if (distance <= left) {
      unit.x = target.x;
      unit.y = target.y;
      left -= distance;
    } else {
      unit.x += (dx / distance) * left;
      unit.y += (dy / distance) * left;
      left = 0;
    }
  }
}

/** Move one flyer along its straight line, which the floor never changes. */
function fly(unit: UnitState, budget: number): void {
  const target = exhaustPoint(exhaustOf(unit));
  const dx = target.x - unit.x;
  const dy = target.y - unit.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= 1e-9) return;
  if (distance <= budget) {
    unit.x = target.x;
    unit.y = target.y;
    return;
  }
  unit.x += (dx / distance) * budget;
  unit.y += (dy / distance) * budget;
}

/**
 * Advance every unit's locomotion, then take off the floor every unit that
 * reached its assigned exhaust. A leak costs its type's leak value in lives,
 * pays no bounty, and ends the run at once when the lives reach zero.
 */
export function moveSurge(state: MeltdownState, dt: number): MovementOutcome {
  const outcome: MovementOutcome = {
    leaked: false,
    removed: false,
    lost: false,
  };

  for (const unit of state.surge) {
    if (!unit.motion) continue;
    const budget = speedOf(unit) * dt;
    if (budget <= 0) continue;
    if (SURGE_DEFS[unit.type].flies) fly(unit, budget);
    else walk(state, unit, budget);
  }

  for (const unit of [...state.surge]) {
    if (!atExhaust(unit)) continue;
    dropUnit(state, unit.id);
    state.lives -= SURGE_DEFS[unit.type].leak;
    outcome.leaked = true;
    outcome.removed = true;
    if (state.lives <= 0) {
      state.lives = 0;
      outcome.lost = true;
    }
  }

  return outcome;
}

/**
 * Release the units the current wave still owes, one every
 * `WAVE_SPAWN_INTERVAL` of game time. The world gate holds this and the build
 * timer's automatic start and nothing else, so a posed scenario stays quiet.
 */
export function advanceSpawner(state: MeltdownState, dt: number): void {
  if (state.phase !== "wave" || !state.waveSpawning) return;
  if (state.wavePending <= 0) return;
  state.spawnClock += dt;
  for (
    let guard = 0;
    guard < MAX_SEGMENTS &&
    state.spawnClock >= WAVE_SPAWN_INTERVAL &&
    state.wavePending > 0;
    guard += 1
  ) {
    state.spawnClock -= WAVE_SPAWN_INTERVAL;
    spawnUnit(state, releaseTypeFor(state), drawVent(state));
    state.wavePending -= 1;
  }
}

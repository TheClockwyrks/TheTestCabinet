// Meltdown — the heat model, as the CASE computes it. CASE-PROVIDED.
//
// specs/heat.md states the two-phase rule and the four flows; `constants.ts`
// states `RAD_K`, `BASE_K`, `COND_K`, `FORGE_K`, `TRIP_HEAT`, `TRIP_TIME`, the
// per-tower masses and the mover outputs. This module is those two together: an
// INDEPENDENT resolution of one frame of the heat model, written from the
// specification alone.
//
// WHY IT EXISTS. Every thermal expectation in this suite is a number, and a
// number a check reads off the build is a number the check cannot fail. The only
// honest expectation is one the CASE computed, so a check poses a floor, reads
// the heats the snapshot opened the frame with, asks this module what
// specs/heat.md says the frame does to them, advances one frame, and compares.
// A build that resolves in one sequential pass, or forgets a term, or divides by
// the wrong mass, disagrees; a build that got it right agrees to within floating
// point.
//
// NOTHING HERE IMPORTS A BUILD MODULE. `constants.ts` is this project's own
// figure table, transcribed from the specs, and `geometry.ts` beside this file
// is the case's own tile arithmetic. The build's `src/heat.ts` is never read.
//
// WHAT DOES NOT PARTICIPATE. A tripped emitter takes part in NO term — nothing it
// touches heats it, cools it, or conducts with it — and bleeds at
// `TRIP_HEAT / TRIP_TIME` instead. A tower whose thermal faculty is held by
// `setTowerThermal(id, false)` takes part in none either. Both readings run in
// BOTH DIRECTIONS: conduction is one flow shared by two towers, so holding one
// tower's part holds the flow, and its neighbour neither gains from it nor gives
// to it. An edge-tile facing either of them still faces a tower, so it sheds
// nothing to air — being thermally inert is not the same as being open floor.

import {
  BASE_K,
  COND_K,
  FORGE_K,
  MAX_HEAT_MULT,
  MIN_HEAT_MULT,
  RAD_K,
  TOWER_DEFS,
  TRIP_HEAT,
  TRIP_TIME,
  emitterStats,
  moverOutput,
} from "./constants";
import {
  edgeTiles,
  footprintTiles,
  isEmitter,
  onGrid,
  tileKey,
  worldRadiators,
} from "./geometry";
import type { MeltdownSnapshot, TowerSnapshot, TowerType } from "./surface";

/**
 * One tower on the floor, as the heat model needs it.
 *
 * Everything here is either posed by the check or reported by `snapshot()` as a
 * DECLARED field of the state — never a figure the build derived. `redline`,
 * `mass`, `heatPerShot` and a mover's `output` are read out of `constants.ts`
 * below, so a build that reports the wrong redline is caught by the item about
 * the redline rather than quietly having its own number used against it.
 */
export interface Placed {
  id: number;
  type: TowerType;
  col: number;
  row: number;
  rotation: number;
  level: number;
  heat: number;
  tripped: boolean;
  thermalEnabled: boolean;
}

/** The floor as the heat model reads it, from a snapshot. */
export function floorOf(snapshot: MeltdownSnapshot): Placed[] {
  return snapshot.towers.map(placedOf);
}

/** One reported tower as the heat model reads it. */
export function placedOf(tower: TowerSnapshot): Placed {
  return {
    id: tower.id,
    type: tower.type,
    col: tower.col,
    row: tower.row,
    rotation: tower.rotation,
    level: tower.level,
    heat: tower.heat,
    tripped: tower.tripped,
    thermalEnabled: tower.thermalEnabled,
  };
}

/** The thermal mass that divides every change to a tower's heat. */
export function massOf(type: TowerType): number {
  const def = TOWER_DEFS[type];
  return def.kind === "emitter" ? def.mass : 1;
}

/** The redline `specs/towers.md` gives this tower. An upgrade never moves it. */
export function redlineOf(type: TowerType): number {
  const def = TOWER_DEFS[type];
  return def.kind === "emitter" ? def.redline : 0;
}

/** The heat one shot adds, before mass divides it, at this level. */
export function heatPerShotOf(type: TowerType, level: number): number {
  const def = TOWER_DEFS[type];
  return def.kind === "emitter" ? emitterStats(def, level).heatPerShot : 0;
}

/** A Forge's setpoint or a Sink's per-shared-edge cooling, at this level. */
export function outputOf(type: TowerType, level: number): number {
  if (type !== "forge" && type !== "sink") return 0;
  return moverOutput(type, level);
}

/**
 * The heat multiplier at heat `H` against redline `R` (specs/heat.md, Heat is
 * damage): quadratic to the redline, then flat across the plateau to `100`.
 */
export function heatMultiplierOf(heat: number, redline: number): number {
  const ramp = Math.min(heat, redline) / redline;
  return MIN_HEAT_MULT + (MAX_HEAT_MULT - MIN_HEAT_MULT) * ramp * ramp;
}

/** How a footprint's perimeter edge-tiles are classified, for one tower. */
export interface Faces {
  /** Edge-tiles on a radiator face whose outside is air. */
  radiator: number;
  /** Edge-tiles on any other face whose outside is air. */
  plain: number;
  /** For each other tower, by id, how many edge-tiles this one abuts it along. */
  shared: Map<number, number>;
}

/** Which tower stands on each occupied tile, by tile key. */
function occupancyOf(floor: readonly Placed[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const tower of floor) {
    for (const tile of footprintTiles(tower.type, tower.col, tower.row)) {
      map.set(tileKey(tile), tower.id);
    }
  }
  return map;
}

/**
 * Classify every perimeter edge-tile of `tower` by what lies immediately outside
 * it: open floor, an opening, or the casing sheds to air; another tower conducts
 * or exchanges and sheds nothing (specs/heat.md).
 *
 * A tile off the grid is the casing, which is air.
 */
export function facesOf(floor: readonly Placed[], id: number): Faces {
  const map = occupancyOf(floor);
  const tower = towerOf(floor, id);
  const radiators = new Set(worldRadiators(tower.type, tower.rotation));
  const shared = new Map<number, number>();
  let radiator = 0;
  let plain = 0;
  for (const edge of edgeTiles(tower.type, tower.col, tower.row)) {
    const held = onGrid(edge.outCol, edge.outRow)
      ? map.get(`${edge.outCol},${edge.outRow}`)
      : undefined;
    if (held !== undefined && held !== id) {
      shared.set(held, (shared.get(held) ?? 0) + 1);
      continue;
    }
    if (radiators.has(edge.face)) radiator += 1;
    else plain += 1;
  }
  return { radiator, plain, shared };
}

/** How many edge-tiles towers `a` and `b` abut along. A corner shares none. */
export function sharedEdges(
  floor: readonly Placed[],
  a: number,
  b: number,
): number {
  return facesOf(floor, a).shared.get(b) ?? 0;
}

/** The tower on `floor` with that id. */
function towerOf(floor: readonly Placed[], id: number): Placed {
  const found = floor.find((tower) => tower.id === id);
  if (found === undefined) {
    throw new Error(`meltdown thermal.ts: no tower ${id} on the posed floor`);
  }
  return found;
}

/**
 * Whether a tower takes part in the frame's resolution at all, in either
 * direction.
 */
function participates(tower: Placed): boolean {
  return tower.thermalEnabled && !tower.tripped;
}

/** The four flows and the shot heat, for one tower, over one frame. */
export interface Terms {
  airLoss: number;
  conduct: number;
  forgeGain: number;
  sinkLoss: number;
  shotGain: number;
  /** The whole change, mass already divided in: what the frame adds to `heat`. */
  delta: number;
}

/**
 * Every term of one frame of duration `dt`, for the emitter `id`, computed from
 * the heats the frame OPENED with.
 *
 * `shots` is how many shots each tower resolved during the frame, by id, which
 * `specs/combat.md` fixes. A thermal scenario poses `setTowerFiring(id, false)`
 * and passes none.
 */
export function termsFor(
  floor: readonly Placed[],
  id: number,
  dt: number,
  shots: ReadonlyMap<number, number> = new Map(),
): Terms {
  const tower = towerOf(floor, id);
  const zero: Terms = {
    airLoss: 0,
    conduct: 0,
    forgeGain: 0,
    sinkLoss: 0,
    shotGain: 0,
    delta: 0,
  };
  if (!isEmitter(tower.type) || !participates(tower)) return zero;

  const face = facesOf(floor, id);
  const heat = tower.heat;
  const airLoss = (RAD_K * face.radiator + BASE_K * face.plain) * (heat / 100);
  let conduct = 0;
  let forgeGain = 0;
  let sinkLoss = 0;
  for (const [other, edges] of face.shared) {
    const neighbour = towerOf(floor, other);
    if (!participates(neighbour)) continue;
    if (isEmitter(neighbour.type)) {
      conduct += COND_K * edges * (neighbour.heat - heat);
    } else if (neighbour.type === "forge") {
      forgeGain +=
        FORGE_K *
        edges *
        Math.max(0, outputOf(neighbour.type, neighbour.level) - heat);
    } else {
      sinkLoss +=
        outputOf(neighbour.type, neighbour.level) * edges * (heat / 100);
    }
  }
  const shotGain =
    (shots.get(id) ?? 0) * heatPerShotOf(tower.type, tower.level);
  return {
    airLoss,
    conduct,
    forgeGain,
    sinkLoss,
    shotGain,
    delta:
      (shotGain + (conduct + forgeGain - airLoss - sinkLoss) * dt) /
      massOf(tower.type),
  };
}

/**
 * What specs/heat.md says one frame of duration `dt` leaves each tower's heat
 * at, by id, clamped to `[0, 100]`.
 *
 * The two phases are literal: every delta is computed from the opening heats
 * before any new heat is written, which is the whole of the rule
 * `heat.two-phase-resolution` decides.
 *
 * A tripped emitter is not resolved: it bleeds at `TRIP_HEAT / TRIP_TIME` per
 * second, whatever its faces and whatever stands beside it, until its cooldown
 * runs out. A tower whose thermal faculty is held holds its heat exactly.
 */
export function heatsAfter(
  floor: readonly Placed[],
  dt: number,
  shots: ReadonlyMap<number, number> = new Map(),
): Map<number, number> {
  const deltas = new Map<number, number>();
  for (const tower of floor) {
    deltas.set(tower.id, termsFor(floor, tower.id, dt, shots).delta);
  }
  const next = new Map<number, number>();
  for (const tower of floor) {
    if (!isEmitter(tower.type)) {
      next.set(tower.id, 0);
      continue;
    }
    if (tower.tripped) {
      next.set(
        tower.id,
        tower.thermalEnabled
          ? Math.max(0, tower.heat - (TRIP_HEAT / TRIP_TIME) * dt)
          : tower.heat,
      );
      continue;
    }
    if (!tower.thermalEnabled) {
      next.set(tower.id, tower.heat);
      continue;
    }
    next.set(
      tower.id,
      Math.max(
        0,
        Math.min(TRIP_HEAT, tower.heat + (deltas.get(tower.id) ?? 0)),
      ),
    );
  }
  return next;
}

/**
 * The heat `id` holds after `frames` frames of `dt` each, resolved by this
 * module rather than by the build.
 *
 * The whole floor is carried forward between frames, because conduction makes
 * every tower's next heat depend on its neighbours' — a per-tower closed form
 * exists only for a tower standing alone.
 *
 * It resolves the heats and nothing else: it does not cross a tower into the
 * trip, and it does not run a cooldown down. A check whose window reaches `100`
 * is about the trip, and `trip/` poses its towers with `setTowerTripped` and
 * `setTowerTripTimer` rather than manufacturing the crossing (specs/heat.md,
 * The trip).
 */
export function heatAfterFrames(
  floor: readonly Placed[],
  id: number,
  dt: number,
  frames: number,
): number {
  let held = floor.map((tower) => ({ ...tower }));
  for (let i = 0; i < frames; i += 1) {
    const heats = heatsAfter(held, dt);
    held = held.map((tower) => ({
      ...tower,
      heat: heats.get(tower.id) ?? tower.heat,
    }));
  }
  return towerOf(held, id).heat;
}

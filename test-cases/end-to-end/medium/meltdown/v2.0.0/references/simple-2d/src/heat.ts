// Meltdown — the heat model, resolved in two phases.
//
// specs/heat.md fixes the rule this module exists to obey: every term of a
// frame is computed from the heats the frame OPENED with, and only when every
// tower's change is known are the new heats written. A sequential, in-place
// pass would read some neighbours' new heats and some neighbours' old ones and
// give a different answer, so the two phases are literal here — a `deltas`
// array first, then a single write.
//
// The trip is a CROSSING: an emitter trips on the frame in which its newly
// written heat REACHES 100 having opened that frame below it. A tower already
// sitting at 100 when a frame opens and falling during it does not trip, which
// is exactly what a tower posed at 100 does, since air cooling is proportional
// to heat and is maximal there.

import {
  BASE_K,
  COLS,
  COND_K,
  FORGE_K,
  RAD_K,
  ROWS,
  TOWER_DEFS,
  TRIP_HEAT,
  TRIP_TIME,
  emitterStats,
  type Face,
} from "./constants";
import { edgeTiles, occupancy, tileIndex, worldRadiators } from "./geometry";
import { massOf, outputOf } from "./stats";
import type { TowerState } from "./game";

/** The slack every countdown comparison carries; see `src/combat.ts`. */
const EPS = 1e-9;

/** What the frame's edge classification found around one tower. */
export interface Faces {
  /** Edge-tiles on a radiator face whose outside is air. */
  readonly radiator: number;
  /** Edge-tiles on any other face whose outside is air. */
  readonly plain: number;
  /** For each other tower, how many edge-tiles this one abuts it along. */
  readonly shared: ReadonlyMap<number, number>;
}

/**
 * Classify every perimeter edge-tile of `towers[index]` by what lies
 * immediately outside it: open floor, an opening, or the casing sheds to air;
 * another tower conducts or exchanges and sheds nothing (specs/heat.md).
 */
export function facesOf(
  towers: readonly TowerState[],
  index: number,
  map: Int32Array,
): Faces {
  const tower = towers[index];
  const radiators = new Set<Face>(worldRadiators(tower.type, tower.rotation));
  const shared = new Map<number, number>();
  let radiator = 0;
  let plain = 0;
  for (const edge of edgeTiles(tower.type, tower.col, tower.row)) {
    const onGrid =
      edge.outCol >= 0 &&
      edge.outCol < COLS &&
      edge.outRow >= 0 &&
      edge.outRow < ROWS;
    const neighbour = onGrid ? map[tileIndex(edge.outCol, edge.outRow)] : -1;
    if (neighbour >= 0 && neighbour !== index) {
      shared.set(neighbour, (shared.get(neighbour) ?? 0) + 1);
      continue;
    }
    if (radiators.has(edge.face)) radiator += 1;
    else plain += 1;
  }
  return { radiator, plain, shared };
}

/**
 * Whether this tower takes part in the frame's resolution at all. A tripped
 * tower takes part in no term, and a tower whose thermal faculty is held takes
 * part in none either — in both directions, so a held neighbour neither gains
 * nor gives.
 */
function participates(tower: TowerState): boolean {
  return tower.thermalEnabled && !tower.tripped;
}

/** What one frame of the heat model leaves behind. */
export interface HeatFrame {
  readonly towers: TowerState[];
  /** True when at least one emitter crossed into the trip this frame. */
  readonly tripped: boolean;
}

/**
 * One frame of the heat model over `towers`, with `shots[i]` the number of
 * shots tower `i` resolved during it and `dt` the game time the frame advanced
 * by (specs/heat.md, A frame resolves in two phases).
 */
export function resolveHeat(
  towers: readonly TowerState[],
  shots: readonly number[],
  dt: number,
): HeatFrame {
  const map = occupancy(towers);
  const faces = towers.map((_tower, index) => facesOf(towers, index, map));
  const deltas = new Float64Array(towers.length);

  // Phase one: every term, from the heats the frame opened with.
  towers.forEach((tower, index) => {
    const def = TOWER_DEFS[tower.type];
    if (def.kind !== "emitter" || !participates(tower)) return;
    const heat = tower.heat;
    const face = faces[index];
    const airLoss =
      (RAD_K * face.radiator + BASE_K * face.plain) * (heat / 100);
    let conduct = 0;
    let forgeGain = 0;
    let sinkLoss = 0;
    for (const [other, edges] of face.shared) {
      const neighbour = towers[other];
      if (!participates(neighbour)) continue;
      if (TOWER_DEFS[neighbour.type].kind === "emitter") {
        conduct += COND_K * edges * (neighbour.heat - heat);
      } else if (neighbour.type === "forge") {
        forgeGain += FORGE_K * edges * Math.max(0, outputOf(neighbour) - heat);
      } else {
        sinkLoss += outputOf(neighbour) * edges * (heat / 100);
      }
    }
    const shotGain = shots[index] * emitterStats(def, tower.level).heatPerShot;
    deltas[index] =
      (shotGain + (conduct + forgeGain - airLoss - sinkLoss) * dt) /
      massOf(tower.type);
  });

  // Phase two: write the new heats, and only now.
  let tripped = false;
  const next = towers.map((tower, index) => {
    if (TOWER_DEFS[tower.type].kind !== "emitter") return tower;
    if (tower.tripped) return bleed(tower, dt);
    if (!tower.thermalEnabled) return tower;
    const heat = Math.max(0, Math.min(TRIP_HEAT, tower.heat + deltas[index]));
    if (tower.heat < TRIP_HEAT && heat >= TRIP_HEAT) {
      tripped = true;
      return {
        ...tower,
        heat: TRIP_HEAT,
        tripped: true,
        tripTimer: TRIP_TIME,
        firing: false,
        targeting: null,
        fireClock: 0,
      };
    }
    return { ...tower, heat };
  });
  return { towers: next, tripped };
}

/**
 * A tripped emitter bleeds to `0` at `TRIP_HEAT / TRIP_TIME` per second
 * whatever its faces and whatever stands beside it, and returns online cold
 * when its cooldown reaches `0`.
 */
function bleed(tower: TowerState, dt: number): TowerState {
  if (!tower.thermalEnabled) return tower;
  const timer = tower.tripTimer - dt;
  if (timer <= EPS) {
    return { ...tower, tripped: false, tripTimer: 0, heat: 0 };
  }
  const heat = Math.max(0, tower.heat - (TRIP_HEAT / TRIP_TIME) * dt);
  return { ...tower, tripTimer: timer, heat };
}

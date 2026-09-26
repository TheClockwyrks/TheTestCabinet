// Meltdown — the heat model, resolved in two phases.
//
// `specs/heat.md` states the rule this module IS: every flow a frame resolves
// is computed from the heats the frame OPENED with, and only when every tower's
// change is known are the new heats written, each clamped to [0, 100]. A
// per-tower pass that wrote as it went would read some neighbours' new heats
// and some neighbours' old ones, which is exactly what the rule forbids — which
// is why this runs once, from the game mode's tick, after every actor has
// ticked and the frame's shot counts are known.
//
// The trip is a CROSSING, not a value: an emitter trips on the frame in which
// its newly written heat reaches 100 having opened that frame below it. A tower
// posed at 100 opens the next frame with air cooling at its maximum, is written
// below 100, and never meets the test — which is why `setTowerTripped` exists
// and why a tower already sitting at 100 and falling does not trip.
//
// A tower whose thermal gate is off takes part in nothing: not its own cooling,
// not the conduction it would have shared, not the flow a Forge or a Sink would
// have driven through it, and not its trip. Its heat holds exactly where it was
// posed, which is what makes a combat measurement readable at a pinned heat
// (specs/instrumentation.md, the faculty gates).

import {
  BASE_K,
  COND_K,
  FORGE_K,
  RAD_K,
  TRIP_HEAT,
  TRIP_TIME,
  inBounds,
  type Face,
} from "./constants";
import {
  FACE_ORDER,
  faceOutsideTiles,
  occupancy,
  sizeOf,
  tileIndex,
} from "./geometry";
import {
  emitterDef,
  liveStats,
  massOf,
  outputOf,
  worldRadiatorsOf,
} from "./stats";
import type { MeltdownState, TowerState } from "./game";

/** How fast a tripped emitter's heat bleeds away, per second. */
export const TRIP_BLEED_RATE = TRIP_HEAT / TRIP_TIME;

/** What one emitter's faces see, counted from the floor around it. */
export interface FaceCensus {
  /** Edge-tiles on radiator faces whose outside is air. */
  radiatorEdges: number;
  /** Edge-tiles on every other face whose outside is air. */
  plainEdges: number;
  /** Shared edge-tiles with each neighbouring tower, by tower id. */
  shared: Map<number, number>;
}

/**
 * Count what each of a tower's perimeter edge-tiles faces.
 *
 * An edge-tile whose outside is open floor, an opening, or the casing sheds to
 * air; one whose outside is another tower sheds nothing and conducts or
 * exchanges instead, whatever kind that tower is and whatever state it is in.
 */
export function censusFaces(tower: TowerState, owners: Int32Array): FaceCensus {
  const size = sizeOf(tower.type);
  const radiators = new Set<Face>(worldRadiatorsOf(tower));
  const census: FaceCensus = {
    radiatorEdges: 0,
    plainEdges: 0,
    shared: new Map<number, number>(),
  };
  for (const face of FACE_ORDER) {
    const isRadiator = radiators.has(face);
    for (const tile of faceOutsideTiles(tower.col, tower.row, size, face)) {
      const owner = inBounds(tile.col, tile.row)
        ? owners[tileIndex(tile.col, tile.row)]
        : -1;
      if (owner < 0) {
        // The casing, an opening, and open floor are all air.
        if (isRadiator) census.radiatorEdges += 1;
        else census.plainEdges += 1;
      } else {
        census.shared.set(owner, (census.shared.get(owner) ?? 0) + 1);
      }
    }
  }
  return census;
}

/** Whether a tower takes part in this frame's resolution at all. */
function participates(tower: TowerState): boolean {
  return tower.thermalEnabled && !tower.tripped;
}

/** What a frame's heat pass produced, for the cues the frame owes. */
export interface HeatOutcome {
  /** Whether any emitter tripped on this frame. */
  tripped: boolean;
}

/**
 * Resolve one frame of the heat model.
 *
 * `shots` is how many shots each tower resolved during this frame, which
 * `src/combat.ts` produced from the same frame.
 */
export function resolveHeat(
  state: MeltdownState,
  dt: number,
  shots: ReadonlyMap<number, number>,
): HeatOutcome {
  const owners = occupancy(state.towers);
  const byId = new Map<number, TowerState>();
  for (const tower of state.towers) byId.set(tower.id, tower);

  // Phase one reads only these, so nothing written below can be read back.
  const opening = new Map<number, number>();
  const wasTripped = new Map<number, boolean>();
  for (const tower of state.towers) {
    opening.set(tower.id, tower.heat);
    wasTripped.set(tower.id, tower.tripped);
  }

  // A tripped emitter takes part in no term: it bleeds linearly and counts its
  // cooldown down, and returns online cold when the cooldown reaches zero.
  for (const tower of state.towers) {
    if (!tower.tripped || !tower.thermalEnabled) continue;
    tower.heat = Math.max(0, tower.heat - TRIP_BLEED_RATE * dt);
    tower.tripTimer = Math.max(0, tower.tripTimer - dt);
    if (tower.tripTimer <= 0) {
      tower.tripped = false;
      tower.tripTimer = 0;
      tower.heat = 0;
    }
  }

  // Phase one: every change computed from the heats the frame opened with.
  const changes = new Map<number, number>();
  for (const tower of state.towers) {
    const def = emitterDef(tower.type);
    if (def === null) continue;
    if (wasTripped.get(tower.id) === true) continue;
    if (!participates(tower)) continue;

    const heat = opening.get(tower.id) ?? 0;
    const census = censusFaces(tower, owners);

    const airLoss =
      (RAD_K * census.radiatorEdges + BASE_K * census.plainEdges) *
      (heat / 100);

    let conduct = 0;
    let forgeGain = 0;
    let sinkLoss = 0;
    for (const [otherId, sharedEdges] of census.shared) {
      const other = byId.get(otherId);
      if (other === undefined || !participates(other)) continue;
      if (other.type === "forge") {
        forgeGain +=
          FORGE_K * sharedEdges * Math.max(0, outputOf(other) - heat);
      } else if (other.type === "sink") {
        sinkLoss += outputOf(other) * sharedEdges * (heat / 100);
      } else {
        const otherHeat = opening.get(otherId) ?? 0;
        conduct += COND_K * sharedEdges * (otherHeat - heat);
      }
    }

    const shotGain = (shots.get(tower.id) ?? 0) * liveStats(tower).heatPerShot;

    changes.set(
      tower.id,
      (shotGain + (conduct + forgeGain - airLoss - sinkLoss) * dt) /
        massOf(tower),
    );
  }

  // Phase two: the new heats written, and the crossings taken.
  let tripped = false;
  for (const tower of state.towers) {
    const change = changes.get(tower.id);
    if (change === undefined) continue;
    const before = opening.get(tower.id) ?? 0;
    const after = Math.max(0, Math.min(TRIP_HEAT, before + change));
    tower.heat = after;
    if (after >= TRIP_HEAT && before < TRIP_HEAT) {
      tower.tripped = true;
      tower.tripTimer = TRIP_TIME;
      tower.targeting = null;
      tower.firing = false;
      tower.fireClock = 0;
      tripped = true;
    }
  }

  return { tripped };
}

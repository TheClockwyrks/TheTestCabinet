// Meltdown — the heat model, resolved in two phases (specs/heat.md).
//
// EVERY TERM IS COMPUTED FROM THE HEATS THE FRAME OPENED WITH, and only when
// every tower's change is known are the new heats written. That is the whole
// reason this is a floor-wide pass rather than something each tower does for
// itself: a tower resolving in roster order would read some neighbours' new
// heats and some neighbours' old ones, and two touching guns would then settle
// somewhere that depended on which was placed first.
//
// THE TRIP IS A CROSSING. An emitter trips on the frame in which its newly
// written heat REACHES 100 having opened that frame below it. A tower already
// sitting at 100 when a frame opens is cooling — air cooling is proportional to
// heat and maximal there — so it falls rather than crossing, and does not trip.

import {
  BASE_K,
  COND_K,
  FORGE_K,
  RAD_K,
  TRIP_HEAT,
  TRIP_TIME,
  inBounds,
} from "./constants";
import { emitterStats } from "./defs";
import { idx, perimeterEdges, type Floor } from "./grid";
import type { Tower } from "./state";
import {
  emitterDef,
  isEmitterTower,
  isRadiatorFace,
  outputOf,
  sizeOf,
} from "./towers";

/** How a tower's edges are spent: on air, or on the towers it abuts. */
export interface EdgeAccount {
  /** Edge-tiles facing air on this tower's radiator faces. */
  radiatorEdges: number;
  /** Edge-tiles facing air on its other faces. */
  plainEdges: number;
  /** Edge-tiles shared with each abutting tower, by that tower's id. */
  shared: Map<number, number>;
}

/**
 * Classify every perimeter edge-tile of a tower by what lies immediately outside
 * it: open floor, an opening, or the casing sheds to air; another tower conducts
 * or exchanges instead, and sheds nothing (specs/heat.md).
 */
export function accountEdges(tower: Tower, floor: Floor): EdgeAccount {
  const account: EdgeAccount = {
    radiatorEdges: 0,
    plainEdges: 0,
    shared: new Map(),
  };
  for (const edge of perimeterEdges(tower.col, tower.row, sizeOf(tower))) {
    const outside = inBounds(edge.oc, edge.or)
      ? floor.owner[idx(edge.oc, edge.or)]
      : -1;
    if (outside >= 0 && outside !== tower.id) {
      account.shared.set(outside, (account.shared.get(outside) ?? 0) + 1);
      continue;
    }
    if (isRadiatorFace(tower, edge.side)) account.radiatorEdges += 1;
    else account.plainEdges += 1;
  }
  return account;
}

/** Whether a tower takes part in this frame's resolution at all. */
function participates(tower: Tower): boolean {
  return tower.thermalEnabled && !tower.tripped;
}

/**
 * Advance every tower's heat by one frame of `dt` seconds and return the ids of
 * the emitters that tripped on it.
 *
 * `shotsFired` is how many shots each tower resolved during this frame, which
 * `src/combat.ts` counted before this pass ran.
 */
export function resolveHeat(
  towers: readonly Tower[],
  floor: Floor,
  dt: number,
  shotsFired: ReadonlyMap<number, number>,
): number[] {
  const byId = new Map<number, Tower>();
  for (const tower of towers) byId.set(tower.id, tower);

  // Phase one: every change, computed from the heats the frame opened with.
  const opened = new Map<number, number>();
  const deltas = new Map<number, number>();
  for (const tower of towers) opened.set(tower.id, tower.heat);

  for (const tower of towers) {
    if (!participates(tower)) continue;
    const def = emitterDef(tower);
    if (def === null) continue;
    const stats = emitterStats(def, tower.level);

    const heat = tower.heat;
    const account = accountEdges(tower, floor);

    const airLoss =
      (RAD_K * account.radiatorEdges + BASE_K * account.plainEdges) *
      (heat / TRIP_HEAT);

    let conduct = 0;
    let forgeGain = 0;
    let sinkLoss = 0;
    for (const [id, edges] of account.shared) {
      const other = byId.get(id);
      if (other === undefined || !participates(other)) continue;
      if (isEmitterTower(other)) {
        conduct += COND_K * edges * ((opened.get(id) ?? 0) - heat);
      } else if (other.type === "forge") {
        forgeGain += FORGE_K * edges * Math.max(0, outputOf(other) - heat);
      } else {
        sinkLoss += outputOf(other) * edges * (heat / TRIP_HEAT);
      }
    }

    const shotGain = (shotsFired.get(tower.id) ?? 0) * stats.heatPerShot;
    deltas.set(
      tower.id,
      (shotGain + (conduct + forgeGain - airLoss - sinkLoss) * dt) / def.mass,
    );
  }

  // Phase two: write the new heats, and take the crossings as they are written.
  const tripped: number[] = [];
  for (const tower of towers) {
    if (tower.tripped) {
      if (!tower.thermalEnabled) continue;
      tower.heat = Math.max(0, tower.heat - (TRIP_HEAT / TRIP_TIME) * dt);
      tower.tripTimer -= dt;
      if (tower.tripTimer <= 0) {
        tower.tripped = false;
        tower.tripTimer = 0;
        tower.heat = 0;
      }
      continue;
    }
    const delta = deltas.get(tower.id);
    if (delta === undefined) continue;
    const before = tower.heat;
    const after = Math.min(TRIP_HEAT, Math.max(0, before + delta));
    tower.heat = after;
    if (before < TRIP_HEAT && after >= TRIP_HEAT) {
      tower.tripped = true;
      tower.tripTimer = TRIP_TIME;
      tower.targeting = null;
      tower.firing = false;
      tripped.push(tower.id);
    }
  }
  return tripped;
}

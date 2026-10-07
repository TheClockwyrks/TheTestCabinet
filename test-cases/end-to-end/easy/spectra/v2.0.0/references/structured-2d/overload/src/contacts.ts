// Spectra — the order a sub-step resolves in (specs/simulation.md).
//
// Every contactable thing is a circle about its centre, of the half-extent its
// own spec states, and a contact is an overlap of two such circles tested at the
// end of each sub-step. After every position has advanced, one sub-step resolves
// in exactly this order:
//
//   1. Each of the player's bullets against every drone, nearest drone first. A
//      contact consumes the bullet and applies `specs/bands.md`'s rule.
//   2. Each enemy bullet against the ship. A contact consumes the bullet and
//      applies the shield rule.
//   3. Each drone's body against the ship.
//   4. The live discharge wave against the drones and the enemy bullets it has
//      reached.
//   5. Everything marked for removal leaves its roster, and every destroyed drone
//      starts its drone-burst.
//
// The ship's contact test — steps two and three — is what `setShipContact` gates,
// and it is skipped whole while the gate is off and through the `ready` hold, when
// nothing costs a further life.

import {
  ENEMY_BULLET_HALF,
  PLAYER_BULLET_HALF,
  SHIP_HALF,
  SHIP_Y,
  RESONANCE_ABSORB,
  isChallengeStage,
} from "./constants";
import { shieldAbsorbs, shimmering, shotMatches } from "./bands";
import { applyRemoval, fillMeter, noRemoval, takeLayer } from "./destroy";
import { droneHalf } from "./drones";
import { resolveDischarge } from "./discharge";
import { loseLife } from "./flow";
import { applyMismatch } from "./overload";
import type { FrameCues } from "./audio";
import type { BulletState, DroneState, SpectraState } from "./game";

/** Whether two circles about their centres overlap. */
export function overlaps(
  ax: number,
  ay: number,
  ar: number,
  bx: number,
  by: number,
  br: number,
): boolean {
  return Math.hypot(ax - bx, ay - by) <= ar + br;
}

/** The drones one of the player's bullets is touching, nearest first. */
function touchedDrones(state: SpectraState, bullet: BulletState): DroneState[] {
  return state.drones
    .filter((drone) =>
      overlaps(
        bullet.x,
        bullet.y,
        PLAYER_BULLET_HALF,
        drone.x,
        drone.y,
        droneHalf(drone),
      ),
    )
    .sort(
      (left, right) =>
        Math.hypot(left.x - bullet.x, left.y - bullet.y) -
        Math.hypot(right.x - bullet.x, right.y - bullet.y),
    );
}

/** Step one: the player's bullets against the drones. */
function resolvePlayerBullets(
  state: SpectraState,
  removal: ReturnType<typeof noRemoval>,
  cues: FrameCues,
): void {
  for (const bullet of state.bullets) {
    if (!bullet.friendly) continue;
    if (removal.bullets.has(bullet.id)) continue;

    for (const drone of touchedDrones(state, bullet)) {
      if (removal.drones.has(drone.id)) continue;

      removal.bullets.add(bullet.id);
      if (shotMatches(bullet, drone, state)) {
        takeLayer(state, drone, removal, true);
        cues.kill = true;
      } else if (!shimmering(drone, state.stage)) {
        // The mode owns what else a mismatch does to the drone it hit.
        applyMismatch(state, drone, cues);
      }
      break;
    }
  }
}

/** Whether the ship's contact test runs at all this sub-step. */
function contactRuns(state: SpectraState): boolean {
  return state.ship.contact && state.phase === "live";
}

/** Step two: the enemy bullets against the ship. */
function resolveEnemyBullets(
  state: SpectraState,
  removal: ReturnType<typeof noRemoval>,
  cues: FrameCues,
): void {
  for (const bullet of state.bullets) {
    if (bullet.friendly) continue;
    if (removal.bullets.has(bullet.id)) continue;
    if (!contactRuns(state)) return;
    if (
      !overlaps(
        bullet.x,
        bullet.y,
        ENEMY_BULLET_HALF,
        state.ship.x,
        SHIP_Y,
        SHIP_HALF,
      )
    ) {
      continue;
    }

    removal.bullets.add(bullet.id);
    if (shieldAbsorbs(bullet, state)) {
      fillMeter(state, RESONANCE_ABSORB);
      cues.absorb = true;
      continue;
    }
    loseLife(state, cues);
    return;
  }
}

/** Step three: the drone bodies against the ship. */
function resolveBodies(state: SpectraState, cues: FrameCues): void {
  if (isChallengeStage(state.stage)) return;
  for (const drone of state.drones) {
    if (!contactRuns(state)) return;
    if (
      !overlaps(
        drone.x,
        drone.y,
        droneHalf(drone),
        state.ship.x,
        SHIP_Y,
        SHIP_HALF,
      )
    ) {
      continue;
    }
    loseLife(state, cues);
    return;
  }
}

/**
 * Resolve one sub-step's contacts in the stated order, and return how many drones
 * were removed — which is what `specs/stages.md`'s clear rule turns on.
 */
export function resolveContacts(state: SpectraState, cues: FrameCues): number {
  const removal = noRemoval();
  resolvePlayerBullets(state, removal, cues);
  resolveEnemyBullets(state, removal, cues);
  resolveBodies(state, cues);
  resolveDischarge(state, removal);
  return applyRemoval(state, removal);
}

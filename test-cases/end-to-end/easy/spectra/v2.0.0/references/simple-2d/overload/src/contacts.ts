// Spectra — what a contact does, in the order `specs/simulation.md` fixes.
//
// Every contactable thing is a circle about its centre, of the half-extent its own
// spec states, and a contact is an overlap of two such circles tested at the end of
// each sub-step. The discharge wave is the one exception: it is a circle centred on
// the ship whose radius grows over the wave's life, and it reaches a thing when that
// thing's centre lies inside that radius.
//
// One sub-step resolves in five steps, and they run here in that order:
//
//   1. Each of the player's bullets against every drone, nearest drone first.
//   2. Each enemy bullet against the ship.
//   3. Each drone's body against the ship.
//   4. The live discharge wave against the drones and the enemy bullets it reached.
//   5. Everything marked for removal leaves its roster, and every destroyed drone
//      starts its drone-burst.
//
// One event costs exactly one life, whatever else is on the field at that instant,
// which is why the ship's two contact steps stop at the first life lost.

import {
  CUES,
  ENEMY_BULLET_HALF,
  PLAYER_BULLET_HALF,
  PRISM_SIZE,
  RESONANCE_ABSORB,
  RESONANCE_KILL,
  SHIP_HALF,
  SHIP_Y,
  isChallengeStage,
} from "./constants";
import {
  droneFootprint,
  droneHalf,
  effectiveBulletBand,
  shipAlive,
  shimmering,
  shotDestroys,
} from "./bands";
import { addBurst } from "./bursts";
import { ofWave } from "./drones";
import { dischargeSpent, endDischarge, fillResonance } from "./discharge";
import { loseLife } from "./flow";
import { chargeDrone } from "./overload";
import { addScore, killValue, shellValue } from "./scoring";
import type { FrameEvents, MutBullet, MutDrone, Sim } from "./sim";

/** Whether two circles about their centres overlap. */
function overlaps(
  ax: number,
  ay: number,
  ar: number,
  bx: number,
  by: number,
  br: number,
): boolean {
  return Math.hypot(ax - bx, ay - by) < ar + br;
}

/**
 * Take the drone off the field: it pays its figure, it pops, and it leaves the
 * roster.
 *
 * The meter is not filled here. `specs/resonance.md` fills it on a matching shot
 * alone, so the caller that fired one adds it.
 */
export function destroyDrone(sim: Sim, drone: MutDrone, ev: FrameEvents): void {
  addScore(sim, killValue(sim, drone));
  if (isChallengeStage(sim.stage)) sim.challengeHits += 1;
  addBurst(sim, drone.x, drone.y, droneFootprint(drone));
  sim.drones = sim.drones.filter((candidate) => candidate !== drone);
  if (ofWave(drone)) ev.waveDronesRemoved += 1;
}

/** What one of the player's bullets does to the drone it reached. */
function resolveShot(
  sim: Sim,
  bullet: MutBullet,
  drone: MutDrone,
  ev: FrameEvents,
): void {
  const band = effectiveBulletBand(bullet, sim.inversion);
  if (!shotDestroys(band, drone, sim.stage, sim.inversion)) {
    // A wrong-band shot feeds the drone. A shimmering Flux has no band to
    // mismatch, so it takes no charge.
    if (!shimmering(drone, sim.stage)) chargeDrone(sim, drone, ev);
    return;
  }

  ev.cues.add(CUES.kill);
  if (drone.kind === "prism" && drone.shellAlive) {
    // The shell falls and the core is exposed. The Prism lives, and a shell
    // fills nothing.
    drone.shellAlive = false;
    addScore(sim, shellValue());
    addBurst(sim, drone.x, drone.y, PRISM_SIZE);
    return;
  }
  fillResonance(sim, RESONANCE_KILL);
  destroyDrone(sim, drone, ev);
}

/** Step 1: each of the player's bullets against every drone, nearest first. */
function resolvePlayerBullets(sim: Sim, ev: FrameEvents): void {
  const consumed = new Set<number>();
  for (const bullet of sim.bullets.filter((entry) => entry.friendly)) {
    let nearest: MutDrone | undefined;
    let best = Infinity;
    for (const drone of sim.drones) {
      if (
        !overlaps(
          bullet.x,
          bullet.y,
          PLAYER_BULLET_HALF,
          drone.x,
          drone.y,
          droneHalf(drone),
        )
      ) {
        continue;
      }
      const distance = Math.hypot(bullet.x - drone.x, bullet.y - drone.y);
      if (distance < best) {
        best = distance;
        nearest = drone;
      }
    }
    if (nearest === undefined) continue;
    // A mismatched shot is consumed on contact rather than passing through.
    consumed.add(bullet.id);
    resolveShot(sim, bullet, nearest, ev);
  }
  if (consumed.size > 0) {
    sim.bullets = sim.bullets.filter((entry) => !consumed.has(entry.id));
  }
}

/** Step 2: each enemy bullet against the ship. Reports whether a life was lost. */
function resolveEnemyFire(sim: Sim, ev: FrameEvents): boolean {
  for (const bullet of sim.bullets.filter((entry) => !entry.friendly)) {
    if (
      !overlaps(
        bullet.x,
        bullet.y,
        ENEMY_BULLET_HALF,
        sim.ship.x,
        SHIP_Y,
        SHIP_HALF,
      )
    ) {
      continue;
    }
    sim.bullets = sim.bullets.filter((entry) => entry.id !== bullet.id);
    if (effectiveBulletBand(bullet, sim.inversion) === sim.ship.band) {
      // The hull absorbs a bullet of its own band.
      fillResonance(sim, RESONANCE_ABSORB);
      ev.cues.add(CUES.absorb);
      continue;
    }
    loseLife(sim, ev);
    return true;
  }
  return false;
}

/** Step 3: each drone's body against the ship. */
function resolveBodies(sim: Sim, ev: FrameEvents): void {
  // A challenge drone's body costs no life.
  if (isChallengeStage(sim.stage)) return;
  for (const drone of sim.drones) {
    if (
      overlaps(
        drone.x,
        drone.y,
        droneHalf(drone),
        sim.ship.x,
        SHIP_Y,
        SHIP_HALF,
      )
    ) {
      // A body is never filtered by the shield, of either band.
      loseLife(sim, ev);
      return;
    }
  }
}

/** Step 4: the live discharge wave against what it has reached. */
function resolveDischarge(sim: Sim, ev: FrameEvents): void {
  if (!sim.discharge.active) return;
  const radius = sim.discharge.radius;
  const reached = (x: number, y: number): boolean =>
    Math.hypot(x - sim.ship.x, y - SHIP_Y) <= radius;

  // The wave is band-blind, and it spares the assembled formation.
  const taken = sim.drones.filter(
    (drone) => drone.phase !== "formation" && reached(drone.x, drone.y),
  );
  for (const drone of taken) destroyDrone(sim, drone, ev);
  sim.bullets = sim.bullets.filter(
    (bullet) => bullet.friendly || !reached(bullet.x, bullet.y),
  );

  if (dischargeSpent(sim)) endDischarge(sim);
}

/** Resolve every contact of one sub-step, in order. */
export function resolveContacts(sim: Sim, ev: FrameEvents): void {
  resolvePlayerBullets(sim, ev);
  if (sim.ship.contact && shipAlive(sim.phase)) {
    if (!resolveEnemyFire(sim, ev)) resolveBodies(sim, ev);
  }
  resolveDischarge(sim, ev);
}

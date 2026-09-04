// Spectra — what a contact does, resolved in the order the frame states.
//
// `specs/simulation.md` fixes the order a sub-step resolves in, and this file is
// that order, once, in one function. Everything contactable is a circle about its
// centre of the half-extent its own spec states, and a contact is an overlap of two
// such circles tested at the end of the sub-step; the discharge wave is the one
// exception, and it reaches a thing when that thing's CENTRE lies inside the wave's
// current radius.
//
//   1. Each of the player's bullets against every drone, nearest drone first.
//   2. Each enemy bullet against the ship.
//   3. Each drone's body against the ship.
//   4. The live discharge wave against the drones and the enemy bullets it reached.
//   5. Everything marked for removal leaves its roster, and every destroyed drone
//      starts its drone-burst.
//
// Steps 1 to 4 MARK and step 5 REMOVES, which is what makes "nearest drone first"
// and "one event costs exactly one life" true rather than dependent on roster order.
//
// WHAT A SHOT DECIDES IS TWO EFFECTIVE BANDS AND NOTHING ELSE. A match destroys the
// exposed layer; a mismatch destroys nothing and hands the drone to
// `specs/mode.md`'s rule in `src/mode.ts`. Either way the bullet is consumed.

import {
  CUES,
  PLAYER_BULLET_HALF,
  ENEMY_BULLET_HALF,
  RESONANCE_ABSORB,
  RESONANCE_KILL,
  SHIP_HALF,
  SHIP_Y,
  droneHalf,
  droneSize,
} from "./constants";
import { bulletEffectiveBand, droneEffectiveBand } from "./bands";
import { shimmering } from "./drones";
import { startBurst } from "./bursts";
import { chargeOnMismatch } from "./mode";
import { contactLive, loseLife } from "./progression";
import { fillMeter } from "./resonance";
import { award, scoreForDrone, scoreForShell } from "./scoring";
import { closeStageIfWaveGone } from "./stages";
import { takeId } from "./entities";
import type { CueSink } from "./audio";
import type { Bullet, Drone, SpectraState } from "./types";

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

/** One drone-burst the sub-step owes, held until removals are applied. */
interface Pop {
  x: number;
  y: number;
  size: number;
}

/** What the sub-step has decided, before any roster is touched. */
interface Marks {
  drones: Set<number>;
  bullets: Set<number>;
  pops: Pop[];
}

/** Resolve every contact of one sub-step, in the order `specs/simulation.md` fixes. */
export function resolveContacts(state: SpectraState, cues: CueSink): void {
  const inverted = state.inversion > 0;
  const marks: Marks = { drones: new Set(), bullets: new Set(), pops: [] };

  shotsAgainstDrones(state, marks, inverted, cues);
  enemyFireAgainstShip(state, marks, inverted, cues);
  bodiesAgainstShip(state, marks, cues);
  dischargeAgainstField(state, marks, cues);
  applyMarks(state, marks, cues);
}

/** Step 1: each of the player's bullets against every drone, nearest first. */
function shotsAgainstDrones(
  state: SpectraState,
  marks: Marks,
  inverted: boolean,
  cues: CueSink,
): void {
  for (const bullet of state.bullets) {
    if (!bullet.friendly || marks.bullets.has(bullet.id)) continue;
    const hit = nearestHit(state, marks, bullet);
    if (hit === undefined) continue;
    // Consumed on contact rather than passing through, whatever the outcome.
    marks.bullets.add(bullet.id);
    applyShot(state, marks, bullet, hit, inverted, cues);
  }
}

/** The nearest drone `bullet` overlaps that is not already marked. */
function nearestHit(
  state: SpectraState,
  marks: Marks,
  bullet: Bullet,
): Drone | undefined {
  let nearest: Drone | undefined;
  let best = Number.POSITIVE_INFINITY;
  for (const drone of state.drones) {
    if (marks.drones.has(drone.id)) continue;
    const half = droneHalf(drone.kind, drone.shellAlive);
    if (
      !overlaps(bullet.x, bullet.y, PLAYER_BULLET_HALF, drone.x, drone.y, half)
    ) {
      continue;
    }
    const distance = Math.hypot(bullet.x - drone.x, bullet.y - drone.y);
    if (distance < best) {
      best = distance;
      nearest = drone;
    }
  }
  return nearest;
}

/** What one of the player's bullets does to the drone it reached. */
function applyShot(
  state: SpectraState,
  marks: Marks,
  bullet: Bullet,
  drone: Drone,
  inverted: boolean,
  cues: CueSink,
): void {
  // A shimmering Flux is settled on neither band: no shot destroys it and none
  // charges it, whatever band the shot carries. The bullet is consumed all the
  // same, which the caller has already done.
  if (shimmering(drone, state.stage)) return;
  const shot = bulletEffectiveBand(bullet, inverted);
  const target = droneEffectiveBand(drone, inverted, state.stage);
  if (shot !== target) {
    chargeOnMismatch(state, drone, cues);
    return;
  }
  cues.raise(CUES.kill);
  if (drone.kind === "prism" && drone.shellAlive) {
    // The shell falls and the Prism lives on with its core exposed, keeping its id.
    // Breaking a shell adds nothing to the meter.
    drone.shellAlive = false;
    award(state, scoreForShell());
    marks.pops.push({ x: drone.x, y: drone.y, size: droneSize("prism", true) });
    return;
  }
  destroy(state, marks, drone);
  fillMeter(state, RESONANCE_KILL);
}

/** Mark a drone destroyed, paying its figure and owing its pop. */
function destroy(state: SpectraState, marks: Marks, drone: Drone): void {
  marks.drones.add(drone.id);
  award(state, scoreForDrone(drone));
  if (drone.challenge) state.challengeHits += 1;
  marks.pops.push({
    x: drone.x,
    y: drone.y,
    size: droneSize(drone.kind, drone.shellAlive),
  });
}

/** Step 2: each enemy bullet against the ship, filtered by the shield. */
function enemyFireAgainstShip(
  state: SpectraState,
  marks: Marks,
  inverted: boolean,
  cues: CueSink,
): void {
  if (!contactLive(state)) return;
  for (const bullet of state.bullets) {
    if (bullet.friendly || marks.bullets.has(bullet.id)) continue;
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
    marks.bullets.add(bullet.id);
    if (bulletEffectiveBand(bullet, inverted) === state.ship.band) {
      // Absorbed by the hull's own band: the ship is unharmed and the meter fills.
      fillMeter(state, RESONANCE_ABSORB);
      cues.raise(CUES.absorb);
      continue;
    }
    loseLife(state, cues);
    return;
  }
}

/** Step 3: each drone's body against the ship, which the shield does not filter. */
function bodiesAgainstShip(
  state: SpectraState,
  marks: Marks,
  cues: CueSink,
): void {
  if (!contactLive(state)) return;
  for (const drone of state.drones) {
    if (marks.drones.has(drone.id)) continue;
    // A challenge drone's body costs no life: contact with one does nothing.
    if (drone.challenge) continue;
    const half = droneHalf(drone.kind, drone.shellAlive);
    if (!overlaps(drone.x, drone.y, half, state.ship.x, SHIP_Y, SHIP_HALF))
      continue;
    loseLife(state, cues);
    return;
  }
}

/** Step 4: the live discharge wave, which is band-blind. */
function dischargeAgainstField(
  state: SpectraState,
  marks: Marks,
  _cues: CueSink,
): void {
  const wave = state.discharge;
  if (!wave.active) return;
  const reaches = (x: number, y: number): boolean =>
    Math.hypot(x - state.ship.x, y - SHIP_Y) <= wave.radius;
  for (const drone of state.drones) {
    if (marks.drones.has(drone.id)) continue;
    // A drone resting in the formation is spared.
    if (drone.phase === "formation") continue;
    if (!reaches(drone.x, drone.y)) continue;
    if (drone.kind === "prism" && drone.shellAlive) {
      // Destroyed whole, shell and core together, in one step: it pays both.
      award(state, scoreForShell());
    }
    destroy(state, marks, drone);
  }
  for (const bullet of state.bullets) {
    if (bullet.friendly || marks.bullets.has(bullet.id)) continue;
    if (reaches(bullet.x, bullet.y)) marks.bullets.add(bullet.id);
  }
}

/** Step 5: apply every removal, start every pop, and close the stage if it is over. */
function applyMarks(state: SpectraState, marks: Marks, cues: CueSink): void {
  if (marks.bullets.size > 0) {
    state.bullets = state.bullets.filter(
      (bullet) => !marks.bullets.has(bullet.id),
    );
  }
  if (marks.drones.size > 0) {
    state.drones = state.drones.filter((drone) => !marks.drones.has(drone.id));
  }
  for (const pop of marks.pops) {
    startBurst(state, takeId(state), pop.x, pop.y, pop.size);
  }
  if (marks.drones.size > 0) closeStageIfWaveGone(state, cues);
}

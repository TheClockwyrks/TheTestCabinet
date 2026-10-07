// Spectra — building and removing the things on the field.
//
// One place hands out ids and one place builds a drone, a bullet or a burst, so the
// two identity rules `specs/instrumentation.md` states hold everywhere by
// construction rather than by everyone remembering them:
//
//   * an entity added is APPENDED to its roster, so it is the last entry and its id
//     is read from there;
//   * an id is never reused while its holder is alive, and an entity keeps its id
//     for its whole life, across every frame and every phase change — a Prism that
//     loses its shell keeps its id.
//
// The debug surface adds entities through exactly these functions, which is why a
// posed drone is indistinguishable from one the wave brought in.

import {
  ENEMY_BULLET_SPEED,
  PLAYER_BULLET_SPEED,
  bulletSpeedScale,
} from "./constants";
import type { Band, Bullet, Drone, DroneKind, SpectraState } from "./types";

/** The next id, advancing the state's counter. */
export function takeId(state: SpectraState): number {
  const id = state.nextId;
  state.nextId += 1;
  return id;
}

/** What `addDrone` and the wave builder agree a fresh drone starts as. */
export interface DroneSeed {
  kind: DroneKind;
  x: number;
  y: number;
  band?: Band;
  slotX?: number;
  slotY?: number;
  group?: number;
  released?: boolean;
  phase?: Drone["phase"];
  challenge?: boolean;
  travel?: boolean;
  oscillation?: boolean;
  fire?: boolean;
  bandClock?: number;
  ofWave?: boolean;
}

/**
 * Build one drone.
 *
 * The defaults are `addDrone`'s contract: band `cyan`, phase `formation`, the slot
 * at the position it was placed, band clock `0`, shell intact, charge `0`, and all
 * three faculties on.
 */
export function makeDrone(state: SpectraState, seed: DroneSeed): Drone {
  return {
    id: takeId(state),
    kind: seed.kind,
    band: seed.band ?? "cyan",
    x: seed.x,
    y: seed.y,
    phase: seed.phase ?? "formation",
    phaseTime: 0,
    slotX: seed.slotX ?? seed.x,
    slotY: seed.slotY ?? seed.y,
    group: seed.group ?? 0,
    released: seed.released ?? true,
    path: null,
    pathDist: 0,
    bandClock: seed.bandClock ?? 0,
    shellAlive: true,
    diveShots: 0,
    fireArmed: false,
    invertedThisDive: false,
    travel: seed.travel ?? true,
    oscillation: seed.oscillation ?? true,
    fire: seed.fire ?? true,
    charge: 0,
    challenge: seed.challenge ?? false,
    ofWave: seed.ofWave ?? false,
    plunge: false,
  };
}

/** Append one drone to the roster and return it. */
export function addDrone(state: SpectraState, seed: DroneSeed): Drone {
  const drone = makeDrone(state, seed);
  state.drones.push(drone);
  return drone;
}

/** Append one of the player's bullets, climbing at its own speed. */
export function addPlayerBullet(
  state: SpectraState,
  x: number,
  y: number,
  band: Band,
): Bullet {
  const bullet: Bullet = {
    id: takeId(state),
    x,
    y,
    vx: 0,
    vy: -PLAYER_BULLET_SPEED,
    band,
    friendly: true,
  };
  state.bullets.push(bullet);
  return bullet;
}

/** Append one enemy bullet, falling at the current stage's own speed. */
export function addEnemyBullet(
  state: SpectraState,
  x: number,
  y: number,
  band: Band,
): Bullet {
  const bullet: Bullet = {
    id: takeId(state),
    x,
    y,
    vx: 0,
    vy: ENEMY_BULLET_SPEED * bulletSpeedScale(state.stage),
    band,
    friendly: false,
  };
  state.bullets.push(bullet);
  return bullet;
}

/**
 * Append one enemy bullet on a heading `degrees` off straight down.
 *
 * Only `specs/mode.md`'s overloaded Flux spray uses it: every other enemy bullet
 * falls straight down, as `specs/swarm.md` states.
 */
export function addFannedEnemyBullet(
  state: SpectraState,
  x: number,
  y: number,
  band: Band,
  degrees: number,
): Bullet {
  const bullet = addEnemyBullet(state, x, y, band);
  const speed = Math.hypot(bullet.vx, bullet.vy);
  const radians = (degrees * Math.PI) / 180;
  bullet.vx = speed * Math.sin(radians);
  bullet.vy = speed * Math.cos(radians);
  return bullet;
}

/** The drone with that id, or `undefined`. */
export function findDrone(state: SpectraState, id: number): Drone | undefined {
  return state.drones.find((drone) => drone.id === id);
}

/** The bullet with that id, of either kind, or `undefined`. */
export function findBullet(
  state: SpectraState,
  id: number,
): Bullet | undefined {
  return state.bullets.find((bullet) => bullet.id === id);
}

/** Remove the drone with that id. */
export function removeDroneById(state: SpectraState, id: number): void {
  const at = state.drones.findIndex((drone) => drone.id === id);
  if (at >= 0) state.drones.splice(at, 1);
}

/** Remove the bullet with that id. */
export function removeBulletById(state: SpectraState, id: number): void {
  const at = state.bullets.findIndex((bullet) => bullet.id === id);
  if (at >= 0) state.bullets.splice(at, 1);
}

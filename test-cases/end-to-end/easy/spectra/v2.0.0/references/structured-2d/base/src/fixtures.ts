// The scenarios the build's own rule tests are written over.
//
// These are the pure half of the harness: a `SpectraState` built by hand, with no
// engine and no canvas behind it, which is all the rule modules need. The
// engine-level checks in `engine.test.ts` go through `src/harness.ts` instead.
//
// `liveWave` is the same arrangement `startPosed` poses through the debug surface:
// a live, quiet, empty wave, with the three world gates held so nothing the
// scenario did not ask for arrives, dives, or costs a life.

import { SpectraState } from "./game";
import type { Band, BulletState, DroneKind, DroneState } from "./game";
import { takeId } from "./entities";
import { seedState } from "./rng";
import { DEFAULT_SEED, PLAYER_BULLET_SPEED } from "./constants";

/** A live, quiet, empty wave at stage 1. */
export function liveWave(): SpectraState {
  const state = new SpectraState();
  state.rngState = seedState(DEFAULT_SEED);
  state.screen = "inWave";
  state.phase = "live";
  state.phaseTimer = 0;
  state.waveEntry = false;
  state.diveLaunching = false;
  state.ship.contact = false;
  return state;
}

/** One drone of `kind`, resting in formation with its centre at `(x, y)`. */
export function poseDrone(
  state: SpectraState,
  kind: DroneKind,
  x: number,
  y: number,
  band: Band = "cyan",
): DroneState {
  const drone: DroneState = {
    id: takeId(state),
    kind,
    x,
    y,
    band,
    phase: "formation",
    phaseClock: 0,
    slotX: x,
    slotY: y,
    entryGroup: 0,
    bandClock: 0,
    shellAlive: true,
    shotsFired: 0,
    travel: true,
    oscillation: true,
    fire: true,
  };
  state.drones.push(drone);
  return drone;
}

/** One of the player's bullets in flight at `(x, y)`, carrying `band`. */
export function posePlayerBullet(
  state: SpectraState,
  x: number,
  y: number,
  band: Band,
): BulletState {
  const bullet: BulletState = {
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

/** One enemy bullet in flight at `(x, y)`, carrying `band`. */
export function poseEnemyBullet(
  state: SpectraState,
  x: number,
  y: number,
  band: Band,
  vy = 320,
): BulletState {
  const bullet: BulletState = {
    id: takeId(state),
    x,
    y,
    vx: 0,
    vy,
    band,
    friendly: false,
  };
  state.bullets.push(bullet);
  return bullet;
}

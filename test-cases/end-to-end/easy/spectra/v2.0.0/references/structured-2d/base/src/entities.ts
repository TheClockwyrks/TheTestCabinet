// Spectra — the handful of operations every rule module reaches the state
// through: the id a new entity takes, the game's random draws, and the two
// lookups a per-entity operation needs.
//
// The state is the world's game state and the framework's states are LIVE
// objects, so a rule writes the fields it advances in place. What is gathered
// here is the part of that writing that is not arithmetic over one field: the id
// counter, which is a declared field of the state (`specs/state.md`) rather than
// a counter held in this module, and the draws, which run off the host's own
// generator and are no part of the state at all (`specs/simulation.md`).

import type { BulletState, DroneState, SpectraState } from "./game";

/**
 * The id the next drone, bullet or burst takes.
 *
 * `specs/instrumentation.md` requires only that an id is distinct among the
 * entities live at one moment; a counter that never goes backwards gives that,
 * and makes an id stable for as long as its entity exists.
 */
export function takeId(state: SpectraState): number {
  const id = state.nextId;
  state.nextId = id + 1;
  return id;
}

/** One random draw, in `[0, 1)`. */
export function random(): number {
  return Math.random();
}

/** A draw from `[lo, hi)`. */
export function randomBetween(lo: number, hi: number): number {
  return lo + (hi - lo) * random();
}

/** A whole draw from `[0, count)`. */
export function randomIndex(count: number): number {
  return Math.min(count - 1, Math.floor(random() * count));
}

/** The drone with that id, or `undefined`. */
export function droneById(
  state: SpectraState,
  id: number,
): DroneState | undefined {
  return state.drones.find((drone) => drone.id === id);
}

/** The bullet with that id, or `undefined`. */
export function bulletById(
  state: SpectraState,
  id: number,
): BulletState | undefined {
  return state.bullets.find((bullet) => bullet.id === id);
}

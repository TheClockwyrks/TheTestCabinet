// Spectra — the three drone kinds (specs/drones.md).
//
// A drone is built one field at a time and every kind carries the same fields:
// the differences between a Shard, a Flux and a Prism are the figures below and
// the rules the other modules read them through. What all three share — the four
// phases, the entrance, the formation, the dive and its fire — is
// `src/swarm.ts`.
//
// The Flux's rhythm lives here, and it is TWO INDEPENDENT FIELDS. `band` is the
// stored band; nothing but a pose and the flip at the end of a shimmer writes
// it. `bandClock` is how far the Flux is into its CURRENT band window, running
// from `0` to `fluxWindow(stage)`; nothing but a pose and the oscillation writes
// it, and neither rewrites the other. At the end of a window the stored band
// flips and the clock returns to `0`, so a full cycle back to the same band is
// two windows (`fluxCycle(stage)`).

import {
  FLUX_HALF,
  FLUX_SIZE,
  PRISM_CORE_HALF,
  PRISM_CORE_SIZE,
  PRISM_HALF,
  PRISM_SIZE,
  SHARD_HALF,
  SHARD_SIZE,
} from "./constants";
import { fluxWindowAt, opposite } from "./bands";
import type { DroneKind, DroneState, SpectraState } from "./game";

/** Each kind's drawn footprint, with a Prism's shell intact. */
const FOOTPRINT: Readonly<Record<DroneKind, number>> = {
  shard: SHARD_SIZE,
  flux: FLUX_SIZE,
  prism: PRISM_SIZE,
};

/** Each kind's contact half-extent, with a Prism's shell intact. */
const HALF: Readonly<Record<DroneKind, number>> = {
  shard: SHARD_HALF,
  flux: FLUX_HALF,
  prism: PRISM_HALF,
};

/** How many shots a kind takes over one dive. */
const SHOTS: Readonly<Record<DroneKind, number>> = {
  shard: 1,
  flux: 1,
  prism: 2,
};

/** The footprint `drone` is drawn at, which a broken Prism shrinks to its core. */
export function droneFootprint(drone: DroneState): number {
  if (drone.kind === "prism" && !drone.shellAlive) return PRISM_CORE_SIZE;
  return FOOTPRINT[drone.kind];
}

/** The half-extent a contact with `drone` is decided by. */
export function droneHalf(drone: DroneState): number {
  if (drone.kind === "prism" && !drone.shellAlive) return PRISM_CORE_HALF;
  return HALF[drone.kind];
}

/** How many shots `drone` takes over one dive. */
export function droneShots(drone: DroneState): number {
  return SHOTS[drone.kind];
}

/**
 * Add one drone of `kind` with its centre at a logical stage position.
 *
 * It is appended to the roster and takes a fresh id. Its band is cyan, its phase
 * `formation`, its slot the position it was placed at, its band clock `0`, its
 * shell intact, its charge `0`, and all three of its faculties on — which is
 * exactly what `addDrone` promises in `specs/instrumentation.md`.
 */
export function addDroneTo(
  state: SpectraState,
  kind: DroneKind,
  x: number,
  y: number,
): DroneState {
  const drone: DroneState = {
    id: state.nextId,
    kind,
    x,
    y,
    band: "cyan",
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
    charge: 0,
    plunge: false,
  };
  state.nextId += 1;
  state.drones.push(drone);
  return drone;
}

/** The drone with `id`, or `undefined`. */
export function droneById(
  state: SpectraState,
  id: number,
): DroneState | undefined {
  return state.drones.find((drone) => drone.id === id);
}

/** Remove the drone with `id`. */
export function removeDrone(state: SpectraState, id: number): void {
  state.drones = state.drones.filter((drone) => drone.id !== id);
}

/**
 * Put `drone` into `phase`, restarting the clock the phase's path runs from.
 *
 * `phaseClock` returns to `0` whenever the phase changes, however the change
 * came about, so the path a phase runs starts from its beginning
 * (`specs/state.md`); `shotsFired` returns with it, and the overload plunge is
 * scoped to the one dive it began.
 */
export function setDronePhase(
  drone: DroneState,
  phase: DroneState["phase"],
): void {
  if (drone.phase === phase) return;
  drone.phase = phase;
  drone.phaseClock = 0;
  drone.shotsFired = 0;
  drone.plunge = false;
}

/**
 * Advance a Flux's band clock by `h` seconds, flipping its stored band and
 * returning the clock to `0` at the end of each window.
 *
 * A Shard and a Prism keep their clocks at `0` and their bands never move on
 * their own, so the gate this runs behind gates nothing on them.
 */
export function advanceOscillation(
  state: SpectraState,
  drone: DroneState,
  h: number,
): void {
  if (drone.kind !== "flux" || !drone.oscillation) return;
  const window = fluxWindowAt(state.stage);
  drone.bandClock += h;
  while (drone.bandClock >= window) {
    drone.bandClock -= window;
    drone.band = opposite(drone.band);
  }
}

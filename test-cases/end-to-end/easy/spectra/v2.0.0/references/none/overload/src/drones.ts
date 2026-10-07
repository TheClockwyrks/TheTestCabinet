// Spectra — what each of the three kinds does differently.
//
// The phases, the entrance, the formation, the dive and the fire a dive carries are
// the same for all three and live in `src/swarm.ts`. `specs/drones.md`'s three
// kinds differ in exactly four ways, and this file is those four:
//
//   * how many shots a dive takes, and which band each carries;
//   * a Flux's rhythm — a stored band and a band clock, which are TWO INDEPENDENT
//     FIELDS with exactly one writer each;
//   * a Prism's two layers, and which one a matching shot takes;
//   * a Prism reaching the bottom of the field, which inverts the whole field
//     rather than destroying the Prism.
//
// THE FLUX'S TWO FIELDS are the subtle part. `band` is the band it holds — or,
// mid-shimmer, the one it is LEAVING — and only `setDroneBand` and the flip at the
// end of a window write it. `bandClock` is the position inside the CURRENT window
// and only `setDroneBandClock` and the oscillation write it. `shimmer` is derived
// from the clock, and the band a shimmering Flux READS as is the opposite of the
// one it stores, because it is moving toward it.

import {
  FLUX_SHIMMER,
  PRISM_INVERT_Y,
  fluxHold,
  fluxWindow,
  opposite,
} from "./constants";
import { addEnemyBullet } from "./entities";
import type { Band, Drone, SpectraState } from "./types";

/** Whether a Flux is settled on neither band. False on the other two kinds. */
export function shimmering(drone: Drone, stage: number): boolean {
  return drone.kind === "flux" && drone.bandClock >= fluxHold(stage);
}

/**
 * Run a Flux's band clock forward by `h`.
 *
 * Gated by `oscillation` alone: with it off the Flux holds whichever band or
 * shimmer it is in indefinitely, while its travel and its firing run on. On a Shard
 * or a Prism this gates nothing, because neither has a clock to run.
 */
export function advanceBandClock(
  state: SpectraState,
  drone: Drone,
  h: number,
): void {
  if (drone.kind !== "flux" || !drone.oscillation) return;
  const window = fluxWindow(state.stage);
  drone.bandClock += h;
  while (drone.bandClock >= window) {
    // The window is over: the stored band flips and the clock starts the next one.
    drone.bandClock -= window;
    drone.band = opposite(drone.band);
  }
}

/** The seconds a Flux's shimmer lasts, stated for symmetry with the hold. */
export const SHIMMER_SECONDS = FLUX_SHIMMER;

/** How many shots `kind` takes over one whole dive. */
export function shotsPerDive(kind: Drone["kind"]): number {
  return kind === "prism" ? 2 : 1;
}

/**
 * Take this dive's shots, if the kind has any left to take.
 *
 * A Shard and a Flux take one, carrying the band the drone stores at the shot. A
 * Prism takes two, fired together, one carrying each band, so it threatens the ship
 * whichever band the ship is tuned to. A shimmering Flux takes none: it has no band
 * to fire, and it takes its shot as soon as it settles, if it is still diving.
 */
export function fireDiveShots(state: SpectraState, drone: Drone): void {
  if (!drone.fire) return;
  if (drone.diveShots >= shotsPerDive(drone.kind)) return;
  if (shimmering(drone, state.stage)) return;
  if (drone.kind === "prism") {
    addEnemyBullet(state, drone.x - 10, drone.y, drone.band);
    addEnemyBullet(state, drone.x + 10, drone.y, opposite(drone.band));
    drone.diveShots = 2;
    return;
  }
  addEnemyBullet(state, drone.x, drone.y, drone.band);
  drone.diveShots = 1;
}

/**
 * Whether a diving Prism has just crossed the line that inverts the field.
 *
 * It triggers only while a layer is still intact, only travelling downward, and
 * only once per dive.
 */
export function crossedInvertLine(
  drone: Drone,
  previousY: number,
  y: number,
): boolean {
  return (
    drone.kind === "prism" &&
    !drone.invertedThisDive &&
    previousY < PRISM_INVERT_Y &&
    y >= PRISM_INVERT_Y
  );
}

/** The band that destroys a Prism's currently exposed layer. */
export function exposedBand(drone: Drone): Band {
  return drone.shellAlive ? drone.band : opposite(drone.band);
}

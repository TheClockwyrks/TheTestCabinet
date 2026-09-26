// Spectra — the effective band, which is one definition applied twice.
//
// `specs/bands.md` states it once: an entity's EFFECTIVE band is its stored band,
// taken as the opposite band ONCE FOR EACH of the following that holds —
//
//   * the entity is a Prism whose shell has been broken, so the exposed layer is
//     the core;
//   * a spectral inversion is active and the entity is a drone or an enemy bullet.
//
// A Flux mid-shimmer is settled on NEITHER band, and `specs/instrumentation.md`
// fixes what it reads as: the band it is moving toward, which is the opposite of the
// one it stores. So a shimmer is a third swap of the same kind, folded in the same
// way. It is deliberately NOT what decides a shot: `specs/drones.md` says no shot
// destroys a shimmering Flux OF EITHER BAND, and `src/combat.ts` tests the shimmer
// before it compares two bands at all.
//
// The two swaps compose AS TOGGLES rather than additively, so two of them cancel: a
// stored-cyan Prism with its shell broken, under an inversion, reads cyan. Counting
// the swaps and taking the parity is the whole implementation, and it is what keeps
// that composition correct by construction rather than by a special case.
//
// The ship's band and the player's bullets are never swapped, which is why the
// bullet read below asks whether the bullet is friendly.

import { opposite } from "./constants";
import { shimmering } from "./drones";
import type { Band, Bullet, Drone } from "./types";

/** `band`, taken as the opposite band once for each `swap` that holds. */
export function foldSwaps(band: Band, ...swaps: readonly boolean[]): Band {
  const flips = swaps.reduce((count, swap) => count + (swap ? 1 : 0), 0);
  return flips % 2 === 0 ? band : opposite(band);
}

/** The band a drone currently reads and counts as. */
export function droneEffectiveBand(
  drone: Drone,
  inverted: boolean,
  stage: number,
): Band {
  return foldSwaps(
    drone.band,
    drone.kind === "prism" && !drone.shellAlive,
    inverted,
    shimmering(drone, stage),
  );
}

/** The band a bullet currently reads and counts as. */
export function bulletEffectiveBand(bullet: Bullet, inverted: boolean): Band {
  return foldSwaps(bullet.band, !bullet.friendly && inverted);
}

/** Whether a spectral inversion is active. */
export function inversionActive(inversion: number): boolean {
  return inversion > 0;
}

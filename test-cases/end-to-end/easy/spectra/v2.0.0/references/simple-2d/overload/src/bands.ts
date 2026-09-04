// Spectra — the two bands and everything derived from one (`specs/bands.md`).
//
// A drone and a bullet each carry a STORED band. What either reads and counts as
// is its EFFECTIVE band: the stored band taken as the opposite once for each swap
// that holds. The swaps compose as toggles rather than additively, so two of them
// cancel, which is why they are counted and not applied one after another.
//
// Three swaps exist, and each is guarded by the kind it belongs to:
//
//   * a Prism whose shell has been broken, so the exposed layer is its core;
//   * a Flux mid-shimmer, which reads as the band it is moving toward;
//   * an active spectral inversion, over every drone and every enemy bullet.
//
// The ship's band and the player's bullets are never swapped, so a player
// bullet's effective band always equals its stored band.
//
// Nothing here is stored. A drone's effective band, whether a Flux is shimmering,
// whether a discharge is ready and whether the ship is alive are all derived from
// the declared fields at the moment they are read.

import {
  FLUX_HALF,
  FLUX_SIZE,
  PRISM_CORE_HALF,
  PRISM_CORE_SIZE,
  PRISM_HALF,
  PRISM_SIZE,
  RESONANCE_MAX,
  SHARD_HALF,
  SHARD_SIZE,
  fluxHold,
} from "./constants";
import type { Band, DroneKind, Phase } from "./game";

/** The fields a band derivation reads off a drone. */
export interface BandedDrone {
  readonly kind: DroneKind;
  readonly band: Band;
  readonly shellAlive: boolean;
  readonly bandClock: number;
}

/** The fields a band derivation reads off a bullet. */
export interface BandedBullet {
  readonly band: Band;
  readonly friendly: boolean;
}

/** The other band. */
export function opposite(band: Band): Band {
  return band === "cyan" ? "magenta" : "cyan";
}

/** `band`, taken as the opposite once for each swap that holds. */
function swapped(band: Band, swaps: number): Band {
  return swaps % 2 === 0 ? band : opposite(band);
}

/**
 * Whether the drone is a Flux settled on neither band.
 *
 * True exactly while its band clock has reached the held part's end, and false on
 * the other two kinds.
 */
export function shimmering(drone: BandedDrone, stage: number): boolean {
  return drone.kind === "flux" && drone.bandClock >= fluxHold(stage);
}

/** Whether a spectral inversion is running. */
export function inversionActive(inversion: number): boolean {
  return inversion > 0;
}

/** The band the drone currently reads and counts as. */
export function effectiveDroneBand(
  drone: BandedDrone,
  stage: number,
  inversion: number,
): Band {
  let swaps = 0;
  if (drone.kind === "prism" && !drone.shellAlive) swaps++;
  if (shimmering(drone, stage)) swaps++;
  if (inversionActive(inversion)) swaps++;
  return swapped(drone.band, swaps);
}

/** The band the bullet currently reads and counts as. */
export function effectiveBulletBand(
  bullet: BandedBullet,
  inversion: number,
): Band {
  const swaps = !bullet.friendly && inversionActive(inversion) ? 1 : 0;
  return swapped(bullet.band, swaps);
}

/**
 * Whether one of the player's bullets destroys the drone's exposed layer.
 *
 * No shot destroys a shimmering Flux, of either band, because a Flux mid-shimmer
 * is settled on neither; every other case is one comparison of two effective
 * bands.
 */
export function shotDestroys(
  bulletBand: Band,
  drone: BandedDrone,
  stage: number,
  inversion: number,
): boolean {
  if (shimmering(drone, stage)) return false;
  return bulletBand === effectiveDroneBand(drone, stage, inversion);
}

/** The footprint the drone is drawn at, in logical units. */
export function droneFootprint(drone: BandedDrone): number {
  if (drone.kind === "shard") return SHARD_SIZE;
  if (drone.kind === "flux") return FLUX_SIZE;
  return drone.shellAlive ? PRISM_SIZE : PRISM_CORE_SIZE;
}

/** The half-extent the drone's contacts are decided by. */
export function droneHalf(drone: BandedDrone): number {
  if (drone.kind === "shard") return SHARD_HALF;
  if (drone.kind === "flux") return FLUX_HALF;
  return drone.shellAlive ? PRISM_HALF : PRISM_CORE_HALF;
}

/** Whether a discharge is available, which is at a full meter and not below. */
export function dischargeReady(resonance: number): boolean {
  return resonance >= RESONANCE_MAX;
}

/** Whether the ship stands, which is false exactly while the phase is `ready`. */
export function shipAlive(phase: Phase): boolean {
  return phase !== "ready";
}

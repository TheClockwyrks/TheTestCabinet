// Spectra — the band rules, as the one definition every reader shares.
//
// `specs/bands.md` states EFFECTIVE BAND once — an entity's stored band, taken as
// the opposite band once for each swap that holds — and everything a band decides
// is a comparison of two effective bands. The swaps compose as TOGGLES rather
// than additively, so two of them cancel: a stored-cyan Prism whose shell has
// been broken, under an active inversion, reads cyan.
//
// The three swaps:
//
//   * a Prism whose shell has been broken, so the layer now exposed is its core;
//   * a Flux mid-shimmer, which reads as the band it is moving toward
//     (specs/drones.md);
//   * an active spectral inversion, on a drone or an enemy bullet.
//
// The ship's band and the player's bullets are never swapped: a player bullet's
// effective band always equals its stored band, and the ship reads its own true
// band through an inversion.

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
  opposite,
  type Band,
} from "./constants";
import type { Bullet, Drone, SpectraState } from "./types";

/** Whether a spectral inversion is active. */
export function inversionActive(state: SpectraState): boolean {
  return state.inversion > 0;
}

/** Whether a discharge is available: exactly at full, not one point below. */
export function dischargeReady(state: SpectraState): boolean {
  return state.resonance >= RESONANCE_MAX;
}

/**
 * Whether a Flux is settled on neither band.
 *
 * True exactly while its band clock has reached the held part's end. False on a
 * Shard and on a Prism, which have no band window.
 */
export function isShimmering(state: SpectraState, drone: Drone): boolean {
  if (drone.kind !== "flux") return false;
  return drone.bandClock >= fluxHold(state.stage);
}

/** The band a drone currently reads and counts as. */
export function effectiveDroneBand(state: SpectraState, drone: Drone): Band {
  let band = drone.band;
  if (drone.kind === "prism" && !drone.shellAlive) band = opposite(band);
  if (isShimmering(state, drone)) band = opposite(band);
  if (inversionActive(state)) band = opposite(band);
  return band;
}

/** The band a bullet currently reads and counts as. */
export function effectiveBulletBand(state: SpectraState, bullet: Bullet): Band {
  if (bullet.friendly) return bullet.band;
  return inversionActive(state) ? opposite(bullet.band) : bullet.band;
}

/** A drone's contact half-extent, which a broken shell halves on a Prism. */
export function droneHalf(drone: Drone): number {
  switch (drone.kind) {
    case "shard":
      return SHARD_HALF;
    case "flux":
      return FLUX_HALF;
    case "prism":
      return drone.shellAlive ? PRISM_HALF : PRISM_CORE_HALF;
  }
}

/** A drone's drawn footprint, which is also the footprint its burst plays at. */
export function droneFootprint(drone: Drone): number {
  switch (drone.kind) {
    case "shard":
      return SHARD_SIZE;
    case "flux":
      return FLUX_SIZE;
    case "prism":
      return drone.shellAlive ? PRISM_SIZE : PRISM_CORE_SIZE;
  }
}

/** Whether two circles about their centres overlap. */
export function overlaps(
  ax: number,
  ay: number,
  aHalf: number,
  bx: number,
  by: number,
  bHalf: number,
): boolean {
  return Math.hypot(ax - bx, ay - by) <= aHalf + bHalf;
}

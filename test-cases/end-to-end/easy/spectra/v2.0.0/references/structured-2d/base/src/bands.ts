// Spectra — the two bands and everything a band decides (`specs/bands.md`).
//
// There are exactly two bands and no neutral value. What a thing READS AND
// COUNTS AS is its EFFECTIVE band: its stored band, taken as the opposite once
// for each swap that holds. The swaps compose as toggles rather than additively,
// so two of them cancel — a stored-cyan Prism whose shell is broken, under an
// active inversion, reads cyan. That composition is the whole point of the case,
// so it is written once, here, and every match in the build goes through it.
//
// The swaps:
//
//   * a Prism whose shell has been broken, so the layer now exposed is its core;
//   * a Flux mid-shimmer, which reads as the band it is moving TOWARD;
//   * an active spectral inversion, over any drone or enemy bullet.
//
// The ship and the player's bullets are never swapped, so a player bullet's
// effective band always equals its stored band and the ship reads its own true
// band through an inversion.

import { fluxHold } from "./constants";
import type { Band, BulletState, DroneState } from "./game";

/** The other band. */
export function opposite(band: Band): Band {
  return band === "cyan" ? "magenta" : "cyan";
}

/** `band`, taken as its opposite when `swap` holds. */
function toggle(band: Band, swap: boolean): Band {
  return swap ? opposite(band) : band;
}

/**
 * Whether the drone is a Flux settled on neither band (`specs/drones.md`).
 *
 * Derived from the band clock alone: a Flux is shimmering exactly while its
 * clock has passed the stage's hold and has not yet reached the end of the
 * window. `false` on a Shard or a Prism, whose band clock rests at `0`.
 */
export function isShimmering(
  drone: Pick<DroneState, "kind" | "bandClock">,
  stage: number,
): boolean {
  return drone.kind === "flux" && drone.bandClock >= fluxHold(stage);
}

/** The band a drone currently reads and counts as. */
export function droneBand(
  drone: Pick<DroneState, "kind" | "band" | "bandClock" | "shellAlive">,
  stage: number,
  inverted: boolean,
): Band {
  let band = toggle(drone.band, drone.kind === "prism" && !drone.shellAlive);
  band = toggle(band, isShimmering(drone, stage));
  return toggle(band, inverted);
}

/** The band a bullet currently reads and counts as. */
export function bulletBand(
  bullet: Pick<BulletState, "band" | "friendly">,
  inverted: boolean,
): Band {
  // An inversion swaps a drone and its bullets alike, and never the player's.
  return toggle(bullet.band, inverted && !bullet.friendly);
}

/** Whether a spectral inversion is running. */
export function inverted(inversion: number): boolean {
  return inversion > 0;
}

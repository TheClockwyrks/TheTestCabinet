// Spectra — the two bands and everything a band decides (specs/bands.md).
//
// One definition carries the whole band system: an entity's EFFECTIVE band is
// its stored band, taken as the opposite once for each of the three swaps that
// hold — a Prism whose shell has been broken, so the exposed layer is its core, a
// Flux mid-shimmer, which reads as the band it is moving toward, and an active
// spectral inversion over a drone or an enemy bullet. They compose as toggles
// rather than additively, so two of them cancel: a stored-cyan Prism whose shell
// has been broken, under an inversion, reads cyan.
//
// The ship's band and the player's bullets are never swapped, which is why
// `bulletEffectiveBand` asks whether the bullet is friendly and the ship has no
// effective band of its own at all.
//
// A Flux's shimmer lives here too, because `shimmer` is what decides whether a
// Flux has an effective band to match against at all.

import { FLUX_SHIMMER, INVERSION_TIME, fluxHold } from "./constants";
import type { FrameCues } from "./audio";
import type { Band, BulletState, DroneState, SpectraState } from "./game";

/** The other band. There are exactly two, and no neutral state. */
export function opposite(band: Band): Band {
  return band === "cyan" ? "magenta" : "cyan";
}

/** `band`, flipped once for each `swap` that holds. */
export function swapped(band: Band, ...swaps: boolean[]): Band {
  const flips = swaps.filter(Boolean).length;
  return flips % 2 === 0 ? band : opposite(band);
}

/** Whether a spectral inversion is running. */
export function inversionActive(state: SpectraState): boolean {
  return state.inversion > 0;
}

/** One band window at `stage`: the hold, then the shimmer that ends it. */
export function fluxWindowAt(stage: number): number {
  return fluxHold(stage) + FLUX_SHIMMER;
}

/**
 * Whether `drone` is settled on neither band.
 *
 * Derived rather than stored: true exactly while a Flux's band clock has reached
 * the held part's end, and false on a Shard or a Prism, whose clocks rest at `0`.
 */
export function shimmering(drone: DroneState, stage: number): boolean {
  return drone.kind === "flux" && drone.bandClock >= fluxHold(stage);
}

/**
 * The band `drone` currently reads and counts as.
 *
 * A shimmering Flux is settled on neither band and reports the band it is moving
 * toward, which is the opposite of the one it stores, so a reader takes the pair
 * rather than the band alone.
 */
export function droneEffectiveBand(
  drone: DroneState,
  state: SpectraState,
): Band {
  return swapped(
    drone.band,
    drone.kind === "prism" && !drone.shellAlive,
    shimmering(drone, state.stage),
    inversionActive(state),
  );
}

/** The band `bullet` currently reads and counts as. */
export function bulletEffectiveBand(
  bullet: BulletState,
  state: SpectraState,
): Band {
  return swapped(bullet.band, !bullet.friendly && inversionActive(state));
}

/**
 * Whether one of the player's bullets destroys `drone`'s exposed layer.
 *
 * No shot destroys a shimmering Flux, of either band: it has no band to match.
 * Everything else is one comparison of two effective bands, which is the whole
 * of `specs/bands.md`'s match-to-destroy rule.
 */
export function shotMatches(
  bullet: BulletState,
  drone: DroneState,
  state: SpectraState,
): boolean {
  if (shimmering(drone, state.stage)) return false;
  return (
    bulletEffectiveBand(bullet, state) === droneEffectiveBand(drone, state)
  );
}

/** Whether the hull absorbs `bullet` rather than being hit by it. */
export function shieldAbsorbs(
  bullet: BulletState,
  state: SpectraState,
): boolean {
  return bulletEffectiveBand(bullet, state) === state.ship.band;
}

/**
 * Begin a spectral inversion, or refresh one already running.
 *
 * At most one is active at a time: a fresh trigger sets the remaining time back
 * to `INVERSION_TIME` rather than adding to it (`specs/bands.md`). The cue plays
 * in the frame the inversion begins.
 */
export function beginInversion(state: SpectraState, cues: FrameCues): void {
  state.inversion = INVERSION_TIME;
  cues.inversion = true;
}

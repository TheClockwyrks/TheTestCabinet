// Spectra — Overload: what a mismatched shot does to the drone it hits
// (specs/mode.md).
//
// That the bullet is consumed and destroys nothing is `specs/bands.md`'s rule and
// holds under any mode; this module owns only what happens to the DRONE. In
// Overload a wrong-band shot feeds it, charging it toward a reaction that makes
// it more dangerous, and the shot that tips it over runs the reaction for its
// kind and returns its charge to `0`.
//
// An overload destroys nothing, takes no layer off a Prism, scores nothing, fills
// no resonance, and leaves the drone's band, slot and shell exactly as they were
// except where the reaction below changes them.

import {
  OVERLOAD_AT,
  OVERLOAD_FLUX_SPREAD,
  OVERLOAD_FLUX_SPREAD_ANGLE,
  OVERLOAD_PRISM_ESCORTS,
  SLOT_DX,
} from "./constants";
import { opposite, shimmering } from "./bands";
import { addEnemyBulletTo, addFannedEnemyBulletTo } from "./bullets";
import { addDroneTo, droneHalf, setDronePhase } from "./drones";
import { random } from "./random";
import type { FrameCues } from "./audio";
import type { DroneState, SpectraState } from "./game";

/** How far beside a Prism its overload escort appears. */
const ESCORT_OFFSET = 44;

/** The charge a drone may carry, clamped to the whole numbers it is defined over. */
export function clampCharge(charge: number): number {
  return Math.max(0, Math.min(OVERLOAD_AT, Math.round(charge)));
}

/** An overloaded Shard plunges down the field toward the ship's current `x`. */
function overloadShard(drone: DroneState): void {
  setDronePhase(drone, "diving");
  drone.plunge = true;
}

/**
 * An overloaded Flux ends the window it was in — its stored band flips and its
 * band clock returns to `0` — and sprays `OVERLOAD_FLUX_SPREAD` bullets of its
 * new band, fanned `OVERLOAD_FLUX_SPREAD_ANGLE` degrees apart.
 */
function overloadFlux(state: SpectraState, drone: DroneState): void {
  drone.band = opposite(drone.band);
  drone.bandClock = 0;
  const y = drone.y + droneHalf(drone) + 6;
  const middle = (OVERLOAD_FLUX_SPREAD - 1) / 2;
  for (let index = 0; index < OVERLOAD_FLUX_SPREAD; index += 1) {
    const degrees = (index - middle) * OVERLOAD_FLUX_SPREAD_ANGLE;
    addFannedEnemyBulletTo(state, drone.x, y, drone.band, degrees);
  }
}

/**
 * An overloaded Prism bursts its exposed layer: two bullets at once, one of each
 * band. With its shell still standing it also adds `OVERLOAD_PRISM_ESCORTS`
 * Shards beside it, of a band drawn from the game's own generator, entering as an
 * escort does; with only its core left it adds none.
 */
function overloadPrism(state: SpectraState, drone: DroneState): void {
  const y = drone.y + droneHalf(drone) + 6;
  addEnemyBulletTo(state, drone.x - 8, y, "cyan");
  addEnemyBulletTo(state, drone.x + 8, y, "magenta");
  if (!drone.shellAlive) return;

  for (let index = 0; index < OVERLOAD_PRISM_ESCORTS; index += 1) {
    const side = index % 2 === 0 ? 1 : -1;
    const escort = addDroneTo(
      state,
      "shard",
      drone.x + side * ESCORT_OFFSET,
      drone.y,
    );
    escort.band = random() < 0.5 ? "cyan" : "magenta";
    escort.phase = "entering";
    escort.slotX = drone.slotX + side * SLOT_DX;
    escort.slotY = drone.slotY;
    // Group `0` is released as a wave opens, so an escort added mid-wave is
    // already released and flies in from where it appeared.
    escort.entryGroup = 0;
  }
}

/** Run the reaction for `drone`'s kind. */
export function runOverload(
  state: SpectraState,
  drone: DroneState,
  cues: FrameCues,
): void {
  switch (drone.kind) {
    case "shard":
      overloadShard(drone);
      break;
    case "flux":
      overloadFlux(state, drone);
      break;
    case "prism":
      overloadPrism(state, drone);
      break;
  }
  drone.charge = 0;
  cues.overload = true;
}

/**
 * What a mismatched shot does to `drone`: one more charge, and the reaction when
 * that addition would take it to `OVERLOAD_AT`.
 *
 * A Flux struck while it shimmers takes no charge and is not destroyed: it has no
 * band to mismatch.
 */
export function applyMismatch(
  state: SpectraState,
  drone: DroneState,
  cues: FrameCues,
): void {
  if (shimmering(drone, state.stage)) return;
  if (drone.charge + 1 >= OVERLOAD_AT) {
    runOverload(state, drone, cues);
    return;
  }
  drone.charge += 1;
}

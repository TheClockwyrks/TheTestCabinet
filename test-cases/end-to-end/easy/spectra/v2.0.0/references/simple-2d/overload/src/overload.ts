// Spectra — Overload: what a mismatched shot does (`specs/mode.md`).
//
// A wrong-band shot does not go to waste. It feeds the drone it hits, charging it
// toward an overload that makes it more dangerous, and the third charge tips it
// over: the drone runs the reaction for its kind and its charge returns to zero, so
// it can be overloaded again.
//
// An overload destroys nothing, takes no layer off a Prism, and leaves the drone's
// band, slot and shell exactly as they were except where its own reaction changes
// them.

import {
  CUES,
  OVERLOAD_AT,
  OVERLOAD_FLUX_SPREAD,
  OVERLOAD_FLUX_SPREAD_ANGLE,
  OVERLOAD_PRISM_ESCORTS,
} from "./constants";
import { droneHalf, opposite } from "./bands";
import {
  addEnemyBullet,
  addEnemyBulletOnHeading,
  PRISM_MUZZLE_SPREAD,
  muzzleY,
} from "./bullets";
import { enterPlunge } from "./drones";
import { drawInt, type FrameEvents, type MutDrone, type Sim } from "./sim";
import { freeFormationSlot, freshDrone } from "./wave";
import type { Band } from "./game";

/** The mode this build ships, which the snapshot reports. */
export const MODE = "overload";

/** How far beside an overloaded Prism its fresh escort appears. */
const ESCORT_SPAWN_DX = 44;

/** Feed the drone one charge, and tip it over where that is the third. */
export function chargeDrone(sim: Sim, drone: MutDrone, ev: FrameEvents): void {
  if (drone.charge + 1 >= OVERLOAD_AT) {
    drone.charge = 0;
    runOverload(sim, drone);
    ev.cues.add(CUES.overload);
    return;
  }
  drone.charge += 1;
}

/** The reaction the drone's kind runs when it overloads. */
function runOverload(sim: Sim, drone: MutDrone): void {
  switch (drone.kind) {
    case "shard":
      overloadShard(drone);
      return;
    case "flux":
      overloadFlux(sim, drone);
      return;
    case "prism":
      overloadPrism(sim, drone);
      return;
  }
}

/** A Shard plunges headlong down the field toward the ship's current x. */
function overloadShard(drone: MutDrone): void {
  enterPlunge(drone);
}

/** A Flux flips its band, opens a fresh window, and sprays its new band. */
function overloadFlux(sim: Sim, drone: MutDrone): void {
  drone.band = opposite(drone.band);
  drone.bandClock = 0;
  const y = muzzleY(drone.y, droneHalf(drone));
  const middle = (OVERLOAD_FLUX_SPREAD - 1) / 2;
  for (let shot = 0; shot < OVERLOAD_FLUX_SPREAD; shot++) {
    const heading = (shot - middle) * OVERLOAD_FLUX_SPREAD_ANGLE;
    addEnemyBulletOnHeading(sim, drone.x, y, drone.band, heading);
  }
}

/** A Prism's exposed layer bursts, and a standing shell grows the swarm. */
function overloadPrism(sim: Sim, drone: MutDrone): void {
  const y = muzzleY(drone.y, droneHalf(drone));
  addEnemyBullet(sim, drone.x - PRISM_MUZZLE_SPREAD, y, "cyan");
  addEnemyBullet(sim, drone.x + PRISM_MUZZLE_SPREAD, y, "magenta");
  if (!drone.shellAlive) return;

  for (let escort = 0; escort < OVERLOAD_PRISM_ESCORTS; escort++) {
    const band: Band = drawInt(sim, 0, 1) === 0 ? "cyan" : "magenta";
    const side = escort % 2 === 0 ? 1 : -1;
    const x = drone.x + side * ESCORT_SPAWN_DX;
    const slot = freeFormationSlot(sim, x, drone.y);
    const shard = freshDrone(sim, "shard", x, drone.y, band);
    shard.slotX = slot.x;
    shard.slotY = slot.y;
    // Released at once, as an escort arriving beside its Prism is.
    shard.entryGroup = 0;
    sim.drones.push(shard);
  }
}

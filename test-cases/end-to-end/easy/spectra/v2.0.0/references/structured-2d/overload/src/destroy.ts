// Spectra — what happens when a drone's layer is taken (specs/scoring.md,
// specs/assets.md, specs/resonance.md).
//
// A destruction is resolved in two halves, because `specs/simulation.md` fixes
// the order a sub-step resolves in: the contact marks what is destroyed, and step
// five is where everything marked leaves its roster and every destroyed drone
// starts its burst. `Removal` is that mark, carried across the four contact
// passes of one sub-step and applied once at the end of it.

import { RESONANCE_KILL, RESONANCE_MAX, isChallengeStage } from "./constants";
import { startBurst } from "./bursts";
import { droneFootprint } from "./drones";
import { addScore, droneScore } from "./scoring";
import type { DroneState, SpectraState } from "./game";

/** What one sub-step's contacts marked for removal, and the pops they owe. */
export interface Removal {
  drones: Set<number>;
  bullets: Set<number>;
  pops: { x: number; y: number; size: number }[];
}

/** A mark that has taken nothing yet. */
export function noRemoval(): Removal {
  return { drones: new Set(), bullets: new Set(), pops: [] };
}

/** Add `amount` to the meter, which caps at `RESONANCE_MAX` and never decays. */
export function fillMeter(state: SpectraState, amount: number): void {
  state.resonance = Math.min(RESONANCE_MAX, state.resonance + amount);
}

/**
 * Take `drone`'s exposed layer.
 *
 * A Prism with its shell standing loses the shell and stays on the field with its
 * core exposed; anything else is destroyed outright. `fillsMeter` is what tells a
 * bullet's kill from a discharge's: the meter is filled by an absorbed same-band
 * bullet and by a matching kill, and by nothing else.
 */
export function takeLayer(
  state: SpectraState,
  drone: DroneState,
  removal: Removal,
  fillsMeter: boolean,
): void {
  if (removal.drones.has(drone.id)) return;
  const size = droneFootprint(drone);

  if (drone.kind === "prism" && drone.shellAlive) {
    addScore(state, droneScore(state, drone, "shell"));
    removal.pops.push({ x: drone.x, y: drone.y, size });
    drone.shellAlive = false;
    return;
  }

  addScore(state, droneScore(state, drone, "body"));
  if (fillsMeter) fillMeter(state, RESONANCE_KILL);
  if (isChallengeStage(state.stage)) state.challengeHits += 1;
  removal.pops.push({ x: drone.x, y: drone.y, size });
  removal.drones.add(drone.id);
}

/**
 * Destroy `drone` whole, shell and core together, in one step — which is what a
 * discharge wave does to a Prism (`specs/resonance.md`). It pays both layers and
 * pops once.
 */
export function destroyWhole(
  state: SpectraState,
  drone: DroneState,
  removal: Removal,
): void {
  if (removal.drones.has(drone.id)) return;
  if (drone.kind === "prism" && drone.shellAlive) {
    addScore(state, droneScore(state, drone, "shell"));
  }
  addScore(state, droneScore(state, drone, "body"));
  if (isChallengeStage(state.stage)) state.challengeHits += 1;
  removal.pops.push({
    x: drone.x,
    y: drone.y,
    size: droneFootprint(drone),
  });
  removal.drones.add(drone.id);
}

/**
 * Step five of a sub-step: everything marked leaves its roster, and every
 * destroyed drone starts its drone-burst. Returns how many drones were removed,
 * which is what the stage-clear rule turns on.
 */
export function applyRemoval(state: SpectraState, removal: Removal): number {
  const removed = state.drones.filter((drone) =>
    removal.drones.has(drone.id),
  ).length;
  if (removal.drones.size > 0) {
    state.drones = state.drones.filter(
      (drone) => !removal.drones.has(drone.id),
    );
  }
  if (removal.bullets.size > 0) {
    state.bullets = state.bullets.filter(
      (bullet) => !removal.bullets.has(bullet.id),
    );
  }
  for (const pop of removal.pops) startBurst(state, pop.x, pop.y, pop.size);
  return removed;
}

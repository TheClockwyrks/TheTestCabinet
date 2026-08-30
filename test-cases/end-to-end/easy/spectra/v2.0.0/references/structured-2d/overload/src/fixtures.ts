// The scenarios the build's own tests are written over.
//
// These are the pure half of the harness: a `SpectraState` built by hand, with no
// engine and no canvas behind it, which is all the rules modules need. The
// engine-level checks in `engine.test.ts` stand the real engine up through
// `src/harness.ts` instead.
//
// `liveState` is the same arrangement a caller poses through the debug surface:
// an empty, quiet live wave. Empty is safe because a stage clears on the moment
// its last drone is destroyed, so a wave that never held one never clears; quiet
// is the three world gates, with which nothing the scenario did not ask for
// arrives, launches, or costs a life.

import { SpectraState } from "./game";
import type { Band, DroneKind, DroneState } from "./game";
import { addDroneTo } from "./drones";

/** A fresh state, exactly as the engine builds one when the world opens. */
export function titleState(): SpectraState {
  return new SpectraState();
}

/** An empty, quiet live wave at stage 1. */
export function liveState(): SpectraState {
  const state = titleState();
  state.screen = "inWave";
  state.phase = "live";
  state.phaseTimer = 0;
  state.waveEntry = false;
  state.diveLaunching = false;
  state.ship.contact = false;
  return state;
}

/** What a posed drone may be told beyond its kind and its position. */
export interface DronePose {
  band?: Band;
  phase?: DroneState["phase"];
  slotX?: number;
  slotY?: number;
  bandClock?: number;
  shellAlive?: boolean;
  charge?: number;
  travel?: boolean;
  oscillation?: boolean;
  fire?: boolean;
}

/**
 * One drone posed as a prop: every faculty off unless the pose asks for it, so it
 * holds exactly where it was put until a test turns something on.
 */
export function poseDrone(
  state: SpectraState,
  kind: DroneKind,
  x: number,
  y: number,
  pose: DronePose = {},
): DroneState {
  const drone = addDroneTo(state, kind, x, y);
  drone.travel = pose.travel ?? false;
  drone.oscillation = pose.oscillation ?? false;
  drone.fire = pose.fire ?? false;
  if (pose.band !== undefined) drone.band = pose.band;
  if (pose.phase !== undefined) drone.phase = pose.phase;
  if (pose.slotX !== undefined) drone.slotX = pose.slotX;
  if (pose.slotY !== undefined) drone.slotY = pose.slotY;
  if (pose.bandClock !== undefined) drone.bandClock = pose.bandClock;
  if (pose.shellAlive !== undefined) drone.shellAlive = pose.shellAlive;
  if (pose.charge !== undefined) drone.charge = pose.charge;
  return drone;
}

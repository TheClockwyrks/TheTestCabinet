// Spectra — the simulation one frame owes the game (specs/simulation.md).
//
// The game mode's tick calls this once a frame with the delta the engine measured,
// and everything the game does on its own happens here. What the PLAYER does
// happens one step earlier, in the player controller, which resolves the frame's
// input into the state before any of this runs (`specs/state.md`).
//
// THE FRAME IS DIVIDED. There is no fixed timestep: an update covering `dt`
// seconds runs `n = max(1, ceil(dt / SUBSTEP_MAX))` sub-steps of `h = dt / n`
// each, and each sub-step advances every moving thing by `p += v * h` and then
// resolves contacts in the stated order. One second of game time therefore covers
// the same ground whether it arrives as one frame, as sixty, or as a hundred and
// twenty: each runs a hundred and twenty sub-steps of a hundred and twentieth of a
// second.
//
// The order below is the order the specification's rules compose in:
//
//   1. Simulation time accumulates on every screen, whatever it is.
//   2. `paused` is frozen — no drone moves, no bullet travels, no phase timer
//      runs, none of the clocks the wave keeps advances and no cue plays — so a
//      paused game is exactly where it was when it was paused (`specs/ui.md`).
//   3. The stage intro and the stage-cleared interstitial run their hold alone.
//   4. The live wave advances: the wave's clocks, the inversion, the ship's two
//      timers, the drones, the bullets, the discharge and the bursts, and then the
//      sub-step's contacts.
//   5. The stage's own end is checked against the removals THIS sub-step made
//      rather than against an empty field.

import { SUBSTEP_MAX } from "./constants";
import { advanceBursts } from "./bursts";
import { advanceBullets } from "./bullets";
import { advanceDischarge } from "./discharge";
import { advanceDrones } from "./swarm";
import { advanceShipTimers } from "./ship";
import { advanceHold, checkStageEnd, endReadyHold } from "./flow";
import { resolveContacts } from "./contacts";
import type { FrameCues } from "./audio";
import type { SpectraState } from "./game";

/** How many whole sub-steps an update covering `dt` seconds is divided into. */
export function subStepCount(dt: number): number {
  return Math.max(1, Math.ceil(dt / SUBSTEP_MAX));
}

/** Advance the whole game by `dt` seconds, collecting the cues it raised. */
export function advanceGame(
  state: SpectraState,
  dt: number,
  cues: FrameCues,
): void {
  if (!(dt > 0)) return;
  const steps = subStepCount(dt);
  const h = dt / steps;
  for (let step = 0; step < steps; step += 1) subStep(state, h, cues);
}

/** One sub-step: everything advances by `h`, then the contacts resolve. */
function subStep(state: SpectraState, h: number, cues: FrameCues): void {
  // Accumulated on every screen, which is what makes it the game's own clock
  // rather than the play clock (`specs/instrumentation.md`).
  state.simTime += h;

  if (state.screen === "paused") return;

  if (state.screen === "stageIntro" || state.screen === "stageCleared") {
    advanceHold(state, h);
    return;
  }

  if (state.screen !== "inWave") return;

  state.swayClock += h;
  state.inversion = Math.max(0, state.inversion - h);
  advanceShipTimers(state, h);

  if (state.phase === "ready") {
    state.phaseTimer = Math.max(0, state.phaseTimer - h);
    if (state.phaseTimer <= 0) endReadyHold(state);
  }

  advanceDrones(state, h, cues);
  advanceBullets(state, h);
  advanceDischarge(state, h);
  advanceBursts(state, h);

  const removed = resolveContacts(state, cues);
  checkStageEnd(state, removed, cues);
}

// Orrery — what a running cycle is handed.
//
// The simulation is written against this and nothing else: the state it
// advances, the run inside it, the challenge it is running, the machine as the
// editor placed it, and the one call it makes outward — a cue, played from the
// frame that raised it (specs/ui.md "Audio"). Keeping it in its own module
// leaves `src/sim.ts` and `src/cycle.ts` free of a cycle between them.

import type { Cue } from "./constants";
import type { Challenge, OrreryState, PartState, SimState } from "./types";

/** The run, the machine, and the one call the simulation makes outward. */
export interface SimContext {
  /** The whole of the game's state; the run below is `state.sim`. */
  readonly state: OrreryState;
  /** The live run. */
  readonly sim: SimState;
  /** The challenge the run is against. */
  readonly challenge: Challenge;
  /** The machine as the editor placed it; locked for the whole run. */
  readonly parts: readonly PartState[];
  /** Ask for a cue on this frame. Played once, however often it is asked. */
  cue(cue: Cue): void;
}

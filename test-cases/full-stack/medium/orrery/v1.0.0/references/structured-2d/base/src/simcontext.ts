// Orrery — what a running cycle is handed.
//
// The simulation is written against this and nothing else: the state it
// advances, the run inside it, the challenge it is running, the machine as the
// editor placed it, and the two calls it makes outward — a cue, played from the
// frame that raised it (specs/ui.md "Audio"), and an effect, played at the
// position of the event that raised it (specs/assets.md "The particle
// effects"). Both are asked for rather than played: the frame decides what to
// do with them, so a run driven from code sounds and shows nothing at the call.
// Keeping it in its own module leaves `src/sim.ts` and `src/cycle.ts` free of a
// cycle between them.

import type { OrreryHost } from "./host";
import type { Challenge, PartState, SimState } from "./types";
import type { OrreryState } from "./state";

/** The run, the machine, and the two calls the simulation makes outward. */
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
  cue: OrreryHost["cue"];
  /** Ask for one produced particle effect, at a position on the stage. */
  effect: OrreryHost["effect"];
}

// Wick — what one tick works over.

import type { Cue } from "../constants";
import type { Rng } from "../rng";
import type { RunState, WickState } from "../state";

/** The four movement actions as held values, `1` while down. */
export interface Held {
  up: number;
  down: number;
  left: number;
  right: number;
}

export const NOTHING_HELD: Readonly<Held> = {
  up: 0,
  down: 0,
  left: 0,
  right: 0,
};

export interface TickContext {
  state: WickState;
  run: RunState;
  rng: Rng;
  held: Held;
  /** The cues this tick raises, each at most once. */
  cues: Set<Cue>;
  /** Whether a chest was collected on this tick. */
  chestCollected: boolean;
  /** Whether the aura of Halo or Corona pulses on this tick. */
  auraPulse: boolean;
}

/** A tick's context over `state`, with nothing yet collected or pulsed. */
export function makeTickContext(
  state: WickState,
  rng: Rng,
  held: Held,
  cues: Set<Cue>,
): TickContext {
  return {
    state,
    run: state.run,
    rng,
    held,
    cues,
    chestCollected: false,
    auraPulse: false,
  };
}

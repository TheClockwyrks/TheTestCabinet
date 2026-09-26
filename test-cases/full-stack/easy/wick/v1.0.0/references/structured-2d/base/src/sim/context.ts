// Wick — what one tick works over.

import type { CueName } from "../constants";
import type { Rng } from "../rng";
import type { Held, RunState, WickState } from "../state";

export interface TickContext {
  state: WickState;
  run: RunState;
  rng: Rng;
  held: Held;
  /** The cues this tick raises, each at most once. */
  cues: Set<CueName>;
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
  cues: Set<CueName>,
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

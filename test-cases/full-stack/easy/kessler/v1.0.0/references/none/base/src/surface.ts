// Kessler — installing `window.__kessler` (specs/instrumentation.md).
//
// The state operations come from `src/debug.ts`; this file adds the two
// clock operations that belong to the runtime — `setAutoStep`, which stops
// the frame loop feeding wall time into the tick accumulator, and `step`,
// which runs whole ticks immediately, each followed by a render — and
// installs the finished surface. Both validate loudly: an argument outside
// the domain its operation states fails rather than guessing what was meant.

import { createStateOps, type KesslerStateOps } from "./debug";
import type { Game } from "./game";

/** The runtime's clock, as the surface reaches it. Structural on purpose. */
export interface SurfaceClock {
  setAutoStep(auto: boolean): void;
  step(ticks: number): void;
}

/** The complete surface: the state operations plus the clock pair. */
export interface KesslerApi extends KesslerStateOps {
  setAutoStep(auto: boolean): void;
  step(ticks?: number): void;
}

/**
 * Build the complete surface over one live game and the runtime's clock.
 * `onReset` lets the runtime clear what it keeps outside the game — the
 * live particle effects — so a reset leaves the canvas as boot leaves it.
 */
export function createApi(
  game: Game,
  clock: SurfaceClock,
  onReset: () => void = () => undefined,
): KesslerApi {
  const state = createStateOps(game);
  return {
    ...state,

    reset() {
      state.reset();
      onReset();
    },

    setAutoStep(auto) {
      if (typeof auto !== "boolean") {
        throw new Error(
          `setAutoStep auto must be a boolean; got ${String(auto)}`,
        );
      }
      clock.setAutoStep(auto);
    },

    step(ticks = 1) {
      if (typeof ticks !== "number" || !Number.isInteger(ticks) || ticks < 1) {
        throw new Error(
          `step ticks must be a whole number of at least 1; got ${String(ticks)}`,
        );
      }
      clock.step(ticks);
    },
  };
}

/** Install the surface on `window.__kessler`. */
export function installApi(api: KesslerApi): void {
  (window as unknown as { __kessler: KesslerApi }).__kessler = api;
}

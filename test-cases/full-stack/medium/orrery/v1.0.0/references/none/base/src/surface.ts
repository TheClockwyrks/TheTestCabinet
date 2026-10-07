// Orrery — installing `window.__orrery` (specs/instrumentation.md).
//
// The state operations come from `src/debug.ts`. This file adds the two the
// runtime owns, because nothing outside this build owns the game's clock —
// `setAutoStep`, which stops the frame loop feeding wall time into the game,
// and `advance`, which runs whole frames immediately, each followed by a
// render — and installs the finished surface on the page as soon as the game
// has initialized.
//
// Both clock operations validate loudly, like every other: an argument outside
// the domain its operation states fails rather than being guessed at.

import { ORRERY_DEBUG_VERSION, ORRERY_SURFACE_KEY } from "./constants";
import { createStateOps, type OrreryStateOps } from "./debug";
import type { Game } from "./game";
import { requireBoolean, requireNumber, requireWhole } from "./validate";

/** The runtime's clock, as the surface reaches it. Structural on purpose. */
export interface SurfaceClock {
  setAutoStep(auto: boolean): void;
  advance(seconds: number, frames: number): void;
}

/** The complete surface: `version`, the state operations, and the clock pair. */
export interface OrreryDebugApi extends OrreryStateOps {
  /** `ORRERY_DEBUG_VERSION`, a plain number. */
  readonly version: number;
  setAutoStep(enabled: boolean): void;
  advance(seconds: number, frames?: number): void;
}

/** Build the complete surface over one live game and the runtime's clock. */
export function createSurface(game: Game, clock: SurfaceClock): OrreryDebugApi {
  return {
    version: ORRERY_DEBUG_VERSION,
    ...createStateOps(game),

    setAutoStep(enabled) {
      clock.setAutoStep(requireBoolean("setAutoStep", "enabled", enabled));
    },

    advance(seconds, frames = 1) {
      const span = requireNumber("advance", "seconds", seconds);
      const count = requireWhole("advance", "frames", frames, 1);
      clock.advance(span, count);
    },
  };
}

/** Install the surface on `window.__orrery`. */
export function installSurface(api: OrreryDebugApi): void {
  (window as unknown as Record<string, unknown>)[ORRERY_SURFACE_KEY] = api;
}

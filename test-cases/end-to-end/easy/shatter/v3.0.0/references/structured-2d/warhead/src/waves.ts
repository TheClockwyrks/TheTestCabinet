// Shatter — the wave loop: the clear, the banner, and the rocks it announces.
//
// A wave clears on a TRANSITION, not on a condition of the field
// (`specs/progression.md`): the tick in which the last rock is destroyed turns
// the wave over, and a field that holds no rocks and has had none destroyed on
// that tick is a wave being played. That is the whole difference between a game
// whose field was shot clear and one a caller emptied.
//
// The banner is a breather rather than a pause: only the rocks are held back,
// and everything else on the field goes on exactly as it was.

import { TICK_DT, WAVE_BANNER_TIME } from "./constants";
import type { ShatterState } from "./game";
import { spawnWave } from "./rocks";

/**
 * Advance the wave loop by one tick.
 *
 * `destroyed` is how many rocks this tick's collision resolution destroyed. A
 * banner already running still runs down whatever the gate says, since the gate
 * holds the game's own wave LOOP rather than the clock on a banner already up.
 */
export function advanceWaves(state: ShatterState, destroyed: number): void {
  if (state.waveBanner > 0) {
    state.waveBanner = Math.max(0, state.waveBanner - TICK_DT);
    if (state.waveBanner === 0 && state.waveSpawning) spawnWave(state);
    return;
  }

  if (!state.waveSpawning) return;
  if (destroyed === 0 || state.rocks.length > 0) return;

  state.wave += 1;
  state.waveBanner = WAVE_BANNER_TIME;
}

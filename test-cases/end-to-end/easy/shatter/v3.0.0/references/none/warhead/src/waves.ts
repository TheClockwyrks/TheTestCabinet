// Shatter — the wave loop.
//
// `specs/progression.md` states the rule this file exists to get exactly right:
//
//   A wave clears on the TICK IN WHICH the last rock on the field is destroyed.
//   It is a transition, not a condition on the field: a field that holds no rocks
//   and has had none destroyed on that tick is a wave being played, not a wave
//   cleared.
//
// So the loop asks two questions, not one — is the field empty, AND was a rock
// destroyed on this tick — which is why `src/rocks.ts` raises `rockDestroyed` on
// the destruction and nothing else does. A field emptied by the debug surface's
// `clearRocks`, or one that never had a rock on it, raises no banner and advances
// no wave, however long it is left running.
//
// The whole of it is gated by `waveSpawning` (`specs/instrumentation.md`), with
// one exception the specification names: a banner already running still runs
// down.

import { TICK_DT, WAVE_BANNER_TIME } from "./constants";
import type { ShatterState } from "./types";
import { spawnWave } from "./world";

/**
 * Notice a cleared wave, run the banner down, and put up the wave it announces.
 *
 * On the tick a wave clears the wave number advances by one and the banner is
 * raised, naming the wave about to start. The banner runs for
 * `WAVE_BANNER_TIME`, no rock is on the field at any point while it shows, and
 * the rocks it announced are spawned as it ends.
 *
 * It is a breather rather than a pause: nothing else in the tick is held back, so
 * the ship keeps flying, every timer keeps running, and a saucer already on the
 * field keeps travelling, keeps firing and can still be shot down.
 */
export function stepWaves(state: ShatterState): void {
  if (
    state.waveSpawning &&
    !state.waitingToSpawn &&
    state.waveBanner <= 0 &&
    state.rockDestroyed &&
    state.rocks.length === 0
  ) {
    state.wave += 1;
    state.waveBanner = WAVE_BANNER_TIME;
    state.waitingToSpawn = true;
  }

  if (state.waveBanner <= 0) {
    state.waveBanner = 0;
    return;
  }

  state.waveBanner -= TICK_DT;
  if (state.waveBanner > 0) return;

  state.waveBanner = 0;
  if (!state.waitingToSpawn) return;
  state.waitingToSpawn = false;
  // Gated even here: turning wave spawning off mid-banner lets the banner run
  // down, as `specs/instrumentation.md` says it does, and puts nothing up.
  if (state.waveSpawning) spawnWave(state, state.wave);
}

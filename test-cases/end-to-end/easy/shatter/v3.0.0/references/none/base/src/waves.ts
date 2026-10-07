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
 * the rocks it announced are spawned as it ends. The banner is the whole of the
 * arming: nothing is remembered beside it, so a banner posed through the debug
 * surface runs down and puts up the wave it names exactly as an earned one does,
 * which is what `specs/instrumentation.md` states of `setWaveBanner`.
 *
 * It is a breather rather than a pause: nothing else in the tick is held back, so
 * the ship keeps flying, every timer keeps running, and a saucer already on the
 * field keeps travelling, keeps firing and can still be shot down.
 */
export function stepWaves(state: ShatterState): void {
  // A banner already running runs down whatever else is true, and the wave it
  // announces goes up as it ends — the banner is the whole of the arming, so a
  // banner `setWaveBanner` posed behaves exactly like one a clear raised
  // (`specs/instrumentation.md`).
  if (state.waveBanner > 0) {
    state.waveBanner -= TICK_DT;
    // The epsilon is float slack, not slack on the rule: `WAVE_BANNER_TIME`
    // (1.5 s) is 180 whole ticks of `TICK_DT`, and 180 subtractions of a binary
    // approximation of a hundred-and-twentieth do not land exactly on zero.
    if (state.waveBanner > 1e-9) return;
    state.waveBanner = 0;
    // Gated even here: turning wave spawning off mid-banner lets the banner run
    // down, as `specs/instrumentation.md` says it does, and puts nothing up.
    if (state.waveSpawning) spawnWave(state, state.wave);
    return;
  }

  state.waveBanner = 0;
  if (!state.waveSpawning) return;
  if (!state.rockDestroyed || state.rocks.length > 0) return;

  state.wave += 1;
  state.waveBanner = WAVE_BANNER_TIME;
}

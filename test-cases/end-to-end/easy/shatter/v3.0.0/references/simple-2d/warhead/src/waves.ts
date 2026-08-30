// Shatter — the wave loop (`specs/progression.md`).
//
// A wave clears on a TRANSITION rather than on a predicate: the tick in which
// the last rock on the field is destroyed. A field that holds no rocks and has
// had none destroyed on that tick is a wave being played, not a wave cleared,
// which is why the count of rocks destroyed is read off the tick's own events
// rather than off the field. That distinction is the whole reason an emptied
// field — one a debug `clearRocks` left, say — does not raise a banner.
//
// The order inside a banner is fixed wherever one runs: the wave number advances
// and the banner appears on the tick of the clear, the banner runs for
// WAVE_BANNER_TIME with NO rock on the field, and the rocks it announces arrive
// as it ends.
//
// `waveSpawning` gates the game's own loop and nothing else, so a banner already
// running still runs down while the gate is off; it simply spawns nothing when
// it ends.

import { TICK_DT, WAVE_BANNER_TIME } from "./constants";
import { spawnWave } from "./rocks";
import type { FrameEvents, Sim } from "./sim";

/** Run the wave loop for one tick. */
export function runWaveLoop(sim: Sim, events: FrameEvents): void {
  if (sim.waveBanner > 0) {
    sim.waveBanner -= TICK_DT;
    if (sim.waveBanner <= 1e-9) {
      sim.waveBanner = 0;
      if (sim.waveSpawning) spawnWave(sim, sim.wave);
    }
    return;
  }

  if (!sim.waveSpawning) return;
  if (events.rocksDestroyed > 0 && sim.rocks.length === 0) {
    sim.wave += 1;
    sim.waveBanner = WAVE_BANNER_TIME;
  }
}

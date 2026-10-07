// Spectra — the drone-burst (`specs/assets.md`).
//
// `assets/drone-burst.json` is an authored particle system, and it is PLAYED
// rather than hand-coded: each burst owns a `ParticleSimulator` over that system
// and the render draws the particles the simulation reports. The pure simulator is
// what plays it, so a burst costs nothing but arithmetic and runs in a host with no
// canvas at all.
//
// Each burst scatters at random, so successive bursts in a run scatter differently
// while the flash, the ring and the two-band sparks read the same.

import { BURST_DURATION, MAX_BURSTS } from "./constants";
import { ParticleSimulator } from "@clockwyrks/particle-runtime";
import { randomWord } from "./random";
import { takeId, type Sim } from "./sim";

/** Start one burst at `(x, y)`, played at `size`. */
export function addBurst(sim: Sim, x: number, y: number, size: number): void {
  if (sim.art.burst === null) return;
  if (sim.bursts.length >= MAX_BURSTS) return;
  sim.bursts.push({
    id: takeId(sim),
    x,
    y,
    size,
    elapsed: 0,
    sim: new ParticleSimulator(sim.art.burst, { seed: randomWord() }),
  });
}

/** Advance every burst by `h`, and drop the ones that have finished playing. */
export function advanceBursts(sim: Sim, h: number): void {
  for (const burst of sim.bursts) {
    burst.elapsed += h;
    burst.sim.step(h * 1000);
  }
  sim.bursts = sim.bursts.filter((burst) => burst.elapsed < BURST_DURATION);
}

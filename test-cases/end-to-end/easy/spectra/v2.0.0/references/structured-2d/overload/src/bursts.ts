// Spectra — the drone-burst (specs/assets.md).
//
// `assets/drone-burst.json` is an authored particle system, and it is PLAYED
// rather than hand-coded: each live burst holds its own `ParticleSimulator` from
// `@clockwyrks/particle-runtime`, stepped with the same slice of time
// everything else on the field advances by, and `src/render.ts` draws the
// particles the simulation reports.
//
// Each burst is seeded from the game's own generator, which is what makes two
// bursts in one run scatter differently while a replay from the same seed
// reproduces both exactly.

import { BURST_DURATION, MAX_BURSTS } from "./constants";
import { ParticleSimulator } from "@clockwyrks/particle-runtime";
import { randomInt } from "./rng";
import { burstSystem } from "./sprites";
import type { BurstState, SpectraState } from "./game";

/**
 * Start one burst of `size` centred on a point.
 *
 * At most `MAX_BURSTS` play at once: a pop past the cap retires the oldest, so a
 * discharge that clears a whole wave costs a bounded amount of simulation.
 */
export function startBurst(
  state: SpectraState,
  x: number,
  y: number,
  size: number,
): BurstState {
  const seed = randomInt(state, 1, 0x7fffffff);
  const burst: BurstState = {
    id: state.nextId,
    x,
    y,
    size,
    elapsed: 0,
    sim: new ParticleSimulator(burstSystem(), { seed }),
  };
  state.nextId += 1;
  state.bursts.push(burst);
  while (state.bursts.length > MAX_BURSTS) state.bursts.shift();
  return burst;
}

/** Advance every burst by `h` seconds and retire the ones that have played out. */
export function advanceBursts(state: SpectraState, h: number): void {
  for (const burst of state.bursts) {
    burst.elapsed += h;
    burst.sim.step(h * 1000);
  }
  state.bursts = state.bursts.filter((burst) => burst.elapsed < BURST_DURATION);
}

/** Remove the burst with `id`. */
export function removeBurst(state: SpectraState, id: number): void {
  state.bursts = state.bursts.filter((burst) => burst.id !== id);
}

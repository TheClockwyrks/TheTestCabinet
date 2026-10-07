// Spectra — the drone-burst (specs/assets.md).
//
// `assets/drone-burst.json` is an authored particle system, and it is PLAYED
// rather than hand-coded: each live burst holds its own `ParticleSimulator` from
// `@clockwyrks/particle-runtime`, stepped with the same slice of time
// everything else on the field advances by, and `src/render.ts` draws the
// particles the simulation reports.
//
// Each burst scatters at random, so two bursts in one run scatter differently
// while the flash, the ring and the two-band sparks read the same.

import { BURST_DURATION, MAX_BURSTS } from "./constants";
import { ParticleSimulator } from "@clockwyrks/particle-runtime";
import { randomInt } from "./random";
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
  const seed = randomInt(1, 0x7fffffff);
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

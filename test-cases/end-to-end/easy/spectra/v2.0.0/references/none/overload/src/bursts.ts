// Spectra — the drone-burst, played rather than hand-coded.
//
// `assets/drone-burst.json` is the effect a destroyed drone pops with, and
// `specs/assets.md` is explicit that it is PLAYED: the build hands it to
// `@test-cabinet/particle-runtime`'s pure `ParticleSimulator`, steps that
// simulation, and draws the particles it reports.
//
// The pure simulator rather than the package's canvas player, for two reasons. It
// is the route that stays independent of a canvas, so a burst advances inside the
// game's own sub-step loop and `snapshot()` can report a live particle count; and
// it is the route that is fast, because the build draws the particles itself in one
// pass rather than issuing a radial gradient per particle per frame.
//
// EACH BURST IS SEEDED FROM THE GAME'S OWN GENERATOR, which is what makes two
// things true at once: successive pops in one run scatter differently, and a replay
// from the same seed reproduces the same sequence exactly
// (specs/instrumentation.md).

import {
  ParticleSimulator,
  type ParticleSystem,
  type RenderParticle,
} from "@test-cabinet/particle-runtime";
import { BURST_DURATION, BURST_FIELD, MAX_BURSTS } from "./constants";
import { nextSeed } from "./rng";
import type { SpectraState } from "./types";

/** One drone-burst playing on the field. */
export interface Burst {
  id: number;
  /** The burst's centre, in logical stage units. */
  x: number;
  y: number;
  /** The footprint the `BURST_FIELD` square is scaled to. */
  size: number;
  /** Seconds the effect has been playing. */
  elapsed: number;
  /** The burst's own particle simulation, or `null` where none could be loaded. */
  sim: ParticleSimulator | null;
}

/**
 * The system every burst is played from, handed over once at start-up.
 *
 * Held in a module-level binding rather than on the state because it is immutable
 * seeded data, not game state: `reset()` restores the state and the system is
 * unaffected.
 */
let system: ParticleSystem | null = null;

/** Hand the loaded system over. Called once, before the first frame. */
export function useBurstSystem(loaded: ParticleSystem | null): void {
  system = loaded;
}

/** The system in use, for the renderer's field-to-footprint scale. */
export function burstSystem(): ParticleSystem | null {
  return system;
}

/**
 * Start one burst centred on a destroyed drone, scaled to its own footprint.
 *
 * At most `MAX_BURSTS` play at once; the oldest gives way, so a discharge that
 * clears a whole field of divers still pops the ones a player is looking at.
 */
export function startBurst(
  state: SpectraState,
  id: number,
  x: number,
  y: number,
  footprint: number,
): Burst {
  const seed = nextSeed(state);
  const burst: Burst = {
    id,
    x,
    y,
    size: footprint,
    elapsed: 0,
    sim: system === null ? null : new ParticleSimulator(system, { seed }),
  };
  // `reset` fires the system's zero-time bursts, so the effect already carries its
  // flash on the frame it starts rather than one frame later.
  burst.sim?.reset();
  state.bursts.push(burst);
  while (state.bursts.length > MAX_BURSTS) state.bursts.shift();
  return burst;
}

/**
 * Advance every live burst by `h` seconds and retire the ones that are done.
 *
 * Inside the game's sub-step loop, so a burst's age and its live particle count are
 * reached the same way however a second of game time was divided into frames. A
 * burst is a one-shot: it plays for `BURST_DURATION` and is then gone, with nothing
 * looping and nothing lingering.
 */
export function stepBursts(state: SpectraState, h: number): void {
  for (const burst of state.bursts) {
    burst.elapsed += h;
    burst.sim?.step(h * 1000);
  }
  state.bursts = state.bursts.filter((burst) => burst.elapsed < BURST_DURATION);
}

/** How many live particles a burst's own simulation holds right now. */
export function burstParticles(burst: Burst): number {
  return burst.sim?.liveCount ?? 0;
}

/** The burst's live particles, with each one's appearance already evaluated. */
export function captureBurst(burst: Burst): RenderParticle[] {
  return burst.sim?.capture() ?? [];
}

/** How many logical units one unit of the burst's authored field covers. */
export function burstScale(burst: Burst): number {
  return burst.size / BURST_FIELD;
}

// Spectra — the drone-burst (`specs/assets.md`).
//
// The burst is the seeded particle system `assets/drone-burst.json`, PLAYED
// rather than hand-coded and never replaced. It is played with the runtime's
// pure `ParticleSimulator`: the build steps each burst's own simulation by the
// frame's time and draws the particles that simulation reports, which is the
// route that stays headless-clean and the route that stays cheap — the package's
// canvas player issues a radial gradient per particle per frame, and a discharge
// over a full stage is on the order of ten thousand particles.
//
// Each burst is SEEDED FROM THE GAME'S OWN GENERATOR, so successive bursts in a
// run scatter differently while a replay from one seed reproduces them exactly.

import { ParticleSimulator } from "@clockwyrks/particle-runtime";
import { art } from "./assets";
import { BURST_DURATION, BURST_FIELD, MAX_BURSTS } from "./constants";
import { random, takeId } from "./entities";
import type { BurstState, SpectraState } from "./game";
import type { ParticleSystem } from "@clockwyrks/particle-runtime";

/**
 * The system a burst falls back to where the seeded file did not arrive.
 *
 * `specs/state.md` declares a burst's own simulation as part of the burst, so a
 * burst is a simulation whether or not this host could fetch the file. This one
 * emits nothing: the roster, the ids, the placement and the timing are all
 * exactly what they would be, and the effect has no particles to draw.
 */
const SILENT_SYSTEM: ParticleSystem = {
  dimensions: 2,
  field: { width: BURST_FIELD, height: BURST_FIELD },
  durationMs: BURST_DURATION * 1000,
  fps: 60,
  loop: false,
  emitters: [
    {
      name: "none",
      shape: "point",
      position: [BURST_FIELD / 2, BURST_FIELD / 2, 0],
      extent: { radius: 1, size: [1, 1, 0] },
      emission: { mode: "burst", count: 0, atMs: 0 },
      lifetimeMs: 1,
      speed: 0,
      direction: [0, 1, 0],
    },
  ],
};

/**
 * Start one burst at `(x, y)`, played at the footprint `size`.
 *
 * A burst is an OUTCOME: this is called from the moment a drone is destroyed and
 * from nowhere else, which is why the debug surface has a `removeBurst` and a
 * `clearBursts` and no `addBurst`.
 */
export function startBurst(
  state: SpectraState,
  x: number,
  y: number,
  size: number,
): void {
  const seed = Math.floor(random(state) * 0x7fffffff);
  const burst: BurstState = {
    id: takeId(state),
    x,
    y,
    size,
    elapsed: 0,
    sim: new ParticleSimulator(art().burst ?? SILENT_SYSTEM, { seed }),
  };
  state.bursts.push(burst);
  // At most `MAX_BURSTS` play at once, and the newest is the one worth seeing.
  if (state.bursts.length > MAX_BURSTS) {
    state.bursts.splice(0, state.bursts.length - MAX_BURSTS);
  }
}

/** Advance every burst by `h` seconds, dropping the ones that have finished. */
export function stepBursts(state: SpectraState, h: number): void {
  if (state.bursts.length === 0) return;
  for (const burst of state.bursts) {
    burst.elapsed += h;
    burst.sim.step(h * 1000);
  }
  state.bursts = state.bursts.filter((burst) => burst.elapsed < BURST_DURATION);
}

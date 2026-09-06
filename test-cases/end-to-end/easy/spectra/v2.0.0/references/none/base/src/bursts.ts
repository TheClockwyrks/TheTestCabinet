// Spectra — the drone-burst: the seeded particle system, played.
//
// `specs/assets.md` seeds `drone-burst.json` and says it is PLAYED, not
// hand-coded and not replaced. So each destroyed drone gets its own
// `ParticleSimulator` over the seeded system — the package's pure simulator, not
// its canvas player, because the pure one keeps the effect headless-clean and
// leaves the drawing here, where it can be composited additively straight over
// the field.
//
// EACH BURST SCATTERS AT RANDOM (specs/assets.md), so successive bursts in a run
// scatter differently while the flash, the ring and the two-band sparks read the
// same.
//
// THE SIMULATION IS STEPPED INSIDE THE SUB-STEP LOOP, by the sub-step's own `h`.
// It is stepped by game time like everything else, which is what keeps
// `advance(1, 1)` and `advance(1, 60)` reaching the same state.

import { ParticleSimulator } from "@clockwyrks/particle-runtime";

import { BURST_DURATION, BURST_FIELD, MAX_BURSTS } from "./constants";
import { word } from "./random";
import type { Burst, SpectraState } from "./types";

/**
 * The canvas radius a unit-size particle draws at, before the field-to-footprint
 * fit. The runtime's own canvas binding uses a fiftieth of the field extent, and
 * matching it keeps the seeded system reading the way it was authored.
 */
const UNIT_RADIUS = BURST_FIELD * 0.02;

/** The smallest radius a particle is drawn at, so a small pop still reads. */
const MIN_RADIUS = 0.7;

/**
 * Start one burst centred on `(x, y)`, playing the seeded system's square field
 * at `size`.
 *
 * At most `MAX_BURSTS` play at once; a further one displaces the oldest, so a
 * discharge clearing a field-full of divers pops the newest of them rather than
 * dropping every pop after the cap.
 */
export function startBurst(
  state: SpectraState,
  x: number,
  y: number,
  size: number,
): Burst {
  const burst: Burst = {
    id: state.nextId++,
    x,
    y,
    size,
    elapsed: 0,
    sim: new ParticleSimulator(state.art.burst, { seed: word() }),
  };
  state.bursts.push(burst);
  while (state.bursts.length > MAX_BURSTS) state.bursts.shift();
  return burst;
}

/**
 * Advance every live burst by `h` seconds and drop the ones whose span is up.
 *
 * A burst plays for `BURST_DURATION` and is then gone: nothing loops and nothing
 * lingers.
 */
export function stepBursts(state: SpectraState, h: number): void {
  if (state.bursts.length === 0) return;
  for (const burst of state.bursts) {
    burst.elapsed += h;
    burst.sim.step(h * 1000);
  }
  state.bursts = state.bursts.filter((burst) => burst.elapsed < BURST_DURATION);
}

/**
 * Composite every live burst additively over the field, in logical units.
 *
 * The seeded system is authored on a `BURST_FIELD` square with `y` up, so the
 * field's centre maps onto the burst's centre and `y` is flipped on the way out.
 * A particle's own velocity-stretch elongates it along its travel, which is what
 * gives the ring and the spark streaks their direction.
 */
export function drawBursts(
  ctx: CanvasRenderingContext2D,
  state: SpectraState,
): void {
  if (state.bursts.length === 0) return;
  const previous = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = "lighter";
  const half = BURST_FIELD / 2;
  for (const burst of state.bursts) {
    const scale = burst.size / BURST_FIELD;
    for (const particle of burst.sim.capture()) {
      if (particle.opacity <= 0.004) continue;
      const px = burst.x + (particle.position[0] - half) * scale;
      const py = burst.y - (particle.position[1] - half) * scale;
      const radius = Math.max(particle.size * UNIT_RADIUS * scale, MIN_RADIUS);
      const [r, g, b] = toBytes(particle.color);
      const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
      gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${particle.opacity})`);
      gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
      ctx.save();
      ctx.translate(px, py);
      const stretch = particle.stretch;
      if (stretch > 1) {
        const vx = particle.velocity[0];
        // The field's `y` is up and the stage's is down, so the angle flips too.
        const vy = -particle.velocity[1];
        if (vx !== 0 || vy !== 0) {
          ctx.rotate(Math.atan2(vy, vx));
          ctx.scale(stretch, 1 / Math.sqrt(stretch));
        }
      }
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
  ctx.globalCompositeOperation = previous;
}

/** A linear `0..1` RGB triple as `0..255` channels, the way the runtime does it. */
function toBytes(
  color: readonly [number, number, number],
): [number, number, number] {
  return [byte(color[0]), byte(color[1]), byte(color[2])];
}

function byte(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 255);
}

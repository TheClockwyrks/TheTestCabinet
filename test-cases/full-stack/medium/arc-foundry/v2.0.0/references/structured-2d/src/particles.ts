// Arc Foundry — the produced electrical bursts (specs/assets.md).
//
// Every electrical event fires the matching PRODUCED particle system, simulated live by
// `@test-cabinet/particle-runtime` and composited additively over the yard at the
// event's position. A burst is simulated rather than played back, so it varies shot to
// shot, and its size escalates with the quality of the structure that threw it.
//
// THE PURE SIMULATOR, COMPOSITED HERE. The engine's declarative pipeline draws no
// particles, so a produced system is drawn from a draw component handed the raw context.
// The runtime also ships a canvas binding, which owns an offscreen canvas of its own and
// draws the system into it; this build uses the simulator directly and composites the
// particles itself, because that needs no second drawing surface behind it — one field's
// worth of discs goes straight into stage coordinates. That is what lets the same code
// run under the browser's canvas and under a canvas with no document behind it.
//
// A BURST IS CARRIED BY THE STATE. `FoundryState.bursts` holds the ones still playing:
// the simulator behind one is a live object the record points at, the way a decoded
// sprite is, and the game mode's tick steps every one of them each frame.
// `BurstPlayer` is the narrow surface the state names it under, so nothing outside this
// module holds the runtime's own type.

import { ParticleSimulator } from "@test-cabinet/particle-runtime";
import type { EffectName } from "./constants";
import { qualityIndex } from "./theme";
import type { Assets } from "./assets";
import type { FxEvent } from "./types";

/**
 * A burst's simulation, as the state names it.
 *
 * Deliberately a handful of operations rather than the runtime's class, so the state
 * names only what a burst is asked to do and the runtime's own type stays inside this
 * module.
 */
export interface BurstPlayer {
  /** Advance the simulation by a span of real seconds. */
  step(seconds: number): void;
  /** How many particles are still alive. */
  liveCount(): number;
  /**
   * Visit every live particle, in field coordinates: `fx` and `fy` are `0..1` across
   * the field with `y` up, `size` is the particle's own scale, `color` is its `0..1`
   * RGB, and `alpha` its opacity.
   */
  each(
    visit: (
      fx: number,
      fy: number,
      size: number,
      color: readonly [number, number, number],
      alpha: number,
    ) => void,
  ): void;
}

/** One burst on the yard: where it plays, how large, and how far through it is. */
export interface Burst {
  play: BurstPlayer;
  /** The stage position it is centered on, in logical units. */
  x: number;
  y: number;
  /** The side of the box the field is fitted into, in logical units. */
  size: number;
  /** Real seconds since it was raised. */
  age: number;
  /** The system's own duration, in seconds. */
  duration: number;
}

/**
 * The box each effect is fitted into, in logical units.
 *
 * The systems are authored on their own field and this is what maps that field onto the
 * yard, so an impact reads as a spark at a unit's size and an aura as a slow ring around
 * a whole footprint.
 */
const FOOTPRINT: Readonly<Record<EffectName, number>> = {
  build: 48,
  combine: 60,
  bolt: 44,
  chain: 56,
  spray: 40,
  ring: 78,
  impact: 30,
  death: 50,
  leak: 60,
  /** The drag snap clinging to a slowed unit. */
  slow: 34,
  /** The ember flare of a burn. */
  burn: 30,
  /** The slow pulse at an aura's source. */
  aura: 96,
};

/** How long a finished burst is kept before it is dropped, in seconds. */
const LINGER = 0.12;

/** The quality scales a firing burst, so the ladder reads in the effects too. */
function qualityScale(quality: number | undefined): number {
  if (quality === undefined) return 1;
  return 0.8 + 0.18 * (qualityIndex(quality) + 1);
}

/**
 * Raise a burst for an event, or nothing when its system did not arrive.
 *
 * A segment effect, an arc bolt or a chain leap, is centered on the midpoint of the two
 * ends it carries; a point effect on its own position.
 */
export function spawnBurst(assets: Assets, ev: FxEvent): Burst | null {
  const system = assets.effect(ev.kind);
  if (!system) return null;
  const simulator = new ParticleSimulator(system);
  const fieldW = Math.max(system.field.width, 1);
  const fieldH = Math.max(system.field.height, 1);
  return {
    play: {
      step: (seconds) => simulator.step(seconds * 1000),
      liveCount: () => simulator.liveCount,
      each: (visit) => {
        for (const p of simulator.capture()) {
          visit(
            p.position[0] / fieldW,
            p.position[1] / fieldH,
            p.size,
            p.color,
            p.opacity,
          );
        }
      },
    },
    x: ev.x2 === undefined ? ev.x : (ev.x + ev.x2) / 2,
    y: ev.y2 === undefined ? ev.y : (ev.y + ev.y2) / 2,
    size:
      FOOTPRINT[ev.kind] * 2 * qualityScale(ev.quality) * (ev.big ? 2.2 : 1),
    age: 0,
    duration: system.durationMs / 1000,
  };
}

/**
 * Advance every burst by a span of real seconds and drop the ones that are finished.
 *
 * A burst is kept while its system is still within its own duration, and beyond that
 * for as long as it still has a particle alive, so a long-lived ember is not cut off
 * mid-flight.
 */
export function stepBursts(bursts: readonly Burst[], seconds: number): Burst[] {
  const out: Burst[] = [];
  for (const b of bursts) {
    b.play.step(seconds);
    const age = b.age + seconds;
    if (age < b.duration + LINGER || b.play.liveCount() > 0) {
      out.push({ ...b, age });
    }
  }
  return out;
}

/**
 * Composite every burst over the yard.
 *
 * Each particle is a soft radial disc, drawn additively, which is what reads as
 * electrical discharge. The field's `y` runs up and the stage's runs down, so the
 * vertical axis is flipped as the field is fitted into the burst's box.
 */
export function drawBursts(
  ctx: CanvasRenderingContext2D,
  bursts: readonly Burst[],
): void {
  const previous = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = "lighter";
  for (const b of bursts) {
    const x0 = b.x - b.size / 2;
    const y0 = b.y - b.size / 2;
    // A particle of unit size draws at this radius before its own scale is applied.
    const unit = b.size * 0.02;
    b.play.each((fx, fy, size, color, alpha) => {
      if (alpha <= 0) return;
      const r = Math.max(size * unit, 0.5);
      const px = x0 + fx * b.size;
      const py = y0 + (1 - fy) * b.size;
      const cr = channel(color[0]);
      const cg = channel(color[1]);
      const cb = channel(color[2]);
      const grad = ctx.createRadialGradient(px, py, 0, px, py, r);
      grad.addColorStop(0, `rgba(${cr}, ${cg}, ${cb}, ${alpha})`);
      grad.addColorStop(1, `rgba(${cr}, ${cg}, ${cb}, 0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  ctx.globalCompositeOperation = previous;
}

/** A linear `0..1` channel as a `0..255` integer. */
function channel(v: number): number {
  return Math.round((v < 0 ? 0 : v > 1 ? 1 : v) * 255);
}

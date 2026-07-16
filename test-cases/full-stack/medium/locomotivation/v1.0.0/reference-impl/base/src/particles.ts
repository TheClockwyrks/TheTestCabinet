// Locomotivation — the produced particle VFX, played LIVE (specs/assets.md).
//
// Each world event fires the matching PRODUCED `system.json`, simulated live through
// @test-cabinet/particle-runtime's canvas binding — not a flat flash or a hand-coded loop.
// Each burst simulates on its own small offscreen field canvas and is composited over the
// yard at the event's WORLD position, so it varies shot to shot. The REQUIRED effect is the
// cargo splinter when a train destroys freight; squish, delivery, and dust are expected. A
// missing system.json is simply skipped (the build still runs — the tolerance rule).

import { ParticleCanvasPlayer } from "@test-cabinet/particle-runtime/canvas";
import type { ParticleSystem } from "@test-cabinet/particle-runtime";

/** The produced particle systems the game fires (keys under assets/fx/). */
export type FxKind =
  | "cargo-splinter" // REQUIRED — a train smashes freight
  | "worker-squish" // the worker is killed under a train
  | "delivery-burst" // a package delivered to its zone
  | "footstep-dust" // the worker moves (esp. sprinting)
  | "signal-spark" // a train passes / a signal flips to danger
  | "last-train-smoke"; // the last train arrives/departs

/** A burst request in WORLD (logical-pixel) coordinates. */
export interface FxEvent {
  kind: FxKind;
  x: number;
  y: number;
  /** Grows the footprint for bigger blasts (default 1). */
  scale?: number;
}

/** On-screen footprint (logical px) each effect's field maps to. */
const FOOTPRINT: Record<FxKind, number> = {
  "cargo-splinter": 70,
  "worker-squish": 64,
  "delivery-burst": 60,
  "footstep-dust": 34,
  "signal-spark": 40,
  "last-train-smoke": 120,
};

/** Effects that read best composited additively (energy) vs. over (smoke/debris). */
const ADDITIVE: Record<FxKind, boolean> = {
  "cargo-splinter": false,
  "worker-squish": false,
  "delivery-burst": true,
  "footstep-dust": false,
  "signal-spark": true,
  "last-train-smoke": false,
};

const FIELD = 128;
const MAX_LIVE = 40;

interface Live {
  player: ParticleCanvasPlayer;
  canvas: HTMLCanvasElement;
  additive: boolean;
  x: number;
  y: number;
  size: number;
  age: number;
  dur: number;
}

/**
 * Owns the live particle bursts. Each `spawn` starts a fresh `ParticleCanvasPlayer` for the
 * produced system; `update` advances them; `draw` composites the active ones over the yard.
 */
export class Particles {
  private readonly systems: Record<string, ParticleSystem>;
  private live: Live[] = [];

  constructor(systems: Record<string, ParticleSystem>) {
    this.systems = systems;
  }

  /** Fire a fresh simulated burst of `ev.kind` at its world position. */
  spawn(ev: FxEvent): void {
    const system = this.systems[ev.kind];
    if (!system) return;
    const canvas = document.createElement("canvas");
    canvas.width = FIELD;
    canvas.height = FIELD;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const additive = ADDITIVE[ev.kind];
    const player = new ParticleCanvasPlayer(system, ctx, {
      composite: additive ? "lighter" : "source-over",
      clear: true,
    });
    this.live.push({
      player,
      canvas,
      additive,
      x: ev.x,
      y: ev.y,
      size: FOOTPRINT[ev.kind] * 2 * (ev.scale ?? 1),
      age: 0,
      dur: system.durationMs,
    });
    if (this.live.length > MAX_LIVE) this.live.shift();
  }

  /** Advance every live burst by `dt`; retire finished ones. */
  update(dt: number): void {
    for (const b of this.live) {
      b.player.update(dt);
      b.age += dt * 1000;
    }
    this.live = this.live.filter((b) => b.age < b.dur + 250 || b.player.simulator.liveCount > 0);
  }

  /** Composite every live burst over the yard (no camera offset — the view never scrolls). */
  draw(ctx: CanvasRenderingContext2D): void {
    for (const b of this.live) {
      ctx.globalCompositeOperation = b.additive ? "lighter" : "source-over";
      ctx.drawImage(b.canvas, b.x - b.size / 2, b.y - b.size / 2, b.size, b.size);
    }
    ctx.globalCompositeOperation = "source-over";
  }

  clear(): void {
    this.live = [];
  }
}

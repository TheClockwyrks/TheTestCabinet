// Spectra — the drone-burst effect (specs/assets.md).
//
// When a drone pops we play the PROVIDED particle system (assets/drone-burst.json)
// through the PROVIDED runtime — @test-cabinet/particle-runtime's canvas binding —
// not a hand-coded effect. Each pop is simulated live on its own 128x128 offscreen
// canvas (the system's field size), then composited additively over the field at
// the drone's position, scaled to the drone's footprint. Because it is simulated,
// the scatter varies pop to pop while the character (flash / ring / two-band
// sparks) stays the same.

import { ParticleCanvasPlayer } from "@test-cabinet/particle-runtime/canvas";
import type { ParticleSystem } from "@test-cabinet/particle-runtime";

const FIELD = 128; // the system's authored field size

interface LiveBurst {
  player: ParticleCanvasPlayer;
  canvas: HTMLCanvasElement;
  x: number;
  y: number;
  size: number; // on-field footprint the 128x128 field is scaled to
  age: number;
}

export class Bursts {
  private live: LiveBurst[] = [];
  constructor(private readonly system: ParticleSystem) {}

  // Spawn one burst centered at (x, y), scaled so the effect reads at ~`footprint`.
  spawn(x: number, y: number, footprint: number): void {
    const canvas = document.createElement("canvas");
    canvas.width = FIELD;
    canvas.height = FIELD;
    const ctx = canvas.getContext("2d")!;
    // A fresh (unseeded) play so each detonation scatters differently.
    const player = new ParticleCanvasPlayer(this.system, ctx, {
      composite: "lighter",
      clear: true,
    });
    this.live.push({ player, canvas, x, y, size: footprint * 2.3, age: 0 });
  }

  // Advance every burst by real time `dt` (visual only). Finished one-shots are
  // dropped once the system's clock passes its duration and no particles remain.
  update(dt: number): void {
    const dur = this.system.durationMs;
    for (const b of this.live) {
      b.player.update(dt);
      b.age += dt * 1000;
    }
    this.live = this.live.filter(
      (b) => b.age < dur + 100 || b.player.simulator.liveCount > 0,
    );
  }

  // Composite the live bursts additively into the field (logical space).
  draw(ctx: CanvasRenderingContext2D): void {
    const prev = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = "lighter";
    for (const b of this.live) {
      ctx.drawImage(b.canvas, b.x - b.size / 2, b.y - b.size / 2, b.size, b.size);
    }
    ctx.globalCompositeOperation = prev;
  }

  // A read of the live bursts, for snapshot() and the debug overlay
  // (specs/instrumentation.md). The footprint the effect is drawn at.
  list(): Array<{ x: number; y: number; size: number }> {
    return this.live.map((b) => ({ x: b.x, y: b.y, size: b.size }));
  }

  clear(): void {
    this.live = [];
  }
}

// Valence — the decomposition particle bursts (specs/assets.md).
//
// Each decomposition event fires the matching PRODUCED particle system, played LIVE
// through @test-cabinet/particle-runtime's canvas binding — not a flat flash or a
// hand-coded effect. A burst is simulated on its own offscreen 128x128 canvas (the
// system's field size) and composited additively over the board at the event's
// position, so — being simulated — it varies shot to shot.

import { ParticleCanvasPlayer } from "@test-cabinet/particle-runtime/canvas";
import type { ParticleSystem } from "@test-cabinet/particle-runtime";
import type { FxEvent, FxKind } from "./types";

const FIELD = 128; // the authored field size of every fx system

// On-board footprint each burst is scaled to (the 128x128 field maps to this box).
const FOOTPRINT: Record<FxKind, number> = {
  ionize: 46,
  bondsnap: 52,
  fission: 78,
  neutralize: 50,
  muzzle: 30,
  leak: 60,
};

interface Live {
  player: ParticleCanvasPlayer;
  canvas: HTMLCanvasElement;
  x: number;
  y: number;
  size: number;
  age: number;
  dur: number;
}

export class Bursts {
  private live: Live[] = [];
  constructor(private readonly systems: Record<FxKind, ParticleSystem>) {}

  spawn(ev: FxEvent): void {
    const system = this.systems[ev.kind];
    if (!system) return;
    const canvas = document.createElement("canvas");
    canvas.width = FIELD;
    canvas.height = FIELD;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const player = new ParticleCanvasPlayer(system, ctx, { composite: "lighter", clear: true });
    this.live.push({
      player,
      canvas,
      x: ev.x,
      y: ev.y,
      size: FOOTPRINT[ev.kind] * 2.0,
      age: 0,
      dur: system.durationMs,
    });
  }

  update(dt: number): void {
    for (const b of this.live) {
      b.player.update(dt);
      b.age += dt * 1000;
    }
    this.live = this.live.filter((b) => b.age < b.dur + 120 || b.player.simulator.liveCount > 0);
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const prev = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = "lighter";
    for (const b of this.live) {
      ctx.drawImage(b.canvas, b.x - b.size / 2, b.y - b.size / 2, b.size, b.size);
    }
    ctx.globalCompositeOperation = prev;
  }

  clear(): void {
    this.live = [];
  }
}

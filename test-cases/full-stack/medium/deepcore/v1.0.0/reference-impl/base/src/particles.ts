// Deepcore — the produced particle VFX, played LIVE (specs/assets.md).
//
// Every world event (a drill bite, a jetpack plume, an ore glint, a gas blast, the core
// extraction and detonation, the launch column, a death burst) fires the matching
// PRODUCED `system.json`, simulated live through @test-cabinet/particle-runtime's canvas
// binding — not a flat flash or a hand-coded loop. Each burst simulates on its own small
// offscreen field canvas and is composited additively over the mine at the event's WORLD
// position; being simulated, it varies shot to shot. If a system.json is not present yet,
// the burst is simply skipped (the build still runs — specs/assets.md tolerance rule).

import { ParticleCanvasPlayer } from "@test-cabinet/particle-runtime/canvas";
import type { ParticleSystem } from "@test-cabinet/particle-runtime";

export type FxKind =
  | "gas-seep"
  | "drill-debris"
  | "jetpack-exhaust"
  | "ore-sparkle"
  | "material-shimmer"
  | "gas-explosion"
  | "lava-embers"
  | "impact-dust"
  | "core-extract"
  | "core-detonation"
  | "launch-exhaust"
  | "death-burst";

/** A burst request in WORLD coordinates. `scale` grows the footprint (big blasts). */
export interface FxEvent {
  kind: FxKind;
  x: number;
  y: number;
  scale?: number;
}

/** The on-screen footprint (logical px) each effect's field maps to (scaled with the 80px tile). */
const FOOTPRINT: Record<FxKind, number> = {
  "gas-seep": 44,
  "drill-debris": 72,
  "jetpack-exhaust": 84,
  "ore-sparkle": 60,
  "material-shimmer": 78,
  "gas-explosion": 144,
  "lava-embers": 66,
  "impact-dust": 84,
  "core-extract": 165,
  "core-detonation": 390,
  "launch-exhaust": 300,
  "death-burst": 135,
};

/** Effects that read best composited additively (fire/energy) vs. over (smoke/debris). */
const ADDITIVE: Record<FxKind, boolean> = {
  "gas-seep": false,
  "drill-debris": false,
  "jetpack-exhaust": true,
  "ore-sparkle": true,
  "material-shimmer": true,
  "gas-explosion": true,
  "lava-embers": true,
  "impact-dust": false,
  "core-extract": true,
  "core-detonation": true,
  "launch-exhaust": true,
  "death-burst": true,
};

const FIELD = 128;

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

export class Bursts {
  private live: Live[] = [];
  constructor(private readonly systems: Partial<Record<FxKind, ParticleSystem | undefined>>) {}

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
    // Cap the number of concurrent bursts so a long dig cannot leak canvases.
    if (this.live.length > 48) this.live.shift();
  }

  update(dt: number): void {
    for (const b of this.live) {
      b.player.update(dt);
      b.age += dt * 1000;
    }
    this.live = this.live.filter((b) => b.age < b.dur + 200 || b.player.simulator.liveCount > 0);
  }

  /** Composite every live burst over the world, offset so world → screen (camera). */
  draw(ctx: CanvasRenderingContext2D, offsetX: number, offsetY: number): void {
    for (const b of this.live) {
      ctx.globalCompositeOperation = b.additive ? "lighter" : "source-over";
      ctx.drawImage(b.canvas, b.x + offsetX - b.size / 2, b.y + offsetY - b.size / 2, b.size, b.size);
    }
    ctx.globalCompositeOperation = "source-over";
  }

  clear(): void {
    this.live = [];
  }

  get count(): number {
    return this.live.length;
  }
}

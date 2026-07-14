// Arc Foundry — the produced electrical particle bursts (specs/assets.md — THE HEADLINE).
//
// Every electrical event fires the matching PRODUCED particle system, played LIVE through
// @test-cabinet/particle-runtime's canvas binding — not a flat flash or a hand-coded loop.
// A burst is simulated on its own offscreen field canvas and composited additively over
// the yard at the event's position, so — being simulated — it varies shot to shot, and
// its intensity is escalated with the firing component's quality tier (specs/towers.md).

import { ParticleCanvasPlayer } from "@test-cabinet/particle-runtime/canvas";
import type { ParticleSystem } from "@test-cabinet/particle-runtime";
import type { FxEvent, FxKind, Tier } from "./types";

const FIELD = 128; // the authored field size of every fx system

// On-board footprint each burst is scaled to (the field maps to this box, in logical px).
const FOOTPRINT: Record<FxKind, number> = {
  buildspark: 48,
  combine: 60,
  arcbolt: 44,
  chain: 56,
  spray: 40,
  ring: 78,
  impact: 30,
  death: 50,
  leak: 60,
  muzzle: 24,
};

// The quality tier scales a firing burst's size so the ladder reads in the VFX
// (specs/assets.md "Escalate the firing effects with quality").
function tierScale(tier: Tier | undefined): number {
  if (!tier) return 1;
  return 0.8 + 0.18 * tier; // T1 ≈ 0.98 … T5 ≈ 1.7
}

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
  constructor(private readonly systems: Record<FxKind, ParticleSystem | undefined>) {}

  spawn(ev: FxEvent): void {
    const system = this.systems[ev.kind];
    if (!system) return;
    const canvas = document.createElement("canvas");
    canvas.width = FIELD;
    canvas.height = FIELD;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const player = new ParticleCanvasPlayer(system, ctx, { composite: "lighter", clear: true });
    // A segment effect (arc bolt / a chain leap) is anchored at its midpoint; point
    // effects at (x, y). The far end (x2, y2) drives the arc rendering the renderer layers.
    const cx = ev.x2 != null ? (ev.x + ev.x2) / 2 : ev.x;
    const cy = ev.y2 != null ? (ev.y + ev.y2) / 2 : ev.y;
    this.live.push({
      player,
      canvas,
      x: cx,
      y: cy,
      size: FOOTPRINT[ev.kind] * 2.0 * tierScale(ev.tier) * (ev.big ? 2.2 : 1),
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

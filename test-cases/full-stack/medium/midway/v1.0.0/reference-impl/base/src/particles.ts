// Midway — the produced particle systems, played LIVE (specs/assets.md, ASSETS.md §3).
//
// Each effect is simulated live through @test-cabinet/particle-runtime's canvas binding —
// never a flat flash or baked frames. ONE-SHOTS (fireworks over the park, a janitor's
// cleanup puff) run once and are pruned; LOOPS (a steam vent over a serving food/drink
// stall, a sparkle over a running ride) are held by a key while the stall/ride is active
// and dropped when it goes idle/broken. A system is simulated on its own offscreen
// 128x128 field canvas and composited over the park at the event's world position; being
// simulated, each play varies.

import { ParticleCanvasPlayer } from "@test-cabinet/particle-runtime/canvas";
import type { ParticleSystem } from "@test-cabinet/particle-runtime";
import type { FxKind } from "./types";

const FIELD = 128; // the authored field size of every fx system

// On-park footprint (world px box) each system composites into, and its blend mode:
// energy/celebration reads additive ("lighter"); smoke/debris reads "source-over".
const FOOTPRINT: Record<FxKind, number> = {
  fireworks: 120,
  steam: 40,
  sparkle: 56,
  cleanup: 34,
};
const COMPOSITE: Record<FxKind, GlobalCompositeOperation> = {
  fireworks: "lighter",
  steam: "source-over",
  sparkle: "lighter",
  cleanup: "source-over",
};

interface LiveFx {
  kind: FxKind;
  player: ParticleCanvasPlayer;
  canvas: HTMLCanvasElement;
  x: number;
  y: number;
  size: number;
  composite: GlobalCompositeOperation;
}

interface OneShot extends LiveFx {
  age: number; // ms
  dur: number; // ms
}

export class Particles {
  private oneShots: OneShot[] = [];
  private loops = new Map<string, LiveFx>();

  constructor(private readonly systems: Record<FxKind, ParticleSystem | undefined>) {}

  private make(kind: FxKind, x: number, y: number): LiveFx | null {
    const system = this.systems[kind];
    if (!system) return null;
    const canvas = document.createElement("canvas");
    canvas.width = FIELD;
    canvas.height = FIELD;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const composite = COMPOSITE[kind];
    const player = new ParticleCanvasPlayer(system, ctx, { composite, clear: true });
    return { kind, player, canvas, x, y, size: FOOTPRINT[kind], composite };
  }

  // Fire a one-shot (fireworks / cleanup) at a world position.
  spawnOneShot(kind: FxKind, x: number, y: number): void {
    const fx = this.make(kind, x, y);
    if (!fx) return;
    const system = this.systems[kind]!;
    this.oneShots.push({ ...fx, age: 0, dur: system.durationMs });
  }

  // Hold a loop (steam / sparkle) under `key` while its owner is active; call each frame
  // the owner is active to keep it alive and follow its position.
  ensureLoop(key: string, kind: FxKind, x: number, y: number): void {
    const existing = this.loops.get(key);
    if (existing) {
      existing.x = x;
      existing.y = y;
      return;
    }
    const fx = this.make(kind, x, y);
    if (fx) this.loops.set(key, fx);
  }

  // Drop a loop when its owner goes idle/broken.
  stopLoop(key: string): void {
    this.loops.delete(key);
  }

  update(dt: number): void {
    for (const b of this.oneShots) {
      b.player.update(dt);
      b.age += dt * 1000;
    }
    // Keep a one-shot until its timeline is done AND its last particles have decayed.
    this.oneShots = this.oneShots.filter((b) => b.age < b.dur + 200 || b.player.simulator.liveCount > 0);
    for (const b of this.loops.values()) b.player.update(dt);
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const prev = ctx.globalCompositeOperation;
    for (const b of this.loops.values()) this.blit(ctx, b);
    for (const b of this.oneShots) this.blit(ctx, b);
    ctx.globalCompositeOperation = prev;
  }

  private blit(ctx: CanvasRenderingContext2D, b: LiveFx): void {
    ctx.globalCompositeOperation = b.composite;
    ctx.drawImage(b.canvas, b.x - b.size / 2, b.y - b.size / 2, b.size, b.size);
  }

  clear(): void {
    this.oneShots = [];
    this.loops.clear();
  }
}

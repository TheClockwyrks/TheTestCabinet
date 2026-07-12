// Junction — the produced particle systems, played LIVE through
// @test-cabinet/particle-runtime's canvas binding (specs/assets.md, ASSETS.md §3) — not
// flat tints. Each system is simulated on its own offscreen 128×128 canvas (its authored
// field size) and composited over the board, so — being simulated — it varies play to play.
//
// Two players, matching the two roles the produced systems fill:
//   Haze   — the LOOPING pollution smog. One simulated field, stamped by the renderer at
//            every place the tile pollution array is dirty, thick over heavy industry and
//            jammed corridors, thinning as pollution clears. The renderer computes the
//            patches from the pollution field (this module owns no world/sim state), the
//            clean seam the DESIGN §4 split asks for.
//   Bursts — the ONE-SHOT dust (a lot developing) and fireworks (a milestone) puffs,
//            spawned at an event position and retired when spent (mirrors valence `Bursts`).

import { ParticleCanvasPlayer } from "@test-cabinet/particle-runtime/canvas";
import type { ParticleSystem } from "@test-cabinet/particle-runtime";
import type { FxEvent, FxKind } from "./types";

const FIELD = 128; // the authored field size of every fx system

// On-board footprint (logical px) each one-shot burst's 128×128 field maps to.
const FOOTPRINT: Record<FxKind, number> = {
  haze: 96,
  dust: 40,
  fireworks: 108,
};

// A patch of pollution the haze is stamped over, computed by the renderer from the tile
// pollution field: a world-space centre, a footprint, and an opacity for the local density.
export interface HazePatch {
  x: number;
  y: number;
  size: number;
  alpha: number;
}

// The persistent, looping pollution smog field.
export class Haze {
  private player: ParticleCanvasPlayer | null = null;
  private canvas: HTMLCanvasElement | null = null;

  constructor(system: ParticleSystem | undefined) {
    if (!system) return;
    const canvas = document.createElement("canvas");
    canvas.width = FIELD;
    canvas.height = FIELD;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // Smog reads right composited normally (not additively); the player clears its own
    // canvas each frame so it stays transparent where no particles live.
    this.player = new ParticleCanvasPlayer(system, ctx, { composite: "source-over", clear: true });
    this.canvas = canvas;
  }

  update(dt: number): void {
    this.player?.update(dt);
  }

  // Stamp the one simulated haze field over every dirty patch, scaled by local density.
  draw(ctx: CanvasRenderingContext2D, patches: HazePatch[]): void {
    if (!this.canvas || patches.length === 0) return;
    const prevAlpha = ctx.globalAlpha;
    for (const p of patches) {
      ctx.globalAlpha = prevAlpha * Math.max(0, Math.min(1, p.alpha));
      ctx.drawImage(this.canvas, p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = prevAlpha;
  }
}

interface LiveBurst {
  player: ParticleCanvasPlayer;
  canvas: HTMLCanvasElement;
  x: number;
  y: number;
  size: number;
  age: number; // ms
  dur: number; // ms
}

// The one-shot dust / fireworks bursts.
export class Bursts {
  private live: LiveBurst[] = [];
  constructor(private readonly systems: Record<FxKind, ParticleSystem | undefined>) {}

  spawn(ev: FxEvent): void {
    if (ev.kind === "haze") return; // haze is the persistent field, not a burst
    const system = this.systems[ev.kind];
    if (!system) return;
    const canvas = document.createElement("canvas");
    canvas.width = FIELD;
    canvas.height = FIELD;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // Additive for the bright fireworks; normal for the earthy dust.
    const composite: GlobalCompositeOperation = ev.kind === "fireworks" ? "lighter" : "source-over";
    const player = new ParticleCanvasPlayer(system, ctx, { composite, clear: true });
    const scale = Math.max(0.5, Math.min(2, ev.strength || 1));
    this.live.push({
      player,
      canvas,
      x: ev.x,
      y: ev.y,
      size: FOOTPRINT[ev.kind] * scale,
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
    for (const b of this.live) {
      ctx.drawImage(b.canvas, b.x - b.size / 2, b.y - b.size / 2, b.size, b.size);
    }
  }

  clear(): void {
    this.live = [];
  }
}

// Holdfast — the effect bursts (ASSETS.md §3 / specs/assets.md).
//
// Each combat/work event fires the matching PRODUCED particle system, played LIVE through
// @test-cabinet/particle-runtime's canvas binding — not a flat flash or a hand-coded
// effect. A burst is simulated on its own offscreen 128×128 canvas (the system's field
// size) and composited additively over the colony view at the event's WORLD position, so
// — being simulated — it varies event to event. One-shots (muzzle/blood/impact/explosion/
// dust) fade out after their authored duration; the looping `fire` system is kept alive
// by re-spawning it each tick while its source burns, and fades shortly after it stops.

import { ParticleCanvasPlayer } from "@test-cabinet/particle-runtime/canvas";
import type { ParticleSystem } from "@test-cabinet/particle-runtime";
import type { FxEvent, FxKind } from "./types";
import { VIEW_X0, VIEW_Y0 } from "./constants";

const FIELD = 128; // the authored field size of every fx system

// On-board footprint (world px) each burst's 128×128 field is scaled to.
const FOOTPRINT: Record<FxKind, number> = {
  muzzle: 30,
  blood: 40,
  impact: 40,
  fire: 40,
  explosion: 64,
  dust: 40,
};

// A looping burst (fire) is dropped this many ms after it was last (re-)spawned, so a
// flame that is re-spawned every tick persists and one that stops fades out promptly.
const LOOP_LINGER_MS = 350;
// A re-spawned loop within this world distance refreshes the existing burst in place.
const LOOP_REFRESH_DIST = 24;

// The camera the bursts are drawn through: the colony view's world→screen transform.
export interface BurstCam {
  camX: number; // world-px at the top-left of the view
  camY: number;
  zoom: number;
}

interface Live {
  player: ParticleCanvasPlayer;
  canvas: HTMLCanvasElement;
  kind: FxKind;
  x: number;
  y: number;
  size: number; // world-px footprint (2× the field footprint for soft overdraw)
  age: number; // ms since spawn / last refresh
  dur: number; // authored duration ms
  loop: boolean;
}

export class Bursts {
  private live: Live[] = [];
  constructor(private readonly systems: Record<FxKind, ParticleSystem | undefined>) {}

  spawn(ev: FxEvent): void {
    const system = this.systems[ev.kind];
    if (!system) return;

    // A looping effect (fire) already burning near here is refreshed, not stacked.
    if (system.loop) {
      for (const b of this.live) {
        if (b.loop && b.kind === ev.kind && Math.hypot(b.x - ev.x, b.y - ev.y) <= LOOP_REFRESH_DIST) {
          b.x = ev.x;
          b.y = ev.y;
          b.age = 0;
          return;
        }
      }
    }

    const canvas = document.createElement("canvas");
    canvas.width = FIELD;
    canvas.height = FIELD;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const player = new ParticleCanvasPlayer(system, ctx, { composite: "lighter", clear: true });
    this.live.push({
      player,
      canvas,
      kind: ev.kind,
      x: ev.x,
      y: ev.y,
      size: FOOTPRINT[ev.kind] * 2.0,
      age: 0,
      dur: system.durationMs,
      loop: system.loop,
    });
  }

  update(dt: number): void {
    for (const b of this.live) {
      b.player.update(dt);
      b.age += dt * 1000;
    }
    this.live = this.live.filter((b) => {
      if (b.loop) return b.age < LOOP_LINGER_MS;
      return b.age < b.dur + 120 || b.player.simulator.liveCount > 0;
    });
  }

  // Composite every live burst over the colony view at its world position, through the
  // camera transform, additively.
  draw(ctx: CanvasRenderingContext2D, cam: BurstCam): void {
    const prev = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = "lighter";
    for (const b of this.live) {
      const sx = VIEW_X0 + (b.x - cam.camX) * cam.zoom;
      const sy = VIEW_Y0 + (b.y - cam.camY) * cam.zoom;
      const size = b.size * cam.zoom;
      ctx.drawImage(b.canvas, sx - size / 2, sy - size / 2, size, size);
    }
    ctx.globalCompositeOperation = prev;
  }

  clear(): void {
    this.live = [];
  }
}

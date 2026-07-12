// Hollowdeep — the live particle overlays and bursts (ASSETS.md, specs/gas.md).
//
// Every gas overlay and puff is a PRODUCED particle-2d system played LIVE through
// @test-cabinet/particle-runtime's canvas binding — never a flat colored fill or a
// hand-coded effect. Each system is simulated on its own offscreen 128x128 canvas (its
// authored field size) and composited additively over the colony view.
//
// Two parts (DESIGN §4):
//  - GasOverlay — tiles the oxygen_haze (rising) and co2_plume (settling) systems over
//    the visible OPEN tiles, each drawn faded by that tile's gas concentration, so a
//    breathable room glows with dense haze and a soured tunnel fills with thick plume.
//  - Bursts — one-shot dig_dust at a mined tile and looping machine_steam at each running
//    machine's vent (mirror valence particles.ts).
//
// Positions are carried in WORLD-PIXEL coordinates and mapped to the screen through
// world.camera at draw time (this file defines the camera transform convention the later
// world.ts conforms to), so overlays and puffs track the world as the camera pans/zooms.

import { ParticleCanvasPlayer } from "@test-cabinet/particle-runtime/canvas";
import type { ParticleSystem } from "@test-cabinet/particle-runtime";
import type { FxEvent, World } from "./types";
import { GAS_CAPACITY, TILE, VIEW_H, VIEW_W, VIEW_X0, VIEW_Y0, isOpenToGas } from "./constants";

const FIELD = 128; // the authored field size of every fx system

// The world-pixel → screen transform (camera top-left in world px, scaled by zoom, offset
// into the colony view region). world.ts's worldToScreen matches this.
function screenX(world: World, wx: number): number {
  return VIEW_X0 + (wx - world.camera.x) * world.camera.zoom;
}
function screenY(world: World, wy: number): number {
  return VIEW_Y0 + (wy - world.camera.y) * world.camera.zoom;
}

function makePlayer(system: ParticleSystem): { canvas: HTMLCanvasElement; player: ParticleCanvasPlayer } | null {
  const canvas = document.createElement("canvas");
  canvas.width = FIELD;
  canvas.height = FIELD;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const player = new ParticleCanvasPlayer(system, ctx, { composite: "lighter", clear: true });
  return { canvas, player };
}

// ---- The gas overlay ------------------------------------------------------------
// Two live systems, each simulated once per frame, then tiled over the open tiles with
// per-tile alpha proportional to that tile's oxygen / CO2 concentration. To read as a
// continuous haze rather than a grid of identical puffs, each tile samples a different
// sub-patch of the live field (offset by its tile coordinates).
export class GasOverlay {
  private oxCanvas: HTMLCanvasElement | null = null;
  private co2Canvas: HTMLCanvasElement | null = null;
  private oxPlayer: ParticleCanvasPlayer | null = null;
  private co2Player: ParticleCanvasPlayer | null = null;

  constructor(oxygen: ParticleSystem | undefined, co2: ParticleSystem | undefined) {
    if (oxygen) {
      const m = makePlayer(oxygen);
      if (m) {
        this.oxCanvas = m.canvas;
        this.oxPlayer = m.player;
      }
    }
    if (co2) {
      const m = makePlayer(co2);
      if (m) {
        this.co2Canvas = m.canvas;
        this.co2Player = m.player;
      }
    }
  }

  // Advance both live systems (kept running as looping effects).
  update(dt: number): void {
    this.oxPlayer?.update(dt);
    this.co2Player?.update(dt);
  }

  // Composite the overlays over the visible open tiles, faded by concentration. Clipped to
  // the colony view so nothing bleeds into the HUD strips.
  draw(ctx: CanvasRenderingContext2D, world: World): void {
    if (!this.oxCanvas && !this.co2Canvas) return;
    const cam = world.camera;
    const zoom = cam.zoom;
    const size = TILE * zoom;

    // Visible tile window (a margin of one tile so edge tiles still draw).
    const txMin = Math.max(0, Math.floor(cam.x / TILE) - 1);
    const tyMin = Math.max(0, Math.floor(cam.y / TILE) - 1);
    const txMax = Math.min(world.w - 1, Math.ceil((cam.x + VIEW_W / zoom) / TILE) + 1);
    const tyMax = Math.min(world.h - 1, Math.ceil((cam.y + VIEW_H / zoom) / TILE) + 1);

    ctx.save();
    ctx.beginPath();
    ctx.rect(VIEW_X0, VIEW_Y0, VIEW_W, VIEW_H);
    ctx.clip();
    ctx.imageSmoothingEnabled = true; // the gas is soft, unlike the pixel tiles
    const prev = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = "lighter";

    const patch = 72; // sub-region of the 128 field sampled per tile
    const span = FIELD - patch;
    for (let ty = tyMin; ty <= tyMax; ty++) {
      for (let tx = txMin; tx <= txMax; tx++) {
        const t = world.tiles[ty * world.w + tx]!;
        if (!isOpenToGas(t.kind)) continue;
        const sx = screenX(world, tx * TILE);
        const sy = screenY(world, ty * TILE);
        if (this.oxCanvas && t.oxygen > 1) {
          ctx.globalAlpha = Math.min(0.72, (t.oxygen / GAS_CAPACITY) * 0.9);
          ctx.drawImage(this.oxCanvas, (tx * 37) % span, (ty * 29) % span, patch, patch, sx, sy, size, size);
        }
        if (this.co2Canvas && t.co2 > 1) {
          ctx.globalAlpha = Math.min(0.8, (t.co2 / GAS_CAPACITY) * 1.1);
          ctx.drawImage(this.co2Canvas, (ty * 53) % span, (tx * 41) % span, patch, patch, sx, sy, size, size);
        }
      }
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = prev;
    ctx.restore();
  }
}

// ---- Bursts: one-shot dust + looping machine steam ------------------------------
interface OneShot {
  player: ParticleCanvasPlayer;
  canvas: HTMLCanvasElement;
  x: number; // world-px center
  y: number;
  size: number; // world-px footprint
  age: number; // ms
  dur: number; // ms
}
interface Vent {
  player: ParticleCanvasPlayer;
  canvas: HTMLCanvasElement;
  x: number; // world-px (vent position, updated each frame as machines move in/out of view)
  y: number;
}

// A running machine's vent, keyed by its machine id so the looping steam persists frame to
// frame while its screen position is refreshed.
export interface VentSpec {
  id: number;
  x: number; // world-px
  y: number;
}

const DUST_FOOTPRINT = TILE * 1.7; // world-px box a dig_dust puff fills
const STEAM_FOOTPRINT = TILE * 1.5; // world-px box a machine_steam vent fills

export class Bursts {
  private oneShots: OneShot[] = [];
  private vents = new Map<number, Vent>();

  constructor(
    private readonly dust: ParticleSystem | undefined,
    private readonly steam: ParticleSystem | undefined,
  ) {}

  // A one-shot puff (dig dust) or a transient steam burst at a world-px position.
  spawn(ev: FxEvent): void {
    const system = ev.kind === "dust" ? this.dust : this.steam;
    if (!system) return;
    const m = makePlayer(system);
    if (!m) return;
    this.oneShots.push({
      player: m.player,
      canvas: m.canvas,
      x: ev.x,
      y: ev.y,
      size: ev.kind === "dust" ? DUST_FOOTPRINT : STEAM_FOOTPRINT,
      age: 0,
      dur: system.durationMs,
    });
  }

  // Reconcile the set of looping steam vents at the currently-running machines. Called each
  // frame with the running machines' vent positions (world-px); a persistent loop player is
  // kept per machine id, created when it starts running and disposed when it stops.
  setVents(specs: VentSpec[]): void {
    if (!this.steam) return;
    const seen = new Set<number>();
    for (const spec of specs) {
      seen.add(spec.id);
      const existing = this.vents.get(spec.id);
      if (existing) {
        existing.x = spec.x;
        existing.y = spec.y;
      } else {
        const m = makePlayer(this.steam);
        if (m) this.vents.set(spec.id, { player: m.player, canvas: m.canvas, x: spec.x, y: spec.y });
      }
    }
    for (const id of [...this.vents.keys()]) {
      if (!seen.has(id)) this.vents.delete(id);
    }
  }

  update(dt: number): void {
    for (const b of this.oneShots) {
      b.player.update(dt);
      b.age += dt * 1000;
    }
    this.oneShots = this.oneShots.filter((b) => b.age < b.dur + 120 || b.player.simulator.liveCount > 0);
    for (const v of this.vents.values()) v.player.update(dt);
  }

  draw(ctx: CanvasRenderingContext2D, world: World): void {
    ctx.save();
    ctx.beginPath();
    ctx.rect(VIEW_X0, VIEW_Y0, VIEW_W, VIEW_H);
    ctx.clip();
    const prev = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = "lighter";
    ctx.imageSmoothingEnabled = true;
    const zoom = world.camera.zoom;

    for (const v of this.vents.values()) {
      const size = STEAM_FOOTPRINT * zoom;
      const cx = screenX(world, v.x);
      const cy = screenY(world, v.y);
      ctx.drawImage(v.canvas, cx - size / 2, cy - size / 2, size, size);
    }
    for (const b of this.oneShots) {
      const size = b.size * zoom;
      const cx = screenX(world, b.x);
      const cy = screenY(world, b.y);
      ctx.drawImage(b.canvas, cx - size / 2, cy - size / 2, size, size);
    }

    ctx.globalCompositeOperation = prev;
    ctx.restore();
  }

  clear(): void {
    this.oneShots = [];
    this.vents.clear();
  }
}

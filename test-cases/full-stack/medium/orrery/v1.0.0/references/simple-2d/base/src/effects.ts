// Orrery — the produced particle effects, played live (specs/assets.md "The
// particle effects").
//
// Three systems, authored with `particle-2d` and committed as `system.json`: a
// delivery on each set that took a constellation, a fault where the run
// halted, and a completion over the middle of the field. Each is played
// through `@test-cabinet/particle-runtime`'s `./canvas` binding, which
// simulates the system and composites its particles itself — so every play
// varies, and that variation is correct, and it reaches nothing the debug
// surface reads.
//
// The player fits a system's FIELD to the context it is handed, so placing and
// scaling an instance is this build's own work. Each live effect therefore gets
// a small square scratch canvas of its own: the player fits the square field to
// the square canvas undistorted, and the frame blits that canvas over the field
// at the event's position, additively, so an effect sits over the frame where
// the event raised it.
//
// The pool is module-level for the same reason the sprite store is: an effect
// is presentation and `OrreryState` is fixed by `specs/state.md`, and `render`
// is handed nothing but the state and the engine's `RenderApi`. Nothing here
// reaches the simulation, so what the pool holds changes no rule and no
// reading: a scenario that draws and one that never does reach the same state.
// An effect whose system this build never produced simply plays nothing.

import type { ParticleSystem } from "@test-cabinet/particle-runtime";
import { ParticleCanvasPlayer } from "@test-cabinet/particle-runtime/canvas";
import type { ParticleSystemName } from "./figures";
import type { StagePoint } from "./motion";
import type { EffectEvent } from "./outbox";

/** How many logical units across an effect is drawn. */
export const EFFECT_SIZE = 168;

/** The scratch canvas's side, in pixels; square, so the field is undistorted. */
const SCRATCH_PX = 192;

/** How long past its authored duration an effect is kept before it is dropped. */
const TAIL_SECONDS = 0.5;

/** How many effects may play at once, so a busy boundary cannot pile up. */
const MAX_LIVE = 12;

/** How a scratch canvas is made; the page's, or none at all under a test. */
export type CanvasSource = () => HTMLCanvasElement | null;

/** The page's own canvas factory, and `null` where there is no document. */
export const pageCanvas: CanvasSource = () =>
  typeof document === "undefined" ? null : document.createElement("canvas");

/** One playing effect: its player, its scratch canvas, and where it plays. */
interface LiveEffect {
  readonly player: ParticleCanvasPlayer;
  readonly canvas: HTMLCanvasElement;
  readonly at: StagePoint;
  readonly lifetime: number;
  elapsed: number;
}

/** Every effect playing right now, advanced and drawn by the frame. */
export class Effects {
  private readonly live: LiveEffect[] = [];
  private readonly source: CanvasSource;
  private systems: ReadonlyMap<ParticleSystemName, ParticleSystem> = new Map();

  constructor(source: CanvasSource = pageCanvas) {
    this.source = source;
  }

  /** How many effects are playing, which the diagnostics overlay reports. */
  get count(): number {
    return this.live.length;
  }

  /** Hold the produced systems the pool plays. Called once, from `initialize`. */
  install(systems: ReadonlyMap<ParticleSystemName, ParticleSystem>): void {
    this.systems = systems;
  }

  /** Start one effect at a stage position. An absent system plays nothing. */
  fire(event: EffectEvent): void {
    const system = this.systems.get(event.system);
    const canvas = this.source();
    if (
      system === undefined ||
      canvas === null ||
      this.live.length >= MAX_LIVE
    ) {
      return;
    }
    canvas.width = SCRATCH_PX;
    canvas.height = SCRATCH_PX;
    const ctx = canvas.getContext("2d");
    if (ctx === null) return;
    this.live.push({
      player: new ParticleCanvasPlayer(system, ctx, { clear: true }),
      canvas,
      at: { x: event.at.x, y: event.at.y },
      lifetime: system.durationMs / 1000 + TAIL_SECONDS,
      elapsed: 0,
    });
  }

  /** Advance every live effect by the frame's delta, and retire the finished. */
  update(dt: number): void {
    if (!(dt > 0)) return;
    for (let index = this.live.length - 1; index >= 0; index -= 1) {
      const effect = this.live[index];
      effect.elapsed += dt;
      effect.player.update(dt);
      if (effect.elapsed >= effect.lifetime) this.live.splice(index, 1);
    }
  }

  /** Composite every live effect over the frame, at the position it plays at. */
  draw(ctx: CanvasRenderingContext2D): void {
    if (this.live.length === 0) return;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const effect of this.live) {
      ctx.drawImage(
        effect.canvas,
        effect.at.x - EFFECT_SIZE / 2,
        effect.at.y - EFFECT_SIZE / 2,
        EFFECT_SIZE,
        EFFECT_SIZE,
      );
    }
    ctx.restore();
  }

  /** Drop every live effect. */
  clear(): void {
    this.live.length = 0;
  }
}

/** The pool the frames play through. */
const pool = new Effects();

/** Hold the produced systems the frames play. Called once, from `initialize`. */
export function installSystems(
  systems: ReadonlyMap<ParticleSystemName, ParticleSystem>,
): void {
  pool.install(systems);
}

/** Start the effects a frame's transitions raised. */
export function fireEffects(events: readonly EffectEvent[]): void {
  for (const event of events) pool.fire(event);
}

/** Advance the effects already playing by the frame's delta. */
export function advanceEffects(dt: number): void {
  pool.update(dt);
}

/** Composite the effects playing right now over the frame. */
export function drawEffects(ctx: CanvasRenderingContext2D): void {
  pool.draw(ctx);
}

/** How many effects are playing, which the diagnostics overlay reports. */
export function liveEffectCount(): number {
  return pool.count;
}

/** Drop every live effect, which a fresh engine does. */
export function clearEffects(): void {
  pool.clear();
}

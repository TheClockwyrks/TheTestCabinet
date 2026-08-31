// Facet — the presentation layer: the break sheets and the particle bursts a
// chain throws.
//
// Everything here is DECORATION, and it is deliberately kept out of the game's
// state. `specs/state.md` fixes what the state carries and
// `specs/instrumentation.md` rests on that state being reproducible from a seed
// and a delta time; a shatter still flying when a scenario reads the board
// would be neither. So the simulation reports what each chain step did
// (`src/game.ts` derives it from the core's own rules), this module turns those
// reports into things that move, and nothing here is ever read back.
//
// Two kinds of thing move:
//
//   * A BREAK SHEET per cleared gem — the seven-frame-wide `draw-sheet`
//     sequence for that gem's kind, played at its cell on a timer
//     (specs/assets.md). R9 settles the column inside the same step, so the
//     sheet plays OVER the stones that fell into the gap, which is what a
//     player reads as the stone shattering and the board closing on it.
//   * A PARTICLE BURST per cleared gem and per created cut — one of the three
//     `particle-2d` systems, simulated live through
//     `@test-cabinet/particle-runtime`'s `ParticleCanvasPlayer`
//     (specs/assets.md). The player composites into a canvas the size of the
//     system's own field, which this module then composites, additively, centered on
//     the cell. The scratch canvases are pooled because allocating one per
//     shattered gem would churn a dozen canvases a step; the players are not,
//     so each burst draws its own random play rather than replaying a pooled
//     one.

import { ParticleCanvasPlayer } from "@test-cabinet/particle-runtime/canvas";
import {
  BREAK_FRAMES,
  FX_CLEAR,
  FX_CUT,
  FX_FLAWED,
  PRISM_TURN_FRAMES,
  breakKey,
  type AssetStore,
} from "./assets";
import { cellCenter, type Cell } from "./core";
import { SPRITE_SIZE } from "./theme";
import type { ScratchCanvas } from "./runtime";

/** How long one frame of a break sheet holds, in seconds. */
export const BREAK_FRAME_SECONDS = 0.045;

/** How long one frame of the prism's idle turn holds, in seconds. */
export const PRISM_TURN_FRAME_SECONDS = 0.09;

/** The most break sheets played at once, so a huge step cannot flood the frame. */
const MAX_BREAKS = 72;

/** The most live bursts of any one system, for the same reason. */
const MAX_BURSTS_PER_SYSTEM = 28;

/** How long after its last particle dies a burst is kept before retiring. */
const BURST_GRACE_SECONDS = 0.08;

/**
 * The canvas radius a unit-size particle draws at, as a fraction of the
 * system's field extent.
 *
 * The player's own default is `0.02`, which reads as soft light rather than as
 * flying stone: these are chips off a shattered gem, so they are drawn smaller
 * and crisper, and the burst reads as debris instead of a glow.
 */
const BURST_PIXEL_RADIUS = 0.012;

/** One gem a chain step removed, as the presentation needs to draw it. */
export interface ClearedGem extends Cell {
  /** The kind whose break sheet plays; `null` for a prism, which has none. */
  readonly kind: string | null;
  /** Whether it was at `MAX_STRAIN`, which throws the heavier detonation. */
  readonly flawed: boolean;
}

/** What one chain step did, as the presentation needs it. */
export interface StepReport {
  readonly cleared: readonly ClearedGem[];
  /** The cells R8 created a cut gem in, each marked with the cut flash. */
  readonly created: readonly Cell[];
}

/** The frame of the prism's idle turn showing at `simTime`, which every prism
 * on the board is drawn at — so the turn is a pure function of game time and a
 * driven scenario reproduces it exactly. */
export function prismTurnFrame(simTime: number): number {
  const frame = Math.floor(simTime / PRISM_TURN_FRAME_SECONDS);
  return ((frame % PRISM_TURN_FRAMES) + PRISM_TURN_FRAMES) % PRISM_TURN_FRAMES;
}

/** A break sheet playing at one cell. */
interface Break {
  readonly kind: string;
  readonly x: number;
  readonly y: number;
  age: number;
}

/** A pooled scratch canvas one burst is composited into. */
interface Slot {
  readonly ctx: CanvasRenderingContext2D;
  readonly width: number;
  readonly height: number;
  busy: boolean;
}

/** One live particle burst. */
interface Burst {
  readonly key: string;
  readonly slot: Slot;
  readonly player: ParticleCanvasPlayer;
  readonly x: number;
  readonly y: number;
  /** The longest the burst may live, from the system's own duration. */
  readonly life: number;
  age: number;
}

export class Presentation {
  private readonly scratch: ScratchCanvas;
  private readonly breaks: Break[] = [];
  private readonly bursts: Burst[] = [];
  /** The pooled canvases, by system key: one pool per field size. */
  private readonly pools = new Map<string, Slot[]>();

  constructor(scratch: ScratchCanvas) {
    this.scratch = scratch;
  }

  /** Whether anything is playing, which is what the renderer skips on. */
  idle(): boolean {
    return this.breaks.length === 0 && this.bursts.length === 0;
  }

  /**
   * Take the chain steps that ran since the presentation was last handed the
   * board, and notice a board that changed with no step to explain it.
   *
   * A board that arrives unexplained is a different board entirely — a fresh
   * deal, a posed `loadBoard`, a `reset` — and whatever is still flying belongs
   * to the one that is gone.
   */
  observe(
    boardBefore: unknown,
    boardAfter: unknown,
    steps: readonly StepReport[],
    assets: AssetStore,
  ): void {
    if (steps.length === 0) {
      if (boardAfter !== boardBefore) this.clear();
      return;
    }
    for (const step of steps) this.spawn(step, assets);
  }

  /** Age every sheet and burst by `dt`, retiring the ones that have run. */
  advance(dt: number): void {
    for (let index = this.breaks.length - 1; index >= 0; index -= 1) {
      const sheet = this.breaks[index];
      sheet.age += dt;
      if (sheet.age >= BREAK_FRAMES * BREAK_FRAME_SECONDS) {
        this.breaks.splice(index, 1);
      }
    }
    for (let index = this.bursts.length - 1; index >= 0; index -= 1) {
      const burst = this.bursts[index];
      burst.age += dt;
      burst.player.update(dt);
      const spent =
        burst.age >= burst.life ||
        (burst.age > BURST_GRACE_SECONDS &&
          burst.player.simulator.liveCount === 0);
      if (spent) {
        burst.slot.busy = false;
        this.bursts.splice(index, 1);
      }
    }
  }

  /** Drop everything playing and free every pooled canvas. */
  clear(): void {
    this.breaks.length = 0;
    for (const burst of this.bursts) burst.slot.busy = false;
    this.bursts.length = 0;
  }

  /** Draw the break sheets, at native sprite size, centered on their cells. */
  drawBreaks(ctx: CanvasRenderingContext2D, assets: AssetStore): void {
    for (const sheet of this.breaks) {
      const frame = Math.min(
        BREAK_FRAMES - 1,
        Math.floor(sheet.age / BREAK_FRAME_SECONDS),
      );
      const image = assets.image(breakKey(sheet.kind, frame));
      if (image === null) continue;
      ctx.drawImage(
        image,
        sheet.x - SPRITE_SIZE / 2,
        sheet.y - SPRITE_SIZE / 2,
        SPRITE_SIZE,
        SPRITE_SIZE,
      );
    }
  }

  /**
   * Blit every live burst over the board, additively, so overlapping bursts
   * build light rather than painting over one another.
   */
  drawBursts(ctx: CanvasRenderingContext2D): void {
    if (this.bursts.length === 0) return;
    const previous = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = "lighter";
    for (const burst of this.bursts) {
      ctx.drawImage(
        burst.slot.ctx.canvas,
        burst.x - burst.slot.width / 2,
        burst.y - burst.slot.height / 2,
        burst.slot.width,
        burst.slot.height,
      );
    }
    ctx.globalCompositeOperation = previous;
  }

  /** One step's sheets and bursts. */
  private spawn(step: StepReport, assets: AssetStore): void {
    for (const gem of step.cleared) {
      const [x, y] = cellCenter(gem);
      // A prism carries no kind, so there is no break sheet for it; its
      // shatter is carried by the burst alone.
      if (gem.kind !== null && this.breaks.length < MAX_BREAKS) {
        this.breaks.push({ kind: gem.kind, x, y, age: 0 });
      }
      this.fire(gem.flawed ? FX_FLAWED : FX_CLEAR, x, y, assets);
    }
    for (const cell of step.created) {
      const [x, y] = cellCenter(cell);
      this.fire(FX_CUT, x, y, assets);
    }
  }

  /** One burst of the system under `key`, centered at a stage position. */
  private fire(key: string, x: number, y: number, assets: AssetStore): void {
    const system = assets.system(key);
    if (system === null) return;
    const live = this.bursts.reduce(
      (count, burst) => (burst.key === key ? count + 1 : count),
      0,
    );
    if (live >= MAX_BURSTS_PER_SYSTEM) return;
    const slot = this.take(key, system.field.width, system.field.height);
    if (slot === null) return;
    // `clear` is left at its default: the player owns its scratch canvas
    // outright and wipes it before compositing each frame.
    const player = new ParticleCanvasPlayer(system, slot.ctx, {
      pixelRadius: Math.max(slot.width, slot.height) * BURST_PIXEL_RADIUS,
    });
    this.bursts.push({
      key,
      slot,
      player,
      x,
      y,
      life: system.durationMs / 1000 + 1,
      age: 0,
    });
  }

  /** A free scratch canvas of the system's field size, pooled by system. */
  private take(key: string, width: number, height: number): Slot | null {
    const pool = this.pools.get(key) ?? [];
    if (pool.length === 0) this.pools.set(key, pool);
    const free = pool.find((slot) => !slot.busy);
    if (free) {
      free.busy = true;
      return free;
    }
    const ctx = this.scratch(width, height);
    if (ctx === null) return null;
    const slot: Slot = { ctx, width, height, busy: true };
    pool.push(slot);
    return slot;
  }
}

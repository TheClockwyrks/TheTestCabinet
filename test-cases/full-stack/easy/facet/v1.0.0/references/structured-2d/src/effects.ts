// Facet — the presentation layer: the break sheets, the particle bursts a chain
// throws, the aura every cut stone carries, and the clock a fresh deal pours on.
//
// Everything here is DECORATION, and it is deliberately kept out of the game's
// state. `specs/state.md` fixes what the state carries and
// `specs/instrumentation.md` rests on that state being reproducible from a seed
// and a delta time; a shatter still flying when a scenario reads the board
// would be neither. So the simulation reports what each chain step did
// (`src/steps.ts` derives it from the core's own rules), this module turns those
// reports into things that move, and nothing here is ever read back.
//
// Four kinds of thing move:
//
//   * A BREAK SHEET per cleared gem — the six-frame `draw-sheet` sequence for
//     that gem's kind, played at its cell (specs/assets.md). It starts at the
//     moment R6's wave gives that cell, `wave * WAVE_SECONDS` into the step, so
//     a set the expansion tore open shatters outward from its seed rather than
//     all on one frame. R9 settles the column inside the same step, so the
//     sheet plays where the stone was while the stones above it are still
//     falling through the gap.
//   * A PARTICLE BURST per cleared gem and per created cut — one of the
//     one-shot `particle-2d` systems, simulated live through
//     `@test-cabinet/particle-runtime`'s `ParticleCanvasPlayer`
//     (specs/assets.md). A cleared cell's burst waits out the same wave its
//     sheet does, so the two land together.
//   * An AURA per cut stone — the looping system, running continuously at every
//     `brilliant`, `star`, and `prism` standing on the board, for as long as one
//     stands there (specs/board.md, specs/assets.md). They are reconciled
//     against the board rather than fired at it: a cell that gains a cut stone
//     takes an aura, a cell that loses one gives its aura up, and a cell that
//     keeps one keeps the play it already had running.
//   * THE POUR of a freshly dealt board. Every gem of a deal carries a `fell`
//     of at least `row + 1` (specs/rules.md), so the board has everything the
//     renderer needs to drop it in from above; what it does not have is a clock,
//     because a settled board's timers all read `0`. This module keeps that one
//     clock, which is decoration like the rest of it.
//
// The scratch canvases are POOLED, by system: allocating one per shattered gem
// would churn a dozen canvases a step. The players are not pooled, so each
// burst draws its own random play rather than replaying a pooled one.

import { ParticleCanvasPlayer } from "@test-cabinet/particle-runtime/canvas";
import {
  BREAK_FRAMES,
  FX_AURA,
  FX_CLEAR,
  FX_CUT,
  FX_FLAWED,
  PRISM_TURN_FRAMES,
  breakKey,
  type AssetStore,
} from "./assets";
import { FALL_SECONDS_PER_ROW, GRID_ROWS, WAVE_SECONDS } from "./constants";
import {
  cellCenter,
  cellKey,
  cellsOf,
  gemAt,
  type BoardState as CoreBoard,
  type Cell,
} from "./core";
import { SPRITE_SIZE } from "./theme";

/**
 * Where a burst's own scratch canvas comes from. It is a seam rather than a
 * direct `document.createElement` because the build's tests stand the game up
 * in Node, where there is no document, and because a host that cannot make one
 * should degrade to "no bursts" rather than to a thrown frame.
 */
export type ScratchCanvas = (
  width: number,
  height: number,
) => CanvasRenderingContext2D | null;

/** The browser's own: an offscreen canvas of the system's field size. */
export function domScratch(): ScratchCanvas {
  return (width, height) => {
    if (typeof document === "undefined") return null;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(width));
    canvas.height = Math.max(1, Math.ceil(height));
    return canvas.getContext("2d");
  };
}

/** How long one frame of a break sheet holds, in seconds. */
export const BREAK_FRAME_SECONDS = 0.045;

/** How long one frame of the prism's idle turn holds, in seconds. */
export const PRISM_TURN_FRAME_SECONDS = 0.09;

/**
 * How long the pour of a freshly dealt board runs before it is over. The
 * deepest gem of a deal comes from `GRID_ROWS + 1` rows above its cell, and it
 * falls at the rate `specs/rules.md` fixes for every other falling gem.
 */
export const POUR_SECONDS = (GRID_ROWS + 1) * FALL_SECONDS_PER_ROW;

/** The most break sheets played at once, so a huge step cannot flood the frame. */
const MAX_BREAKS = 72;

/** The most live bursts of any one system, for the same reason. */
const MAX_BURSTS_PER_SYSTEM = 28;

/** The most auras running at once. A board can hold more cut stones than this
 * only after an enormous chain, and the ones past it simply go without. */
const MAX_AURAS = 24;

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

/**
 * The same figure for an aura, which is finer still. An aura runs the whole
 * time its stone stands there, so it has to read as a stone catching the light
 * rather than as a haze over the field, however many of them are running.
 */
const AURA_PIXEL_RADIUS = 0.012;

/** One gem a chain step removed, as the presentation needs to draw it. */
export interface ClearedGem extends Cell {
  /** The kind whose break sheet plays; `null` for a prism, which has none. */
  readonly kind: string | null;
  /** Whether it was at `MAX_STRAIN`, which throws the heavier detonation. */
  readonly flawed: boolean;
  /** R6's wave, which is what delays this cell's shatter within the step. */
  readonly wave: number;
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

/**
 * Whether every gem on a board came in from above it, which is exactly what a
 * fresh deal leaves (specs/rules.md, The opening board). It is what tells a
 * board that was dealt from one that was posed or one a chain settled, so the
 * pour runs for the first and not for the other two.
 */
export function isDealtBoard(board: CoreBoard): boolean {
  if (board.gems.length === 0) return false;
  return board.gems.every(
    (gem, index) =>
      gem !== null && gem.fell >= Math.floor(index / board.cols) + 1,
  );
}

/** Every cell holding a cut stone, which is where the auras run. */
export function auraCells(board: CoreBoard): Cell[] {
  return cellsOf(board).filter((cell) => {
    const cut = gemAt(board, cell)?.cut;
    return cut === "brilliant" || cut === "star" || cut === "prism";
  });
}

/** A break sheet playing at one cell, once its wave has come round. */
interface Break {
  readonly kind: string;
  readonly x: number;
  readonly y: number;
  readonly delay: number;
  age: number;
}

/** A pooled scratch canvas one burst or one aura is composited into. */
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
  /** The game time before the burst starts, which is its cell's wave. */
  readonly delay: number;
  /** The longest the burst may live once it has started. */
  readonly life: number;
  age: number;
}

/** One aura, running for as long as its stone stands in its cell. */
interface Aura {
  readonly cell: Cell;
  readonly slot: Slot;
  readonly player: ParticleCanvasPlayer;
}

export class Presentation {
  private readonly scratch: ScratchCanvas;
  private readonly breaks: Break[] = [];
  private readonly bursts: Burst[] = [];
  private readonly auras = new Map<string, Aura>();
  /** The pooled canvases, by system key: one pool per field size. */
  private readonly pools = new Map<string, Slot[]>();
  /** How long the pour of a freshly dealt board has run, or `null` for none. */
  private pouring: number | null = null;

  constructor(scratch: ScratchCanvas) {
    this.scratch = scratch;
  }

  /** Whether anything a chain threw is still playing. */
  idle(): boolean {
    return this.breaks.length === 0 && this.bursts.length === 0;
  }

  /**
   * How far into the pour of a freshly dealt board the game is, or `null` when
   * no board is pouring. The renderer reads it to place a gem that is still on
   * its way down into a board no chain step is running over.
   */
  pourAge(): number | null {
    return this.pouring;
  }

  /** Start the pour of a board that was just dealt in from above. */
  pour(): void {
    this.pouring = 0;
  }

  /**
   * Take a batch of chain-step reports, in the order they resolved, and throw
   * what each one throws.
   *
   * Every report is handed over by whatever produced the transition — the game
   * mode for a frame's chain, the debug surface for a posed one — so the cells
   * a report names are the cells that step actually cleared, never a guess
   * reconstructed from a state the presentation happened to have kept.
   */
  push(steps: readonly StepReport[], assets: AssetStore): void {
    for (const step of steps) this.spawn(step, assets);
  }

  /**
   * The auras brought level with the board: one running at every cell holding a
   * cut stone, and none anywhere else. A cell that keeps its stone keeps the
   * play already running there, so an aura is continuous rather than restarted
   * every frame.
   */
  syncAuras(cells: readonly Cell[], assets: AssetStore): void {
    const wanted = new Set(cells.map((cell) => cellKey(cell)));
    for (const [key, aura] of this.auras) {
      if (wanted.has(key)) continue;
      aura.slot.busy = false;
      this.auras.delete(key);
    }
    const system = assets.system(FX_AURA);
    if (system === null) return;
    for (const cell of cells) {
      const key = cellKey(cell);
      if (this.auras.has(key) || this.auras.size >= MAX_AURAS) continue;
      const slot = this.take(FX_AURA, system.field.width, system.field.height);
      if (slot === null) return;
      this.auras.set(key, {
        cell,
        slot,
        player: new ParticleCanvasPlayer(system, slot.ctx, {
          pixelRadius: Math.max(slot.width, slot.height) * AURA_PIXEL_RADIUS,
        }),
      });
    }
  }

  /** Age every sheet, burst, aura, and pour by `dt`, retiring what has run. */
  advance(dt: number): void {
    if (this.pouring !== null) {
      const poured = this.pouring + dt;
      this.pouring = poured >= POUR_SECONDS ? null : poured;
    }
    for (let index = this.breaks.length - 1; index >= 0; index -= 1) {
      const sheet = this.breaks[index];
      sheet.age += dt;
      if (sheet.age >= sheet.delay + BREAK_FRAMES * BREAK_FRAME_SECONDS) {
        this.breaks.splice(index, 1);
      }
    }
    for (let index = this.bursts.length - 1; index >= 0; index -= 1) {
      const burst = this.bursts[index];
      burst.age += dt;
      const running = burst.age - burst.delay;
      if (running < 0) continue;
      burst.player.update(Math.min(dt, running));
      const spent =
        running >= burst.life ||
        (running > BURST_GRACE_SECONDS &&
          burst.player.simulator.liveCount === 0);
      if (spent) {
        burst.slot.busy = false;
        this.bursts.splice(index, 1);
      }
    }
    for (const aura of this.auras.values()) aura.player.update(dt);
  }

  /** Drop everything playing and free every pooled canvas. */
  clear(): void {
    this.breaks.length = 0;
    for (const burst of this.bursts) burst.slot.busy = false;
    this.bursts.length = 0;
    for (const aura of this.auras.values()) aura.slot.busy = false;
    this.auras.clear();
    this.pouring = null;
  }

  /** Draw the break sheets, at native sprite size, centered on their cells. */
  drawBreaks(ctx: CanvasRenderingContext2D, assets: AssetStore): void {
    for (const sheet of this.breaks) {
      const running = sheet.age - sheet.delay;
      if (running < 0) continue;
      const frame = Math.min(
        BREAK_FRAMES - 1,
        Math.floor(running / BREAK_FRAME_SECONDS),
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
      if (burst.age < burst.delay) continue;
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

  /**
   * Blit every aura, additively, at the position the renderer says its stone is
   * drawn at — which is not its cell center while the stone is falling or
   * travelling through a swap, so the aura travels with the stone.
   */
  drawAuras(
    ctx: CanvasRenderingContext2D,
    positionOf: (cell: Cell) => readonly [number, number],
  ): void {
    if (this.auras.size === 0) return;
    const previous = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = "lighter";
    for (const aura of this.auras.values()) {
      const [x, y] = positionOf(aura.cell);
      ctx.drawImage(
        aura.slot.ctx.canvas,
        x - aura.slot.width / 2,
        y - aura.slot.height / 2,
        aura.slot.width,
        aura.slot.height,
      );
    }
    ctx.globalCompositeOperation = previous;
  }

  /** One step's sheets and bursts, each waiting out its own cell's wave. */
  private spawn(step: StepReport, assets: AssetStore): void {
    for (const gem of step.cleared) {
      const [x, y] = cellCenter(gem);
      const delay = gem.wave * WAVE_SECONDS;
      // A prism carries no kind, so there is no break sheet for it; its
      // shatter is carried by the burst alone.
      if (gem.kind !== null && this.breaks.length < MAX_BREAKS) {
        this.breaks.push({ kind: gem.kind, x, y, delay, age: 0 });
      }
      this.fire(gem.flawed ? FX_FLAWED : FX_CLEAR, x, y, delay, assets);
    }
    for (const cell of step.created) {
      const [x, y] = cellCenter(cell);
      this.fire(FX_CUT, x, y, 0, assets);
    }
  }

  /** One burst of the system under `key`, centered at a stage position. */
  private fire(
    key: string,
    x: number,
    y: number,
    delay: number,
    assets: AssetStore,
  ): void {
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
      delay,
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

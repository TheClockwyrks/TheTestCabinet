// Facet — the presentation layer: the break sheets, the particle bursts a chain
// throws, the auras a cut stone stands in, and the pour a fresh board arrives on.
//
// Everything here is DECORATION, and it is deliberately kept out of the game's
// state. `specs/state.md` fixes what the state carries and
// `specs/instrumentation.md` rests on that state being reproducible from a seed
// and a delta time; a shatter still flying when a scenario reads the board
// would be neither. So the simulation reports what each chain step did
// (`src/frame.ts` derives it from the core's own rules), this module turns those
// reports into things that move, and nothing here is ever read back.
//
// Four kinds of thing move:
//
//   * A BREAK SHEET per cleared gem — the six-frame `draw-sheet` sequence for
//     that gem's kind, played at its cell on a timer (specs/assets.md). It
//     starts at the moment `specs/rules.md` gives that cell's WAVE, `w`
//     wave-lengths into the step, which is what makes a clear set shatter
//     outward from its seed rather than all at once. R9 settles the column
//     inside the same step, so the sheet plays OVER the stones that fell into
//     the gap, which is what a player reads as the stone shattering and the
//     board closing on it.
//   * A PARTICLE BURST per cleared gem and per created cut — one of the three
//     one-shot `particle-2d` systems, simulated live through
//     `@clockwyrks/particle-runtime`'s `ParticleCanvasPlayer`
//     (specs/assets.md). It waits on the same wave its sheet waits on, so the
//     debris leaves the stone rather than preceding it.
//   * A CUT AURA per `brilliant`, `star`, and `prism` standing on the board —
//     the fourth system, which LOOPS, held for exactly as long as that gem
//     stands in that cell. Several run at once on a board that has earned
//     several cuts, so they are the one effect here that is synchronized to the
//     board rather than thrown at it: one player per occupied cell, taken up
//     and given back as cuts arrive and clear.
//   * THE POUR. Every gem carries `fell`, the rows it traveled to reach its
//     cell (R9), and a chain step times its fall off `stepTimer`. A board that
//     arrives with no step to explain it — a fresh deal, the next level, a
//     posed board — has no such timer, so this module holds the one figure that
//     board needs: how long it has been standing. That is the whole of the
//     bookkeeping, and the renderer reads it exactly as it reads `stepTimer`.
//
// The player composites into a canvas the size of the system's own field, which
// this module then composites, additively, centered on the cell. The scratch
// canvases are pooled because allocating one per shattered gem would churn a
// dozen canvases a step; the players are not, so each burst draws its own
// random play rather than replaying a pooled one.

import { ParticleCanvasPlayer } from "@clockwyrks/particle-runtime/canvas";
import type { ParticleSystem } from "@clockwyrks/particle-runtime";
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
import { FALL_SECONDS_PER_ROW, WAVE_SECONDS } from "./constants";
import { cellCenter, lastFall, type BoardState, type Cell } from "./core";
import { SPRITE_SIZE } from "./theme";
import type { ScratchCanvas } from "./scratch";

/** How long one frame of a break sheet holds, in seconds. */
export const BREAK_FRAME_SECONDS = 0.045;

/** How long one frame of the prism's idle turn holds, in seconds. */
export const PRISM_TURN_FRAME_SECONDS = 0.09;

/** The most break sheets played at once, so a huge step cannot flood the frame. */
const MAX_BREAKS = 72;

/** The most live bursts of any one system, for the same reason. */
const MAX_BURSTS_PER_SYSTEM = 28;

/** The most auras held at once. A board rarely carries a quarter of these. */
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

/** An aura is a haze rather than debris, so its motes are drawn softer. */
const AURA_PIXEL_RADIUS = 0.02;

/** How far down an aura is mixed, so several on one board stay several. */
const AURA_ALPHA = 0.7;

/** One gem a chain step removed, as the presentation needs to draw it. */
export interface ClearedGem extends Cell {
  /** The kind whose break sheet plays; `null` for a prism, which has none. */
  readonly kind: string | null;
  /** Whether it was at `MAX_STRAIN`, which throws the heavier detonation. */
  readonly flawed: boolean;
  /** The wave R6 gave the cell, which is how long its shatter waits. */
  readonly wave: number;
}

/** What one chain step did, as the presentation needs it. */
export interface StepReport {
  readonly cleared: readonly ClearedGem[];
  /** The cells R8 created a cut gem in, each marked with the cut flash. */
  readonly created: readonly Cell[];
  /** The greatest wave the clear set carried, which the created gems wait on. */
  readonly waves: number;
}

/**
 * Whether two boards hold the same thing, cell for cell.
 *
 * Compared BY VALUE rather than by identity, because this build's state crosses
 * `src/bridge.ts` twice a frame and comes back as fresh objects every time: an
 * identity test would report a different board on every frame and wipe the
 * effects one frame after they were thrown. It is 64 cells of four fields,
 * which is nothing beside the frame that just resolved a chain step. `fell` is
 * one of the four, because a board whose gems arrived from somewhere else is a
 * different board however familiar its stones look.
 */
export function sameBoard(a: BoardState, b: BoardState): boolean {
  if (a === b) return true;
  if (a.cols !== b.cols || a.rows !== b.rows) return false;
  if (a.gems.length !== b.gems.length) return false;
  return a.gems.every((gem, index) => {
    const other = b.gems[index];
    if (gem === null || other === null) return gem === other;
    return (
      gem.kind === other.kind &&
      gem.cut === other.cut &&
      gem.strain === other.strain &&
      gem.fell === other.fell
    );
  });
}

/** The frame of the prism's idle turn showing at `simTime`, which every prism
 * on the board is drawn at — so the turn is a pure function of game time and a
 * driven scenario reproduces it exactly. */
export function prismTurnFrame(simTime: number): number {
  const frame = Math.floor(simTime / PRISM_TURN_FRAME_SECONDS);
  return ((frame % PRISM_TURN_FRAMES) + PRISM_TURN_FRAMES) % PRISM_TURN_FRAMES;
}

/** Whether a cut raises an aura, which the three a chain earns all do. */
export function raisesAura(cut: string): boolean {
  return cut === "brilliant" || cut === "star" || cut === "prism";
}

/** The key an aura is held under: its cell, and the cut standing in it. */
export function auraKey(cell: Cell, cut: string): string {
  return `${cell.col},${cell.row}:${cut}`;
}

/** A break sheet playing at one cell, after its wave has come round. */
interface Break {
  readonly kind: string;
  readonly x: number;
  readonly y: number;
  /** The game time the sheet waits before its first frame. */
  readonly delay: number;
  age: number;
}

/** A pooled scratch canvas one system is composited into. */
interface Slot {
  readonly ctx: CanvasRenderingContext2D;
  readonly width: number;
  readonly height: number;
  busy: boolean;
}

/** A burst that has been thrown but whose wave has not come round yet. */
interface Pending {
  readonly key: string;
  readonly x: number;
  readonly y: number;
  /** How much of its delay is left to run. */
  wait: number;
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

/** One looping aura, held for as long as its cut gem stands in its cell. */
interface Aura {
  readonly cell: Cell;
  readonly slot: Slot;
  readonly player: ParticleCanvasPlayer;
}

export class Presentation {
  private readonly scratch: ScratchCanvas;
  private readonly breaks: Break[] = [];
  private readonly bursts: Burst[] = [];
  private readonly pending: Pending[] = [];
  /** One aura per cut gem standing on the board, keyed by cell and cut. */
  private readonly auras = new Map<string, Aura>();
  /** The pooled canvases, by system key: one pool per field size. */
  private readonly pools = new Map<string, Slot[]>();
  /**
   * The parsed system each throw was made against, kept so a burst held back
   * by its wave can ignite without being handed the store a second time.
   */
  private readonly systems = new Map<string, ParticleSystem>();
  /** How long the board has been pouring in, and `null` once it has landed. */
  private pour: number | null = null;
  private pourSpan = 0;

  constructor(scratch: ScratchCanvas) {
    this.scratch = scratch;
  }

  /**
   * Whether anything thrown is still flying, which is what the renderer skips
   * on. The auras are not counted: they run for as long as their stones stand,
   * so a board that has earned a cut would never read as quiet.
   */
  idle(): boolean {
    return (
      this.breaks.length === 0 &&
      this.bursts.length === 0 &&
      this.pending.length === 0
    );
  }

  /**
   * How long the board has been pouring in, or `null` when it is standing
   * still. It is the fall clock for a board no chain step timed — a fresh deal,
   * the next level, a posed board — and the renderer reads it exactly as it
   * reads `stepTimer` for a step in progress.
   */
  pourAge(): number | null {
    return this.pour;
  }

  /**
   * Take the chain steps that ran since the presentation was last handed the
   * board, notice a board that changed with no step to explain it, and hold one
   * aura per cut gem standing on the board it was handed.
   *
   * A board that arrives unexplained is a different board entirely — a fresh
   * deal, the next level, a posed `loadBoard`, a `reset` — so whatever is still
   * flying belongs to the one that is gone, and the new one starts its pour.
   */
  observe(
    boardBefore: BoardState,
    boardAfter: BoardState,
    steps: readonly StepReport[],
    assets: AssetStore,
  ): void {
    if (steps.length === 0) {
      if (!sameBoard(boardBefore, boardAfter)) {
        this.clear();
        this.beginPour(boardAfter);
      }
    } else {
      for (const step of steps) this.spawn(step, assets);
    }
    this.holdAuras(boardAfter, assets);
  }

  /** Age every sheet, burst, and aura by `dt`, retiring the ones that have run. */
  advance(dt: number): void {
    if (this.pour !== null) {
      this.pour += dt;
      if (this.pour >= this.pourSpan) this.pour = null;
    }
    for (let index = this.breaks.length - 1; index >= 0; index -= 1) {
      const sheet = this.breaks[index];
      sheet.age += dt;
      if (sheet.age >= sheet.delay + BREAK_FRAMES * BREAK_FRAME_SECONDS) {
        this.breaks.splice(index, 1);
      }
    }
    for (let index = this.pending.length - 1; index >= 0; index -= 1) {
      const waiting = this.pending[index];
      waiting.wait -= dt;
      if (waiting.wait > 0) continue;
      this.pending.splice(index, 1);
      this.ignite(waiting.key, waiting.x, waiting.y, -waiting.wait);
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
    for (const aura of this.auras.values()) aura.player.update(dt);
  }

  /** Drop everything playing and free every pooled canvas. */
  clear(): void {
    this.breaks.length = 0;
    this.pending.length = 0;
    for (const burst of this.bursts) burst.slot.busy = false;
    this.bursts.length = 0;
    for (const aura of this.auras.values()) aura.slot.busy = false;
    this.auras.clear();
    this.pour = null;
    this.pourSpan = 0;
  }

  /**
   * Draw the break sheets, at native sprite size, centered on their cells. A
   * sheet whose wave has not come round yet draws nothing at all.
   */
  drawBreaks(ctx: CanvasRenderingContext2D, assets: AssetStore): void {
    for (const sheet of this.breaks) {
      if (sheet.age < sheet.delay) continue;
      const frame = Math.min(
        BREAK_FRAMES - 1,
        Math.floor((sheet.age - sheet.delay) / BREAK_FRAME_SECONDS),
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

  /**
   * Blit every aura, additively and mixed down, at wherever the renderer says
   * that cell's gem currently is — so an aura travels with the stone it belongs
   * to rather than hanging over the cell it came from.
   */
  drawAuras(
    ctx: CanvasRenderingContext2D,
    at: (cell: Cell) => readonly [number, number],
  ): void {
    if (this.auras.size === 0) return;
    const previousMode = ctx.globalCompositeOperation;
    const previousAlpha = ctx.globalAlpha;
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = AURA_ALPHA;
    for (const aura of this.auras.values()) {
      const [x, y] = at(aura.cell);
      ctx.drawImage(
        aura.slot.ctx.canvas,
        x - aura.slot.width / 2,
        y - aura.slot.height / 2,
        aura.slot.width,
        aura.slot.height,
      );
    }
    ctx.globalAlpha = previousAlpha;
    ctx.globalCompositeOperation = previousMode;
  }

  /** The pour clock started, for as long as the longest fall on the board runs. */
  private beginPour(board: BoardState): void {
    const span = lastFall(board) * FALL_SECONDS_PER_ROW;
    if (span <= 0) return;
    this.pour = 0;
    this.pourSpan = span;
  }

  /** One step's sheets and bursts, each waiting on its own cell's wave. */
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
    // A created stone arrives once the whole set has shattered, so its flash
    // marks it on the frame the cell is its.
    for (const cell of step.created) {
      const [x, y] = cellCenter(cell);
      this.fire(FX_CUT, x, y, step.waves * WAVE_SECONDS, assets);
    }
  }

  /** One aura per cut gem on the board, taken up and given back as cuts move. */
  private holdAuras(board: BoardState, assets: AssetStore): void {
    const wanted = new Map<string, Cell>();
    for (let row = 0; row < board.rows; row += 1) {
      for (let col = 0; col < board.cols; col += 1) {
        const gem = board.gems[row * board.cols + col];
        if (!gem || !raisesAura(gem.cut)) continue;
        wanted.set(auraKey({ col, row }, gem.cut), { col, row });
      }
    }
    for (const [key, aura] of this.auras) {
      if (wanted.has(key)) continue;
      aura.slot.busy = false;
      this.auras.delete(key);
    }
    const system = assets.system(FX_AURA);
    if (system === null) return;
    for (const [key, cell] of wanted) {
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

  /**
   * One burst of the system under `key`, thrown at a stage position and held
   * back by `delay` of game time. A burst with nothing to wait for ignites on
   * the spot, so the cells of a step's seed shatter on the frame it resolved.
   */
  private fire(
    key: string,
    x: number,
    y: number,
    delay: number,
    assets: AssetStore,
  ): void {
    const system = assets.system(key);
    if (system === null) return;
    this.systems.set(key, system);
    const live =
      this.bursts.reduce(
        (count, burst) => (burst.key === key ? count + 1 : count),
        0,
      ) +
      this.pending.reduce(
        (count, waiting) => (waiting.key === key ? count + 1 : count),
        0,
      );
    if (live >= MAX_BURSTS_PER_SYSTEM) return;
    if (delay > 0) {
      this.pending.push({ key, x, y, wait: delay });
      return;
    }
    this.ignite(key, x, y, 0);
  }

  /** A waiting burst brought to life, already `age` of game time into itself. */
  private ignite(key: string, x: number, y: number, age: number): void {
    const system = this.systems.get(key);
    if (system === undefined) return;
    const slot = this.take(key, system.field.width, system.field.height);
    if (slot === null) return;
    // `clear` is left at its default: the player owns its scratch canvas
    // outright and wipes it before compositing each frame.
    const player = new ParticleCanvasPlayer(system, slot.ctx, {
      pixelRadius: Math.max(slot.width, slot.height) * BURST_PIXEL_RADIUS,
    });
    if (age > 0) player.update(age);
    this.bursts.push({
      key,
      slot,
      player,
      x,
      y,
      life: system.durationMs / 1000 + 1,
      age,
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

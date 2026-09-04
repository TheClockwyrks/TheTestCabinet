// Facet — the presentation layer: the break sheets, the particle bursts a chain
// throws, the aura every cut stone carries, and the clock a fresh board pours
// in on.
//
// Everything here is DECORATION, and it is deliberately kept out of the game's
// state. `specs/state.md` fixes what the state carries and
// `specs/instrumentation.md` rests on that state being reproducible from a seed
// and a delta time; a shatter still flying when a scenario reads the board
// would be neither. So the simulation reports what each chain step did
// (`src/game.ts` derives it from the core's own rules), this module turns those
// reports into things that move, and nothing here is ever read back.
//
// Four kinds of thing move:
//
//   * A BREAK SHEET per cleared gem — the `draw-sheet` sequence for that gem's
//     kind, played at its cell (specs/assets.md), and started at the moment
//     `specs/rules.md` gives that cell: a cell at wave `w` shatters
//     `w * WAVE_SECONDS` into the step, so the set comes apart in waves rather
//     than all on one frame. The delay is carried as a NEGATIVE age, so one
//     figure both holds the sheet back and then runs it.
//   * A PARTICLE BURST per cleared gem and per created cut — one of the
//     one-shot `particle-2d` systems, simulated live through
//     `@test-cabinet/particle-runtime`'s `ParticleCanvasPlayer`
//     (specs/assets.md). A burst cannot be held back the way a sheet can, since
//     it starts emitting the moment it is built, so the ones that belong to a
//     later wave wait in a queue until their moment comes.
//   * A CUT AURA per `brilliant`, `star`, and `prism` standing on the board —
//     the LOOPING system, run continuously for exactly as long as that gem
//     stands in that cell, which is what keeps a cut stone from ever being
//     still. They are reconciled against the board every frame rather than
//     spawned by an event, because a cut stone arrives by R8, by R9 dropping it
//     into a new cell, and by a posed `loadBoard` alike.
//   * THE POUR of a fresh board. A dealt board's gems carry the `fell` that
//     brought them in from above the board, but no chain step resolved, so
//     nothing in the state times their arrival. This layer holds that one clock
//     (`pourAge`), and `src/motion.ts` reads it.
//
// The scratch canvases are pooled because allocating one per shattered gem
// would churn a dozen canvases a step; the players are not, so each burst draws
// its own random play rather than replaying a pooled one.

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
import { WAVE_SECONDS } from "./constants";
import { cellCenter, gemAt, type Cell, type FacetState } from "./core";
import { NO_POUR, isPouredBoard, type Point } from "./motion";
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

/**
 * The most cut auras run at once. Every `brilliant`, `star`, and `prism` on the
 * board carries one and they run for as long as the stone stands, so unlike a
 * burst they never retire on their own; the cap is what keeps a board that has
 * earned a great many of them cheap to draw.
 */
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
 * The same figure for an aura, which is light rather than debris: the motes a
 * cut stone throws are drawn softer and larger than a chip of stone so the two
 * are never confused for one another.
 */
const AURA_PIXEL_RADIUS = 0.024;

/** One gem a chain step removed, as the presentation needs to draw it. */
export interface ClearedGem extends Cell {
  /** The kind whose break sheet plays; `null` for a prism, which has none. */
  readonly kind: string | null;
  /** Whether it was at `MAX_STRAIN`, which throws the heavier detonation. */
  readonly flawed: boolean;
  /** The wave R6 gave the cell, which is what holds its shatter back. */
  readonly wave: number;
}

/** What one chain step did, as the presentation needs it. */
export interface StepReport {
  readonly cleared: readonly ClearedGem[];
  /** The cells R8 created a cut gem in, each marked with the cut flash. */
  readonly created: readonly Cell[];
  /** The greatest wave the step's clear set carried, which its flashes wait on. */
  readonly waves: number;
}

/**
 * The frame of the prism's idle turn showing at `simTime`, which every prism on
 * the board is drawn at — so the turn is a pure function of game time and a
 * driven scenario reproduces it exactly.
 */
export function prismTurnFrame(simTime: number): number {
  const frame = Math.floor(simTime / PRISM_TURN_FRAME_SECONDS);
  return ((frame % PRISM_TURN_FRAMES) + PRISM_TURN_FRAMES) % PRISM_TURN_FRAMES;
}

/** The key one cell's aura is held under; the cut is in it, so a stone that
 * becomes another cut starts a new aura rather than inheriting one. */
export function auraKey(cell: Cell, cut: string): string {
  return `${cell.col},${cell.row},${cut}`;
}

/** A break sheet playing at one cell. A negative age is its wave's delay. */
interface Break {
  readonly kind: string;
  readonly x: number;
  readonly y: number;
  age: number;
}

/** A burst waiting for the wave that throws it. */
interface Pending {
  readonly key: string;
  readonly x: number;
  readonly y: number;
  delay: number;
}

/** A pooled scratch canvas one effect is composited into. */
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

/** One cut stone's looping aura, which lives as long as the stone stands. */
interface Aura {
  readonly cell: Cell;
  readonly slot: Slot;
  readonly player: ParticleCanvasPlayer;
  /** Whether this frame's board still holds the stone the aura belongs to. */
  standing: boolean;
}

export class Presentation {
  private readonly scratch: ScratchCanvas;
  private readonly breaks: Break[] = [];
  private readonly bursts: Burst[] = [];
  private readonly pending: Pending[] = [];
  private readonly auras = new Map<string, Aura>();
  /** The pooled canvases, by system key: one pool per field size. */
  private readonly pools = new Map<string, Slot[]>();
  /** The game time a freshly dealt board has been pouring in for. */
  private pour = NO_POUR;

  constructor(scratch: ScratchCanvas) {
    this.scratch = scratch;
  }

  /**
   * Whether the board has anything transient flying over it. The auras are not
   * among them: they run for as long as their stones stand rather than playing
   * out, so a board carrying a cut stone is never quiet by this measure and the
   * figure would say nothing.
   */
  idle(): boolean {
    return (
      this.breaks.length === 0 &&
      this.bursts.length === 0 &&
      this.pending.length === 0
    );
  }

  /**
   * How long the board on screen has been pouring in from above, or
   * {@link NO_POUR} when no pour is running. `src/motion.ts` reads it to place
   * a dealt board's gems, which no timer in the state covers.
   */
  pourAge(): number {
    return this.pour;
  }

  /**
   * Take the chain steps that ran since the presentation was last handed the
   * game, notice a board that changed with no step to explain it, and reconcile
   * the auras against the board as it now stands.
   *
   * A board that arrives unexplained is a different board entirely — a fresh
   * deal, a posed `loadBoard`, a `reset` — and whatever is still flying belongs
   * to the one that is gone. A board every one of whose gems came in from above
   * it is a DEAL, and that one starts the pour.
   */
  observe(
    previous: FacetState,
    current: FacetState,
    steps: readonly StepReport[],
    assets: AssetStore,
  ): void {
    if (steps.length > 0) {
      // A step's own fall is timed off `stepTimer`, so no pour clock runs.
      this.pour = NO_POUR;
      for (const step of steps) this.spawn(step, assets);
    } else if (current.board !== previous.board) {
      this.clear();
      this.pour = isPouredBoard(current) ? 0 : NO_POUR;
    }
    this.syncAuras(current, assets);
  }

  /** Age every sheet, burst, aura and pour by `dt`, retiring what has run. */
  advance(dt: number, assets: AssetStore): void {
    if (this.pour !== NO_POUR) this.pour += dt;

    for (let index = this.breaks.length - 1; index >= 0; index -= 1) {
      const sheet = this.breaks[index];
      sheet.age += dt;
      if (sheet.age >= BREAK_FRAMES * BREAK_FRAME_SECONDS) {
        this.breaks.splice(index, 1);
      }
    }

    for (let index = this.pending.length - 1; index >= 0; index -= 1) {
      const waiting = this.pending[index];
      waiting.delay -= dt;
      if (waiting.delay > 0) continue;
      this.pending.splice(index, 1);
      this.fire(waiting.key, waiting.x, waiting.y, assets);
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
    this.pour = NO_POUR;
  }

  /** Draw the break sheets, at native sprite size, centered on their cells. */
  drawBreaks(ctx: CanvasRenderingContext2D, assets: AssetStore): void {
    for (const sheet of this.breaks) {
      // Still waiting on its wave: the stone has not come apart yet.
      if (sheet.age < 0) continue;
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

  /**
   * Blit every cut stone's aura, at the position the renderer says that stone
   * is currently drawn at — which is not its cell center while it is falling or
   * mid-swap, and the aura travels with the stone rather than staying behind.
   */
  drawAuras(ctx: CanvasRenderingContext2D, at: (cell: Cell) => Point): void {
    if (this.auras.size === 0) return;
    const previous = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = "lighter";
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
    ctx.globalCompositeOperation = previous;
  }

  /** One step's sheets and bursts, each held back by the wave it belongs to. */
  private spawn(step: StepReport, assets: AssetStore): void {
    for (const gem of step.cleared) {
      const [x, y] = cellCenter(gem);
      const delay = gem.wave * WAVE_SECONDS;
      // A prism carries no kind, so there is no break sheet for it; its
      // shatter is carried by the burst alone.
      if (gem.kind !== null && this.breaks.length < MAX_BREAKS) {
        this.breaks.push({ kind: gem.kind, x, y, age: -delay });
      }
      this.enqueue(gem.flawed ? FX_FLAWED : FX_CLEAR, x, y, delay, assets);
    }
    // A cut stone is revealed by the shattering that made it, so its flash
    // waits for the last wave rather than landing before the set has gone.
    const created = step.waves * WAVE_SECONDS;
    for (const cell of step.created) {
      const [x, y] = cellCenter(cell);
      this.enqueue(FX_CUT, x, y, created, assets);
    }
  }

  /** One burst, thrown now or queued until its wave comes round. */
  private enqueue(
    key: string,
    x: number,
    y: number,
    delay: number,
    assets: AssetStore,
  ): void {
    if (delay <= 0) this.fire(key, x, y, assets);
    else this.pending.push({ key, x, y, delay });
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

  /**
   * The auras brought level with the board: one running at every `brilliant`,
   * `star`, and `prism` standing on it, and none anywhere else.
   *
   * An aura already running is left exactly as it is, so a stone that has stood
   * for a while carries a settled aura rather than one restarted every frame,
   * and a stone that has gone takes its aura with it.
   */
  private syncAuras(state: FacetState, assets: AssetStore): void {
    for (const aura of this.auras.values()) aura.standing = false;

    const { board } = state;
    for (let row = 0; row < board.rows; row += 1) {
      for (let col = 0; col < board.cols; col += 1) {
        const cell: Cell = { col, row };
        const gem = gemAt(board, cell);
        if (gem === null || gem.cut === "plain") continue;
        const key = auraKey(cell, gem.cut);
        const running = this.auras.get(key);
        if (running !== undefined) {
          running.standing = true;
          continue;
        }
        if (this.auras.size >= MAX_AURAS) continue;
        const started = this.startAura(cell, assets);
        if (started !== null) this.auras.set(key, started);
      }
    }

    for (const [key, aura] of this.auras) {
      if (aura.standing) continue;
      aura.slot.busy = false;
      this.auras.delete(key);
    }
  }

  /** One looping aura over a cut stone's cell, or `null` until its system is in. */
  private startAura(cell: Cell, assets: AssetStore): Aura | null {
    const system = assets.system(FX_AURA);
    if (system === null) return null;
    const slot = this.take(FX_AURA, system.field.width, system.field.height);
    if (slot === null) return null;
    return {
      cell,
      slot,
      player: new ParticleCanvasPlayer(system, slot.ctx, {
        pixelRadius: Math.max(slot.width, slot.height) * AURA_PIXEL_RADIUS,
      }),
      standing: true,
    };
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

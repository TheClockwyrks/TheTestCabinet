// The live simulation: reset-and-replay over the authoritative `lattice-core`
// engine.
//
// This tool never reimplements the factory physics. It loads the SAME wasm engine
// the CLI, the validator, and the console's run player use, through the reused
// `Engine`/`Renderer` from `@lattice`. "Live" is achieved by replay: on every edit
// the design is projected to a scenario, the engine is reloaded from an empty start,
// and the whole preview window is stepped into a frame cache the render loop then
// interpolates over and loops. Because the model is integer-deterministic and fast,
// a freshly dropped component reaches steady state within the window almost at once,
// so it reads as "it starts running the moment it can" — Factorio-style — without a
// second simulation to keep in sync. The one visible cost is that editing (and the
// loop wrap) restarts the window from empty; the planned live-edit engine ABI is
// what removes that.

import { Engine, Renderer, loadSheet } from "@lattice/renderer";
import type { Board, Sheet, Snapshot } from "@lattice/renderer";
import { atlas, sheetPngUrl, wasmUrl } from "./assets";
import { defaultTimeline, toScenario, type Design } from "./model";

// Ticks of factory time held in the cached preview window. Long enough for a modest
// factory to fill and reach steady motion, short enough that a rebuild on each edit
// (and the frame cache it holds) stays cheap. Independent of the export run length.
const WINDOW_TICKS = 900;

// Simulation ticks advanced per real second at 1×. Deliberately modest: items draw
// at interpolated positions between ticks, so a low tick rate reads as smooth
// motion, matching the console player's feel.
const TICKS_PER_SECOND = 20;

/** What the UI shows about the running sim. */
export interface SimStatus {
  /** False when the engine rejected the current design (an invalid layout). */
  valid: boolean;
  /** The factory tick currently on screen. */
  tick: number;
  /** How many ticks the cached window holds. */
  windowTicks: number;
}

/**
 * Drives one `<canvas>`: owns the engine, the cached window, and the animation
 * loop. Rendering is the reused `Renderer`; the only logic here is caching the
 * window and interpolating/looping over it.
 */
export class Simulation {
  private readonly renderer: Renderer;
  private board: Board | null = null;
  private frames: Snapshot[] = [];
  /** Continuous frame-index position: `floor(pos)` is the frame drawn, the fraction
   * is the tween toward the next. */
  private pos = 0;
  private raf = 0;
  private last = 0;
  private reportedTick = -1;

  playing = true;
  speed = 1;

  private constructor(
    private readonly ctx: CanvasRenderingContext2D,
    sheet: Sheet,
    private readonly engine: Engine,
    private readonly onStatus: (status: SimStatus) => void,
  ) {
    this.renderer = new Renderer(ctx, sheet);
  }

  /** Fetch the vendored engine + sheet and wire a simulation to `ctx`. */
  static async create(
    ctx: CanvasRenderingContext2D,
    onStatus: (status: SimStatus) => void,
  ): Promise<Simulation> {
    const [wasm, sheetBlob] = await Promise.all([
      fetch(wasmUrl).then((r) => r.arrayBuffer()),
      fetch(sheetPngUrl).then((r) => r.blob()),
    ]);
    const sheet = await loadSheet(sheetBlob, atlas);
    const engine = await Engine.instantiate(wasm);
    return new Simulation(ctx, sheet, engine, onStatus);
  }

  /**
   * Rebuild the cached window from `design` (the reset-and-replay step). Loads the
   * projected scenario from an empty start and steps the whole window into the
   * cache; an engine rejection leaves an empty, invalid window that draws blank.
   */
  setDesign(design: Design): void {
    // The preview always runs its own short window, whatever timeline the design
    // is destined for — a scored 300,000-tick schedule has nothing to do with what
    // the editor needs to show.
    const scenario = toScenario(design, defaultTimeline(WINDOW_TICKS));
    this.frames = [];
    this.board = null;
    this.pos = 0;
    this.reportedTick = -1;

    if (this.engine.load(scenario)) {
      this.board = this.engine.board();
      for (let f = this.engine.step(); f !== null; f = this.engine.step()) {
        this.frames.push(f);
        if (this.frames.length >= WINDOW_TICKS) break;
      }
    }
    this.emit(this.frames[0]?.tick ?? 0);
    this.render(this.last || performance.now());
  }

  /** Begin the animation loop. Idempotent. */
  start(): void {
    if (this.raf) return;
    this.last = performance.now();
    const loop = (now: number) => {
      this.render(now);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  /** Stop the loop and release the rAF handle. */
  stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private render(now: number): void {
    // Clamp the step to `[0, 0.25]`s. The upper bound absorbs a suspended tab's huge
    // gap; the lower bound matters because `setDesign` renders out of band with
    // the rAF clock, and a frame's rAF timestamp can predate a `performance.now()`
    // sampled just before it — a negative `dt` would drive `pos` below zero.
    const dt = Math.min(Math.max((now - this.last) / 1000, 0), 0.25);
    this.last = now;

    // A canvas resize (grid change) clears this flag, so re-assert it every frame to
    // keep sprites crisp rather than bilinear-blurred.
    this.ctx.imageSmoothingEnabled = false;

    if (!this.board || this.frames.length === 0) {
      this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
      return;
    }

    if (this.playing) this.pos += dt * TICKS_PER_SECOND * this.speed;

    // Loop the cached window. A single-frame window has nothing to tween, so it just
    // holds on that frame.
    if (this.frames.length === 1) {
      this.renderer.draw(this.board, null, this.frames[0]!, 1, now / 1000);
      this.emit(this.frames[0]!.tick);
      return;
    }
    if (this.pos >= this.frames.length - 1) this.pos = 0;

    const i = Math.floor(this.pos);
    const cur = this.frames[i];
    const nxt = this.frames[i + 1];
    if (!cur || !nxt) {
      // Defensive: `dt`/`pos` are clamped so this should not happen, but rather than
      // risk killing the loop, hold on the last cached frame.
      const last = this.frames[this.frames.length - 1]!;
      this.renderer.draw(this.board, null, last, 1, now / 1000);
      this.emit(last.tick);
      return;
    }
    this.renderer.draw(this.board, cur, nxt, this.pos - i, now / 1000);
    this.emit(cur.tick);
  }

  /** Report status when the on-screen tick changes, so the UI updates at most once
   * per tick rather than once per animation frame. */
  private emit(tick: number): void {
    if (tick === this.reportedTick) return;
    this.reportedTick = tick;
    this.onStatus({
      valid: this.board !== null,
      tick,
      windowTicks: this.frames.length,
    });
  }
}

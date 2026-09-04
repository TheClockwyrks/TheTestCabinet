// Coil — the frame loop, and the clock the debug surface takes hold of.
//
// The game stands on no engine, so nothing outside this build owns its clock. The
// loop measures elapsed wall time, hands it to the game, and draws; `setAutoStep`
// and `advance` are what take that away and give it back. Both paths run the SAME
// frame, so a scenario driven from code behaves exactly like one played by hand:
// drain the input, hand the game the frame's elapsed time, and draw.
//
// While the simulation is held off the wall clock the loop keeps running: it keeps
// reading the actions and keeps drawing, so a menu still answers a key press and the
// canvas still shows the state the most recent frame left.

import type { Assets } from "./assets";
import { STAGE_H, STAGE_W } from "./constants";
import type { Diagnostics } from "./diagnostics";
import type { Game } from "./game";
import type { Keyboard, Pointer } from "./input";
import { drawOverlay } from "./overlay";
import { render } from "./render";
import { COLORS } from "./theme";
import { computeFit, syncCanvas, toLogical } from "./viewport";

/** The longest stretch of wall time one frame hands the simulation. */
const MAX_FRAME_SECONDS = 0.25;

export class Runtime {
  /** Whether the frame loop feeds elapsed time to the simulation. */
  autoStep = true;
  /** Whether the diagnostics overlay is shown. Off when the game starts. */
  overlay = false;

  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly game: Game;
  private readonly assets: Assets;
  private readonly keyboard: Keyboard;
  private readonly pointer: Pointer;
  private readonly diagnostics: Diagnostics;
  private elapsed = 0;
  /** The fit this frame draws under, which is what turns a client point logical. */
  private fit = computeFit(STAGE_W, STAGE_H);
  private last = 0;
  private running = false;

  constructor(options: {
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    game: Game;
    assets: Assets;
    keyboard: Keyboard;
    pointer: Pointer;
    diagnostics: Diagnostics;
  }) {
    this.canvas = options.canvas;
    this.ctx = options.ctx;
    this.game = options.game;
    this.assets = options.assets;
    this.keyboard = options.keyboard;
    this.pointer = options.pointer;
    this.diagnostics = options.diagnostics;
  }

  /** Start the loop. It runs for the life of the page. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const tick = (now: number): void => {
      const wall = Math.min(MAX_FRAME_SECONDS, (now - this.last) / 1000);
      this.last = now;
      this.frame(wall, this.autoStep);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /**
   * Run `frames` whole frames covering `seconds` of game time, each worth
   * `seconds / frames`, immediately and in order.
   */
  advance(seconds: number, frames: number): void {
    const step = seconds / frames;
    for (let i = 0; i < frames; i++) this.frame(step, true);
  }

  /** One frame: the input, the elapsed game time if it is being fed, and a draw. */
  private frame(dt: number, stepped: boolean): void {
    // Before the input, because a pointer edge is read through the fit of the
    // frame that reads it.
    this.fit = syncCanvas(this.canvas, window.devicePixelRatio || 1);
    this.readInput();
    if (stepped) {
      this.game.update(dt);
      this.elapsed += dt;
    }
    this.draw();
  }

  private readInput(): void {
    if (this.keyboard.drainOverlayToggles() % 2 === 1) {
      this.overlay = !this.overlay;
    }
    for (const action of this.keyboard.drain()) {
      this.game.handleAction(action);
    }
    // After the frame's keyboard edges, as `specs/ui.md` states.
    const dpr = window.devicePixelRatio || 1;
    for (const edge of this.pointer.drain()) {
      const at = toLogical(this.fit, edge.clientX, edge.clientY, dpr);
      this.game.handlePointer(edge.kind, at.x, at.y);
    }
  }

  private draw(): void {
    const fit = this.fit;
    // The letterbox bars carry the stage's own background color.
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.fillStyle = COLORS.stage;
    this.ctx.fillRect(0, 0, fit.width, fit.height);
    this.ctx.setTransform(fit.scale, 0, 0, fit.scale, fit.offsetX, fit.offsetY);
    render(this.ctx, this.game, this.assets, {
      time: this.elapsed,
      biteFrame: this.game.biteFrame(),
    });
    if (this.overlay) drawOverlay(this.ctx, this.diagnostics);
  }
}

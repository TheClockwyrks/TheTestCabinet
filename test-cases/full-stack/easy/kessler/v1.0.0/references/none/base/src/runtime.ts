// Kessler — the frame loop, and the clock the debug surface takes hold of
// (specs/overview.md "The runtime", specs/instrumentation.md).
//
// The game stands on no engine, so nothing outside this build owns its
// clock. Each frame reads the keyboard, feeds the elapsed wall time into the
// game's tick accumulator while `autoStep` holds, keeps the right music bed
// looping for the screen, and draws. `setAutoStep(false)` stops the wall
// clock reaching the accumulator — the loop keeps rendering and keeps
// reading keys, so a menu still answers while the simulation is held — and
// `step` runs whole ticks immediately, each followed by a render, so a
// stepped scenario's canvas always reflects its state.
//
// A press is routed against the screen that was up when the frame began, so
// the `Space` that confirms START does not also launch on the play screen it
// opens: `Space` carries both `confirm` and `launch`, and the two never
// answer on the same screen (specs/controls.md).

import type { Assets } from "./assets";
import { bedForScreen, type WebAudioBus } from "./audio";
import { SCREEN_ACTIONS, TICK_DT } from "./constants";
import type { Diagnostics } from "./diagnostics";
import type { Fx } from "./fx";
import type { Game } from "./game";
import type { Keyboard } from "./input";
import { drawOverlay } from "./overlay";
import { render } from "./render";
import { syncCanvas } from "./viewport";
import { COLORS } from "./theme";

/** The longest stretch of wall time one frame hands the simulation. */
const MAX_FRAME_SECONDS = 0.25;

export class Runtime {
  /** Whether the debug overlay is shown. Off when the game starts. */
  overlay = false;

  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly game: Game;
  private readonly assets: Assets;
  private readonly keyboard: Keyboard;
  private readonly diagnostics: Diagnostics;
  private readonly audio: WebAudioBus;
  private readonly fx: Fx;
  /** The tick count the last draw ran at, for the effects' game-time delta. */
  private drawnTicks = 0;
  private last = 0;
  private running = false;

  constructor(options: {
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    game: Game;
    assets: Assets;
    keyboard: Keyboard;
    diagnostics: Diagnostics;
    audio: WebAudioBus;
    fx: Fx;
  }) {
    this.canvas = options.canvas;
    this.ctx = options.ctx;
    this.game = options.game;
    this.assets = options.assets;
    this.keyboard = options.keyboard;
    this.diagnostics = options.diagnostics;
    this.audio = options.audio;
    this.fx = options.fx;
  }

  /** Whether the frame loop feeds the wall clock into the simulation. */
  get autoStep(): boolean {
    return this.game.autoStep;
  }

  /** Take the game off real time, or give it back. Changes no game state. */
  setAutoStep(auto: boolean): void {
    this.game.autoStep = auto;
  }

  /**
   * Run `ticks` whole simulation ticks, immediately and in order, each the
   * full tick followed by a render, so contacts resolve, cues fire, and the
   * canvas reflects the result (specs/instrumentation.md `step`).
   */
  step(ticks: number): void {
    for (let i = 0; i < ticks; i += 1) {
      this.game.tick();
      this.draw();
    }
  }

  /** Start the loop. It runs for the life of the page. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const frame = (now: number): void => {
      const wall = Math.min(MAX_FRAME_SECONDS, (now - this.last) / 1000);
      this.last = now;
      this.frame(wall);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  /** One frame: input, the elapsed time if it is being fed, sound, a draw. */
  private frame(dt: number): void {
    this.readInput();
    if (this.game.autoStep) this.game.update(dt);
    this.draw();
  }

  private readInput(): void {
    if (this.keyboard.drainOverlayToggles() % 2 === 1) {
      this.overlay = !this.overlay;
    }
    this.game.held.left = this.keyboard.held("left");
    this.game.held.right = this.keyboard.held("right");
    const answered = SCREEN_ACTIONS[this.game.screen];
    for (const action of this.keyboard.drainEdges()) {
      if (answered.includes(action)) this.game.handleAction(action);
    }
  }

  /** Draw the frame the state describes, and keep the right bed looping. */
  private draw(): void {
    this.audio.syncBed(bedForScreen(this.game.screen));
    const ticks = this.game.ticks;
    const fxDt = Math.max(0, ticks - this.drawnTicks) * TICK_DT;
    this.drawnTicks = ticks;
    const fit = syncCanvas(this.canvas, window.devicePixelRatio || 1);
    // The letterbox bars carry the stage's own background color.
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.fillStyle = COLORS.stage;
    this.ctx.fillRect(0, 0, fit.width, fit.height);
    this.ctx.setTransform(fit.scale, 0, 0, fit.scale, fit.offsetX, fit.offsetY);
    render(this.ctx, this.game, this.assets, this.fx, fxDt);
    if (this.overlay) drawOverlay(this.ctx, this.diagnostics);
  }
}

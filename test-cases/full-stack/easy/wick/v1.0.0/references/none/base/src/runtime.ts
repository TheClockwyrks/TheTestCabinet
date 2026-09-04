// Wick — the frame loop, and the clock the debug surface takes hold of
// (specs/overview.md "The runtime", specs/instrumentation.md).
//
// Nothing outside this build owns the clock. Each frame fits the stage to the
// canvas, reads the keyboard, hands the screen the press edges it answers,
// reads the pointer through that same fit, feeds the elapsed wall time into
// the accumulator while `autoStep` holds, reconciles the two loops from the
// state, mirrors the mute bit, plays the cues the frame raised, and draws.
// `step` runs frames whose update is one whole tick on `playing`, and
// `advance` runs one frame worth any delta time; both are the same frame the
// wall clock runs.

import type { Assets } from "./assets";
import type { WebAudioBus } from "./audio";
import { STAGE_H, STAGE_W, TICK_DT } from "./constants";
import type { Diagnostics } from "./diagnostics";
import type { Game } from "./game";
import { SCREEN_ACTIONS } from "./game";
import type { Keyboard, Pointer, StageMapping } from "./input";
import { drawOverlay } from "./overlay";
import { render } from "./render/render";
import { COLORS } from "./render/theme";
import {
  clientToStage,
  computeFit,
  cssBox,
  syncCanvas,
  wheelToStage,
  type Fit,
} from "./viewport";

/** The longest stretch of wall time one frame hands the simulation. */
const MAX_FRAME_SECONDS = 0.25;

/** How a frame advances the simulation. */
type Update =
  | { kind: "accumulate"; dt: number }
  | { kind: "tick" }
  | { kind: "hold"; dt: number };

export class Runtime {
  /** Whether the debug overlay is shown. Off when the game starts. */
  overlay = false;

  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly game: Game;
  private readonly assets: Assets;
  private readonly keyboard: Keyboard;
  private readonly pointer: Pointer;
  private readonly diagnostics: Diagnostics;
  private readonly audio: WebAudioBus;
  /** The fit the last frame drew under, which the pointer is read through. */
  private fit: Fit = computeFit(STAGE_W, STAGE_H);
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
    audio: WebAudioBus;
  }) {
    this.canvas = options.canvas;
    this.ctx = options.ctx;
    this.game = options.game;
    this.assets = options.assets;
    this.keyboard = options.keyboard;
    this.pointer = options.pointer;
    this.diagnostics = options.diagnostics;
    this.audio = options.audio;
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
   * Run `ticks` frames immediately and in order, each a frame whose update is
   * one whole tick on `playing` and nothing on any other screen.
   */
  step(ticks: number): void {
    for (let i = 0; i < ticks; i += 1) this.frame({ kind: "tick" });
  }

  /** Run one frame worth `seconds` of delta time, through the accumulator. */
  advance(seconds: number): void {
    this.frame({ kind: "accumulate", dt: seconds });
  }

  /** Start the loop. It runs for the life of the page. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (now: number): void => {
      const dt = Math.min(
        MAX_FRAME_SECONDS,
        Math.max(0, (now - this.last) / 1000),
      );
      this.last = now;
      this.frame(
        this.game.autoStep ? { kind: "accumulate", dt } : { kind: "hold", dt },
      );
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  /** One frame: the fit, input, the update, sound, a draw. */
  private frame(update: Update): void {
    const game = this.game;
    this.fit = syncCanvas(this.canvas, window.devicePixelRatio || 1);
    this.readInput();
    switch (update.kind) {
      case "accumulate":
        game.state.simTime += update.dt;
        game.update(update.dt);
        break;
      case "hold":
        game.state.simTime += update.dt;
        break;
      case "tick":
        game.state.simTime += TICK_DT;
        game.tickOnce();
        break;
    }
    this.audio.syncLoops(game.wantedLoops());
    game.mirrorMuted();
    for (const cue of game.drainCues()) this.audio.play(cue);
    this.draw();
  }

  /**
   * Read the input as it stands: the held movement, the press edges, and then
   * the pointer, which the screen the edges left answers.
   */
  private readInput(): void {
    if (this.keyboard.drainOverlayToggles() % 2 === 1) {
      this.overlay = !this.overlay;
    }
    this.game.held = this.keyboard.movement();
    // Every edge is read against the screen the frame began on.
    const answered = SCREEN_ACTIONS[this.game.screen];
    for (const action of this.keyboard.drainEdges()) {
      if (answered.includes(action)) this.game.handleAction(action);
    }
    this.game.handlePointer(this.pointer.drain(this.mapping()));
  }

  /** How this frame's client positions and wheel travel reach the stage. */
  private mapping(): StageMapping {
    const fit = this.fit;
    const box = cssBox(this.canvas);
    return {
      point: (x, y) => clientToStage(fit, box, x, y),
      travel: (delta) => wheelToStage(fit, box, delta),
    };
  }

  /** Draw the frame the state describes, under the fit this frame computed. */
  private draw(): void {
    const fit = this.fit;
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = COLORS.stage;
    ctx.fillRect(0, 0, fit.width, fit.height);
    ctx.setTransform(fit.scale, 0, 0, fit.scale, fit.offsetX, fit.offsetY);
    ctx.imageSmoothingEnabled = false;
    render(ctx, this.game.state, this.assets);
    if (this.overlay) drawOverlay(ctx, this.diagnostics);
  }
}

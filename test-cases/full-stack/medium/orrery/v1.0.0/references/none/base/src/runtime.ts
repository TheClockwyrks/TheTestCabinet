// Orrery — the frame loop, and the clock the debug surface takes hold of
// (specs/overview.md "The runtime", specs/instrumentation.md "The clock").
//
// The game stands on no engine, so nothing outside this build owns its clock.
// Each frame reads the keyboard and the pointer, hands the game the elapsed
// wall time while `autoStep` holds, keeps the music bed looping, and draws.
//
// `setAutoStep(false)` stops the wall clock reaching the game — the loop keeps
// rendering and keeps reading the keys, so a menu still answers a press while
// the simulation is held — and `advance(seconds, frames)` runs whole frames
// immediately, each a real frame of the loop's own update followed by a render,
// so a stepped scenario's canvas always reflects its state.
//
// Input is resolved before the update, and every pointer sample is resolved in
// the order it arrived, because specs/controls.md decides a lay by the
// positions the pointer passed through rather than by where it finished.

import { ACTIONS, CUES, SCREEN_ACTIONS } from "./constants";
import type { AudioBus } from "./audio";
import type { Diagnostics } from "./diagnostics";
import type { Game } from "./game";
import type { Keyboard } from "./keyboard";
import { drawOverlay } from "./overlay";
import type { Pointer } from "./pointer";
import { render } from "./render";
import { COLORS } from "./theme";
import { syncCanvas, type Fit, type Surface } from "./viewport";

/** The longest stretch of wall time one frame hands the game. */
const MAX_FRAME_SECONDS = 0.25;

/** What the loop is stood up over. */
export interface RuntimeOptions {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  surface: Surface;
  game: Game;
  keyboard: Keyboard;
  pointer: Pointer;
  diagnostics: Diagnostics;
  audio: AudioBus;
  /** The clock the loop measures against; the wall clock by default. */
  now?: () => number;
  /** How a frame is scheduled; `requestAnimationFrame` by default. */
  schedule?: (frame: (now: number) => void) => void;
}

export class Runtime {
  /** Whether the debug overlay is shown. Off when the game starts. */
  overlay = false;

  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly surface: Surface;
  private readonly game: Game;
  private readonly keyboard: Keyboard;
  private readonly pointer: Pointer;
  private readonly diagnostics: Diagnostics;
  private readonly audio: AudioBus;
  private readonly now: () => number;
  private readonly schedule: (frame: (now: number) => void) => void;
  private last = 0;
  private running = false;

  constructor(options: RuntimeOptions) {
    this.canvas = options.canvas;
    this.ctx = options.ctx;
    this.surface = options.surface;
    this.game = options.game;
    this.keyboard = options.keyboard;
    this.pointer = options.pointer;
    this.diagnostics = options.diagnostics;
    this.audio = options.audio;
    this.now = options.now ?? ((): number => performance.now());
    this.schedule =
      options.schedule ??
      ((frame): void => {
        requestAnimationFrame(frame);
      });
  }

  /** Whether the frame loop advances the simulation from the wall clock. */
  get autoStep(): boolean {
    return this.game.state.autoStep;
  }

  /** Take the game off real time, or give it back. Changes no game state. */
  setAutoStep(auto: boolean): void {
    this.game.state.autoStep = auto;
  }

  /**
   * Run `frames` whole frames covering `seconds` of game time, each worth
   * `seconds / frames`, immediately and in order. Each is a real frame — the
   * update the loop runs, followed by a render — so the game's own simulation,
   * cues, and completion test produce the result and the canvas reflects it.
   */
  advance(seconds: number, frames = 1): void {
    const step = seconds / frames;
    for (let frame = 0; frame < frames; frame += 1) {
      this.game.update(step);
      this.draw();
    }
  }

  /** Start the loop. It runs for the life of the page. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = this.now();
    const frame = (now: number): void => {
      const wall = Math.min(MAX_FRAME_SECONDS, (now - this.last) / 1000);
      this.last = now;
      this.frame(wall);
      this.schedule(frame);
    };
    this.schedule(frame);
  }

  /** One frame: input, the elapsed time if it is being fed, sound, a draw. */
  frame(dt: number): void {
    this.readInput();
    if (this.autoStep) this.game.update(dt);
    this.audio.syncBed(CUES.music);
    this.draw();
    this.keyboard.endFrame();
    this.pointer.endFrame();
  }

  /** Resolve this frame's pointer samples and action edges, in order. */
  private readInput(): void {
    if (this.keyboard.drainOverlayToggles() % 2 === 1) {
      this.overlay = !this.overlay;
    }
    for (const sample of this.pointer.samples()) {
      this.game.handlePointer(sample);
    }
    for (const action of ACTIONS) {
      if (!this.keyboard.pressed(action)) continue;
      // Each edge is routed against the screen as it stands at that edge, so a
      // press that changes the screen leaves the next press to the new one.
      if (SCREEN_ACTIONS[this.game.actionContext()].includes(action)) {
        this.game.handleAction(action);
      }
    }
  }

  /** Draw the frame the state describes, letterboxed onto the canvas. */
  draw(): void {
    const fit: Fit = syncCanvas(this.canvas, this.surface);
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    // The letterbox bars carry the stage's own background color.
    this.ctx.fillStyle = COLORS.sky;
    this.ctx.fillRect(0, 0, fit.width, fit.height);
    if (!(fit.scale > 0)) return;
    this.ctx.setTransform(fit.scale, 0, 0, fit.scale, fit.offsetX, fit.offsetY);
    render(this.ctx, this.game);
    if (this.overlay) drawOverlay(this.ctx, this.diagnostics);
  }
}

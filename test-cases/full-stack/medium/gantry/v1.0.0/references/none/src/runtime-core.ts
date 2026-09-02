// The runtime layer itself, with the browser left out.
//
// `RuntimeCore` is the whole of what the game reaches through `Runtime`: the
// input tracker, the audio bus, and the debug overlay, wired together. It has
// no DOM in it, so it runs in Node and is tested there; `src/runtime.ts` is the
// browser half that measures the canvas, listens for real events, and feeds
// this.
//
// Both halves meet at the `feed*` calls, which is what makes a posed press and
// a player's press the same event to the game (`specs/instrumentation.md`).

import type { ActionName, CueName } from "./constants";
import { AudioBus, type AudioSink } from "./runtime-audio";
import { InputTracker } from "./runtime-input";
import {
  DiagnosticsOverlay,
  OVERLAY_TOGGLE_CODE,
  type OverlayView,
} from "./runtime-overlay";
import type { InputFrame, Runtime } from "./runtime";

/** What the core is built over: the sound and the panel, however they are had. */
export interface RuntimeCoreDeps {
  /** Open the audio bus. Called once, inside the first interaction. */
  openAudio: () => AudioSink | null;
  /** Where the diagnostic lines are drawn. */
  overlay: OverlayView;
}

/**
 * The runtime layer, holding no game state and deciding no rule.
 *
 * The first key press or pointer press to arrive opens the audio bus, whichever
 * path it came in by, because that is the player's first interaction with the
 * page (`specs/assets.md`). The backtick key is the overlay's and reaches no
 * further: it fires no action, since `specs/controls.md` binds it to none.
 */
export class RuntimeCore implements Runtime {
  private readonly input = new InputTracker();
  private readonly audio: AudioBus;
  private readonly overlay: DiagnosticsOverlay;

  constructor(deps: RuntimeCoreDeps) {
    this.audio = new AudioBus(deps.openAudio);
    this.overlay = new DiagnosticsOverlay(deps.overlay);
  }

  takeInput(): InputFrame {
    return this.input.take();
  }

  held(action: ActionName): boolean {
    return this.input.held(action);
  }

  pointerX(): number {
    return this.input.pointerX();
  }

  pointerY(): number {
    return this.input.pointerY();
  }

  feedKeyDown(code: string): void {
    this.audio.unlock();
    if (code === OVERLAY_TOGGLE_CODE) {
      this.overlay.toggle();
      return;
    }
    this.input.keyDown(code);
  }

  feedKeyUp(code: string): void {
    this.input.keyUp(code);
  }

  feedPointerMove(x: number, y: number): void {
    this.input.pointerMove(x, y);
  }

  feedPointerDown(x: number, y: number): void {
    this.audio.unlock();
    this.input.pointerDown(x, y);
  }

  feedPointerUp(): void {
    this.input.pointerUp();
  }

  playCue(cue: CueName): void {
    this.audio.playCue(cue);
  }

  setMotor(on: boolean): void {
    this.audio.setMotor(on);
  }

  isMuted(): boolean {
    return this.audio.isMuted();
  }

  toggleMute(): void {
    this.audio.toggleMute();
  }

  installAudio(
    cues: Readonly<Record<CueName, ArrayBuffer>>,
    music: ArrayBuffer,
  ): void {
    this.audio.installAudio(cues, music);
  }

  setDiagnostics(source: () => readonly string[]): void {
    this.overlay.setSource(source);
  }

  // ---- Beyond the game's contract -----------------------------------------

  /** Whether a press is live, which a stray release is judged against. */
  pointerPressed(): boolean {
    return this.input.pointerDownNow();
  }

  /** Whether the overlay is shown. */
  get overlayVisible(): boolean {
    return this.overlay.visible;
  }

  /** Draw the overlay's next reading. Called once a frame by the browser half. */
  refreshOverlay(): void {
    this.overlay.refresh();
  }
}

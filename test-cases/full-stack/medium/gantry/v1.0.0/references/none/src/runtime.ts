// The runtime layer this engineless build stands on.
//
// The layer owns the canvas fit, the keyboard, the pointer, audio, and the
// debug overlay, and nothing else: it holds no game state, decides no rule, and
// is handed the game's state only to read. The frame loop is `src/app.ts`'s,
// and it drives this layer by taking the input gathered since the last frame.
//
// Both the browser's own events and the debug surface's input operations
// (`specs/instrumentation.md`) arrive through the same `feed*` methods, so a
// posed press and a player's press are the same event to the game.
//
// This file is the contract and the browser half of the implementation: it
// measures the canvas, binds the real listeners, and feeds `RuntimeCore`, which
// is the layer's logic and carries no DOM. The parts are:
//
//   `src/runtime-stage.ts`   the canvas fit and the stage's units
//   `src/runtime-input.ts`   key bindings, held state, press edges, the pointer
//   `src/runtime-audio.ts`   the cues, the one loop, the music bed, and mute
//   `src/runtime-overlay.ts` the diagnostics panel and its backtick toggle
//   `src/runtime-core.ts`    the three of them, as the game reaches them

import type { ActionName, CueName } from "./constants";
import { RuntimeCore } from "./runtime-core";
import { webAudioSink } from "./runtime-audio";
import { isBoundCode } from "./runtime-input";
import { createOverlayView, OVERLAY_TOGGLE_CODE } from "./runtime-overlay";
import {
  measureStageFit,
  sizeCanvas,
  stagePointFromRect,
} from "./runtime-stage";

export {
  measureStageFit,
  onStage,
  sizeCanvas,
  stageFit,
  stagePoint,
  stagePointFromRect,
  type PixelRect,
  type RectLike,
  type StageFit,
} from "./runtime-stage";
export { OVERLAY_TOGGLE_CODE, type OverlayView } from "./runtime-overlay";
export { actionsForCode, isBoundCode } from "./runtime-input";
export { RuntimeCore, type RuntimeCoreDeps } from "./runtime-core";
export { webAudioSink, type AudioSink } from "./runtime-audio";

/** One pointer act, in the stage's logical units (`specs/overview.md`). */
export interface StagePointerEvent {
  kind: "move" | "down" | "up";
  x: number;
  y: number;
}

/** What arrived since the last frame, in the order it arrived. */
export interface InputFrame {
  /** The press edges of the registered actions (`specs/controls.md`). */
  actions: readonly ActionName[];
  /** The pointer's moves, presses, and releases. */
  pointer: readonly StagePointerEvent[];
}

/**
 * The runtime layer, as the game reaches it.
 *
 * Everything is synchronous and free of game knowledge. `takeInput` is called
 * exactly once per frame and empties what it returns; `held` answers for the
 * frame being run; the audio calls are idempotent for `motor` and one-shot for
 * every other cue.
 */
export interface Runtime {
  /** The lines the diagnostics overlay is showing, empty while it is hidden. */
  overlayLines(): readonly string[];
  /** Take and clear the input gathered since the last call. */
  takeInput(): InputFrame;
  /** Whether an action's key is held down right now. */
  held(action: ActionName): boolean;

  /** The pointer's current position in logical stage units. */
  pointerX(): number;
  pointerY(): number;

  /** Deliver a key press. `code` is a `KeyboardEvent.code`. */
  feedKeyDown(code: string): void;
  /** Deliver a key release. */
  feedKeyUp(code: string): void;
  /** Deliver a pointer move to a logical stage position. */
  feedPointerMove(x: number, y: number): void;
  /** Deliver a press at a logical stage position, moving the pointer there. */
  feedPointerDown(x: number, y: number): void;
  /** Deliver a release at the position the pointer is at. */
  feedPointerUp(): void;

  /** Play a one-shot cue (`specs/ui.md`). Silent while muted. */
  playCue(cue: CueName): void;
  /** Start or stop the one loop, `motor`. Calling it with what is already so
   * does nothing. */
  setMotor(on: boolean): void;
  /** The mute bit the state mirrors every update. */
  isMuted(): boolean;
  /** Toggle all sound, as the `mute` action does. */
  toggleMute(): void;

  /**
   * Hand the audio bus the produced sounds, once `src/assets.ts` has loaded
   * them: the encoded bytes per cue and the music bed's. Decoding them is the
   * bus's, which owns the `AudioContext`.
   */
  installAudio(
    cues: Readonly<Record<CueName, ArrayBuffer>>,
    music: ArrayBuffer,
  ): void;

  /**
   * Register the diagnostic source the overlay draws: a pure read called at
   * each draw, returning one short line per value
   * (`specs/instrumentation.md`). The overlay is off until the backtick key
   * (`Backquote`) toggles it.
   */
  setDiagnostics(source: () => readonly string[]): void;
}

/**
 * Keep the canvas's backing store fitted to the window, now and at every
 * later size and pixel density. Answers the function that refits it, which is
 * also what a resize calls.
 */
export function bindStageFit(
  canvas: HTMLCanvasElement,
  windowTarget: EventTarget,
): () => void {
  const refit = (): void => {
    sizeCanvas(canvas, measureStageFit(canvas));
  };
  refit();
  windowTarget.addEventListener("resize", refit);
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(refit).observe(canvas);
  }
  watchPixelRatio(refit);
  return refit;
}

/**
 * A change of pixel density — a page zoom, a window dragged to another display
 * — does not always come with a resize, so the current ratio is watched for
 * and the watch re-armed at the new one.
 */
function watchPixelRatio(refit: () => void): void {
  if (typeof matchMedia === "undefined") return;
  const arm = (): void => {
    const query = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    query.addEventListener(
      "change",
      () => {
        refit();
        arm();
      },
      { once: true },
    );
  };
  arm();
}

/**
 * Bind the keyboard. The browser's auto-repeat is dropped, so a held key is one
 * press edge and stays held; a key the game uses does not also scroll the page;
 * and a key held with a modifier is the browser's, not the game's.
 */
export function bindKeyboard(
  windowTarget: EventTarget,
  core: RuntimeCore,
): void {
  windowTarget.addEventListener("keydown", (event) => {
    const key = event as KeyboardEvent;
    if (key.repeat || key.ctrlKey || key.metaKey || key.altKey) return;
    if (isBoundCode(key.code) || key.code === OVERLAY_TOGGLE_CODE) {
      key.preventDefault();
    }
    core.feedKeyDown(key.code);
  });
  windowTarget.addEventListener("keyup", (event) => {
    core.feedKeyUp((event as KeyboardEvent).code);
  });
}

/**
 * Bind the pointer, in logical stage units.
 *
 * A press is taken on the canvas and its capture asked for, and the moves and
 * the release are taken from the window, so an orbit drag that leaves the
 * canvas keeps turning the camera and a release out there still ends the press
 * (`specs/controls.md`).
 */
export function bindPointer(
  canvas: HTMLCanvasElement,
  windowTarget: EventTarget,
  core: RuntimeCore,
): void {
  const at = (event: PointerEvent): { x: number; y: number } =>
    stagePointFromRect(
      canvas.getBoundingClientRect(),
      event.clientX,
      event.clientY,
    );

  canvas.addEventListener("pointerdown", (event) => {
    const pointer = event as PointerEvent;
    if (pointer.button !== 0) return;
    pointer.preventDefault();
    canvas.setPointerCapture?.(pointer.pointerId);
    const point = at(pointer);
    core.feedPointerDown(point.x, point.y);
  });

  windowTarget.addEventListener("pointermove", (event) => {
    const point = at(event as PointerEvent);
    core.feedPointerMove(point.x, point.y);
  });

  // A release is delivered at the position the pointer is already at: the
  // move that carried it there has arrived on its own.
  const release = (): void => {
    if (core.pointerPressed()) core.feedPointerUp();
  };
  windowTarget.addEventListener("pointerup", release);
  windowTarget.addEventListener("pointercancel", release);
}

/**
 * Stand the runtime layer up over the page's canvas: fit the fixed
 * `STAGE_W x STAGE_H` logical stage into the window at every size and pixel
 * density, bind the keyboard and the pointer, open the audio bus on the first
 * interaction, and prepare the overlay.
 */
export function createRuntime(canvas: HTMLCanvasElement): Runtime {
  const core = new RuntimeCore({
    openAudio: webAudioSink,
    overlay: createOverlayView(canvas.parentElement ?? document.body),
  });
  bindStageFit(canvas, window);
  bindKeyboard(window, core);
  bindPointer(canvas, window, core);

  // The overlay reads the game once a frame while it is shown, on its own
  // schedule: it is a pure read that changes nothing, so it neither belongs in
  // the game's update nor depends on the game still being on the wall clock.
  const draw = (): void => {
    core.refreshOverlay();
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);

  return core;
}

// Spectra — keyboard input (specs/controls.md). Keyboard only.
//
// Two flavors: held state (continuous ship motion, read live in the physics
// step) and edge events (a keydown consumed once per frame for menu navigation,
// the flip, the discharge, and pause). A held fire key auto-repeats at the fire
// cadence (handled by the game reading held state); a held flip/discharge does
// not auto-repeat (each acts once per press).

const GAME_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "KeyF",
  "KeyP",
  "KeyX",
  "KeyM",
  "ShiftLeft",
  "ShiftRight",
  "Space",
  "Enter",
  "Escape",
]);

export class Input {
  private down = new Set<string>();
  private queue: string[] = [];
  private firstPressHandlers: Array<() => void> = [];
  private firstPressFired = false;

  attach(target: Window = window): void {
    target.addEventListener("keydown", this.onKeyDown);
    target.addEventListener("keyup", this.onKeyUp);
    target.addEventListener("blur", this.onBlur);
  }

  // Fired on the very first key press — used to resume the AudioContext, which
  // browsers block until a user gesture.
  onFirstPress(fn: () => void): void {
    this.firstPressHandlers.push(fn);
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  // Release every held key and discard queued edge events. The debug API's
  // reset() calls this so a driven scenario starts from a clean input state
  // (specs/instrumentation.md).
  releaseAll(): void {
    this.down.clear();
    this.queue = [];
  }

  // Drain and return the edge events queued since the last frame.
  drain(): string[] {
    const q = this.queue;
    this.queue = [];
    return q;
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (GAME_KEYS.has(e.code)) e.preventDefault();
    if (!this.firstPressFired) {
      this.firstPressFired = true;
      for (const fn of this.firstPressHandlers) fn();
    }
    if (e.repeat) return; // auto-repeat is held state, never an edge event
    this.down.add(e.code);
    this.queue.push(e.code);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.down.delete(e.code);
  };

  private onBlur = (): void => {
    this.down.clear();
  };
}

// --- Semantic helpers over raw key codes -----------------------------------

export function heldLeft(i: Input): boolean {
  return i.isDown("ArrowLeft") || i.isDown("KeyA");
}
export function heldRight(i: Input): boolean {
  return i.isDown("ArrowRight") || i.isDown("KeyD");
}
export function heldFire(i: Input): boolean {
  return i.isDown("Space") || i.isDown("ArrowUp") || i.isDown("KeyW");
}

export function isFlip(code: string): boolean {
  return code === "ShiftLeft" || code === "ShiftRight" || code === "KeyF";
}
export function isDischarge(code: string): boolean {
  return code === "KeyX";
}
export function isMenuUp(code: string): boolean {
  return code === "ArrowUp" || code === "KeyW";
}
export function isMenuDown(code: string): boolean {
  return code === "ArrowDown" || code === "KeyS";
}
export function isConfirm(code: string): boolean {
  return code === "Enter" || code === "Space";
}
export function isBack(code: string): boolean {
  return code === "Escape";
}
export function isPause(code: string): boolean {
  return code === "Escape" || code === "KeyP";
}
export function isMute(code: string): boolean {
  return code === "KeyM";
}

// Floe — keyboard input.
//
// Two flavors: held state (a direction key held to auto-repeat hops, gated by the
// hop cooldown, read live in the fixed step) and edge events (a keydown consumed
// once per frame for menu navigation, pause, and mute). Keyboard only.

import type { Dir } from "./types";

const GAME_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "KeyW",
  "KeyS",
  "KeyA",
  "KeyD",
  "Enter",
  "Space",
  "Escape",
  "KeyP",
  "KeyM",
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

  // The direction currently held (for auto-repeat hops), or null. Vertical wins
  // over horizontal so forward progress is favored under diagonal key mashing.
  heldDir(): Dir | null {
    if (this.isDown("ArrowUp") || this.isDown("KeyW")) return "up";
    if (this.isDown("ArrowDown") || this.isDown("KeyS")) return "down";
    if (this.isDown("ArrowLeft") || this.isDown("KeyA")) return "left";
    if (this.isDown("ArrowRight") || this.isDown("KeyD")) return "right";
    return null;
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
    if (e.repeat) return; // OS auto-repeat is held state, never an edge event
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

// ---- Semantic helpers over raw key codes -------------------------------
export function dirOf(code: string): Dir | null {
  switch (code) {
    case "ArrowUp":
    case "KeyW":
      return "up";
    case "ArrowDown":
    case "KeyS":
      return "down";
    case "ArrowLeft":
    case "KeyA":
      return "left";
    case "ArrowRight":
    case "KeyD":
      return "right";
    default:
      return null;
  }
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

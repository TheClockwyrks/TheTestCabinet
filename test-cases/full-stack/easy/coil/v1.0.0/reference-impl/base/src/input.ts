// Coil — keyboard input (specs/ui.md "Controls"). Keyboard only.
//
// A tiny edge queue: keydown events are collected as their physical `KeyboardEvent.code`
// and drained once per frame by the loop, so input is handled at frame boundaries alongside
// the fixed-step simulation. All of Coil's actions (steering, menu nav, pause, mute) are
// per-press, so held state is never needed. Arrow keys, space, and the letter keys the game
// uses are prevent-defaulted so the page never scrolls or scrubs while playing. The debug
// API injects keys as dispatched KeyboardEvents through this very listener, so injected
// input and a real keypress travel the same path (specs/instrumentation.md).

import type { Dir } from "./sim";

const CONSUMED = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Space",
  "Enter",
  "Escape",
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "KeyP",
  "KeyM",
  "Backquote",
]);

export class Input {
  private queue: string[] = [];
  private firstPressHandlers: Array<() => void> = [];
  private firstPressFired = false;

  attach(target: Window = window): void {
    target.addEventListener("keydown", (e) => {
      if (!this.firstPressFired) {
        this.firstPressFired = true;
        for (const fn of this.firstPressHandlers) fn();
      }
      if (e.repeat) return; // steering and menu nav are per-press, not auto-repeat
      if (CONSUMED.has(e.code)) e.preventDefault();
      this.queue.push(e.code);
    });
  }

  // Register a callback fired on the very first key press — used to resume the AudioContext,
  // which browsers block until a user gesture.
  onFirstPress(fn: () => void): void {
    this.firstPressHandlers.push(fn);
  }

  drain(): string[] {
    if (this.queue.length === 0) return [];
    const out = this.queue;
    this.queue = [];
    return out;
  }
}

// Steering codes → direction. Arrow keys and WASD are interchangeable (specs/ui.md).
const STEER: Record<string, Dir> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  KeyW: "up",
  KeyS: "down",
  KeyA: "left",
  KeyD: "right",
};

export function codeToDir(code: string): Dir | null {
  return STEER[code] ?? null;
}

// Semantic helpers over raw key codes (menu navigation).
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

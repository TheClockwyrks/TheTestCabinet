// Fathom — keyboard input: held movement state plus one-shot edge events.
// Keyboard only (specs/movement.md).

import { Dir } from "./types";

type Action =
  | "up"
  | "down"
  | "left"
  | "right"
  | "confirm"
  | "back"
  | "pause"
  | "mute"
  | "sonar"
  | "ink"
  | "debug";

const DIR_KEYS: Record<string, Dir> = {
  ArrowUp: Dir.Up,
  KeyW: Dir.Up,
  ArrowDown: Dir.Down,
  KeyS: Dir.Down,
  ArrowLeft: Dir.Left,
  KeyA: Dir.Left,
  ArrowRight: Dir.Right,
  KeyD: Dir.Right,
};

export class Input {
  private held = new Set<string>();
  // Stack of currently-held direction keys, newest last, so the desired
  // direction follows the most recently pressed key that is still down.
  private dirStack: Dir[] = [];
  private queue: Action[] = [];

  attach(): void {
    window.addEventListener("keydown", this.onDown);
    window.addEventListener("keyup", this.onUp);
    // Release everything if the window loses focus.
    window.addEventListener("blur", () => {
      this.held.clear();
      this.dirStack.length = 0;
    });
  }

  private onDown = (e: KeyboardEvent): void => {
    const code = e.code;
    if (
      code === "Space" ||
      code.startsWith("Arrow") ||
      code === "Tab"
    ) {
      e.preventDefault();
    }
    if (this.held.has(code)) return; // ignore auto-repeat
    this.held.add(code);

    const d = DIR_KEYS[code];
    if (d !== undefined) {
      this.dirStack.push(d);
      this.queue.push(
        d === Dir.Up
          ? "up"
          : d === Dir.Down
            ? "down"
            : d === Dir.Left
              ? "left"
              : "right",
      );
    }
    switch (code) {
      case "Enter":
      case "Space":
        this.queue.push("confirm");
        break;
      case "Escape":
        this.queue.push("back");
        this.queue.push("pause");
        break;
      case "KeyP":
        this.queue.push("pause");
        break;
      case "KeyM":
        this.queue.push("mute");
        break;
      case "Backquote":
        // Toggle the read-only debug overlay (specs/instrumentation.md).
        this.queue.push("debug");
        break;
    }
    if (code === "Space") this.queue.push("sonar");
    if (code === "ShiftLeft" || code === "ShiftRight") this.queue.push("ink");
  };

  private onUp = (e: KeyboardEvent): void => {
    this.held.delete(e.code);
    const d = DIR_KEYS[e.code];
    if (d !== undefined) {
      const i = this.dirStack.lastIndexOf(d);
      if (i >= 0) this.dirStack.splice(i, 1);
    }
  };

  // The current desired movement direction from held keys (newest wins).
  desiredDir(): Dir {
    return this.dirStack.length
      ? this.dirStack[this.dirStack.length - 1]
      : Dir.None;
  }

  // Drain the queued edge events. Call once per frame.
  drain(): Action[] {
    const q = this.queue;
    this.queue = [];
    return q;
  }
}

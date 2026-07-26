// Locomotivation — keyboard input (specs/controls.md).
//
// Translates the keyboard into a per-frame `SimInput` for the core sim (movement, sprint,
// pickup/interact, drop — edge-triggered where the sim expects a press) and into discrete
// menu actions for the state machine. Pointer control is never required.
//
// Bindings (also shown on the How-to-play screen and the README):
//   Move    W A S D / Arrow keys      Sprint  Shift (hold)
//   Pick up / Interact  E or Space     Drop    Q
//   Pause   Esc         Mute   M
//   Menus   Arrows / W S / A D, Enter or Space to confirm, Esc to go back.

import { noInput, type SimInput } from "./sim/world";

/** Discrete UI actions the menus consume (title, level-select, pause, results). */
export type MenuAction = "up" | "down" | "left" | "right" | "confirm" | "back" | "pause" | "mute";

const MOVE_LEFT = new Set(["a", "arrowleft"]);
const MOVE_RIGHT = new Set(["d", "arrowright"]);
const MOVE_UP = new Set(["w", "arrowup"]);
const MOVE_DOWN = new Set(["s", "arrowdown"]);
const SPRINT = new Set(["shift"]);
const PICKUP = new Set(["e", " ", "spacebar"]);
const DROP = new Set(["q"]);

/** Keys the game owns — preventDefault so the page never scrolls or steals them. */
const OWNED = new Set([
  "arrowleft",
  "arrowright",
  "arrowup",
  "arrowdown",
  " ",
  "spacebar",
  "w",
  "a",
  "s",
  "d",
  "e",
  "q",
  "m",
]);

function norm(e: KeyboardEvent): string {
  return e.key.toLowerCase();
}

function heldAny(set: Set<string>, keys: Set<string>): boolean {
  for (const k of keys) if (set.has(k)) return true;
  return false;
}

/**
 * Tracks held keys and edge presses and exposes them as sim input / menu actions.
 * `attach` binds the DOM listeners; `sample` is called once per fixed step (draining the
 * one-shot press edges), and `drainMenuActions` returns the queued menu actions.
 */
export class Input {
  private readonly held = new Set<string>();
  private pickupEdge = false;
  private dropEdge = false;
  private interactEdge = false;
  private readonly menuQueue: MenuAction[] = [];
  private onFirstInput: (() => void) | null = null;
  private firstFired = false;

  private readonly keydown = (e: KeyboardEvent): void => {
    const k = norm(e);
    if (OWNED.has(k) || k === " ") e.preventDefault();
    if (!this.firstFired) {
      this.firstFired = true;
      this.onFirstInput?.();
    }
    if (!e.repeat) {
      if (PICKUP.has(k)) {
        this.pickupEdge = true;
        this.interactEdge = true;
      }
      if (DROP.has(k)) this.dropEdge = true;
      this.queueMenu(k);
    }
    this.held.add(k);
  };

  private readonly keyup = (e: KeyboardEvent): void => {
    this.held.delete(norm(e));
  };

  private readonly blur = (): void => {
    this.held.clear();
  };

  private queueMenu(k: string): void {
    if (MOVE_UP.has(k)) this.menuQueue.push("up");
    else if (MOVE_DOWN.has(k)) this.menuQueue.push("down");
    else if (MOVE_LEFT.has(k)) this.menuQueue.push("left");
    else if (MOVE_RIGHT.has(k)) this.menuQueue.push("right");
    else if (k === "enter" || k === " " || k === "spacebar" || k === "e") this.menuQueue.push("confirm");
    else if (k === "escape") this.menuQueue.push("pause"); // the game maps pause↔back per screen
    else if (k === "m") this.menuQueue.push("mute");
  }

  /** Provide a callback fired on the very first key press (to resume audio on a gesture). */
  setFirstInputHandler(cb: () => void): void {
    this.onFirstInput = cb;
  }

  /** Bind keydown/keyup on the target (usually `window`). */
  attach(target: Window): void {
    target.addEventListener("keydown", this.keydown);
    target.addEventListener("keyup", this.keyup);
    target.addEventListener("blur", this.blur);
  }

  /** Remove the DOM listeners. */
  detach(): void {
    window.removeEventListener("keydown", this.keydown);
    window.removeEventListener("keyup", this.keyup);
    window.removeEventListener("blur", this.blur);
  }

  /** The movement/action intent for the current step (WASD/arrows, Shift, E/Space, Q). */
  sample(): SimInput {
    const out: SimInput = {
      left: heldAny(this.held, MOVE_LEFT),
      right: heldAny(this.held, MOVE_RIGHT),
      up: heldAny(this.held, MOVE_UP),
      down: heldAny(this.held, MOVE_DOWN),
      sprint: heldAny(this.held, SPRINT),
      pickup: this.pickupEdge,
      drop: this.dropEdge,
      interact: this.interactEdge,
    };
    this.pickupEdge = false;
    this.dropEdge = false;
    this.interactEdge = false;
    return out;
  }

  /** A neutral sample that still clears the pending press edges (used off the playfield). */
  sampleNeutral(): SimInput {
    this.pickupEdge = false;
    this.dropEdge = false;
    this.interactEdge = false;
    return noInput();
  }

  /** Drain the queued menu actions since the last call. */
  drainMenuActions(): MenuAction[] {
    const out = this.menuQueue.slice();
    this.menuQueue.length = 0;
    return out;
  }
}

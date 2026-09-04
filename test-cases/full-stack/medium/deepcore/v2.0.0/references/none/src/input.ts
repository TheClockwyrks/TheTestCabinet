// Deepcore — the keyboard and the contacts (specs/controls.md).
//
// Keys are read as `KeyboardEvent.code`, so the bindings are layout-independent.
// Movement, thrust, and drilling are held, so the loop reads the live held set every
// update; the rest are edge actions, drained once a frame.
//
// Contacts are read as pointer events, which is what makes "a mouse and a finger on a
// touch screen both reach the game as contacts on that same report" true without two
// code paths. A choice carries BOTH of its edges — the press and its release, or the
// landing and the lift — because the routing layer only acts where the two land in one
// region.

import { ACTIONS } from "./constants";
import type { Action } from "./constants";
import type { MoveInput } from "./physics";

/** The actions bound to a key code, built once from the binding table. */
const BY_CODE = new Map<string, Action[]>();
for (const action of Object.keys(ACTIONS) as Action[]) {
  for (const code of ACTIONS[action]) {
    const list = BY_CODE.get(code) ?? [];
    list.push(action);
    BY_CODE.set(code, list);
  }
}

/** Which actions a key code drives. */
export function actionsForCode(code: string): readonly Action[] {
  return BY_CODE.get(code) ?? [];
}

export class Input {
  clientX = -1;
  clientY = -1;
  private scale = 1;
  private offX = 0;
  private offY = 0;

  private down = new Set<string>();
  /** Key codes that went down this frame, in order. */
  codes: string[] = [];
  /** Completed contacts this frame, both edges, in the stage's logical units. */
  choices: { from: { x: number; y: number }; to: { x: number; y: number } }[] =
    [];
  /** Where the contact currently down went down, or null while none is. */
  private pressedAt: { x: number; y: number } | null = null;

  attach(canvas: HTMLCanvasElement): void {
    // A finger must drive the game rather than scroll the page under it.
    canvas.style.touchAction = "none";
    canvas.addEventListener("pointermove", (e) => {
      this.clientX = e.clientX;
      this.clientY = e.clientY;
    });
    canvas.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      this.clientX = e.clientX;
      this.clientY = e.clientY;
      this.pressedAt = this.toLogical(e.clientX, e.clientY);
    });
    canvas.addEventListener("pointerup", (e) => {
      const from = this.pressedAt;
      this.pressedAt = null;
      if (from === null) return;
      this.clientX = e.clientX;
      this.clientY = e.clientY;
      this.choices.push({ from, to: this.toLogical(e.clientX, e.clientY) });
    });
    canvas.addEventListener("pointercancel", () => {
      this.pressedAt = null;
    });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("keydown", (e) => this.onKeyDown(e));
    window.addEventListener("keyup", (e) => this.down.delete(e.code));
    // A key must not stick down when the page loses focus.
    window.addEventListener("blur", () => this.down.clear());
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (BY_CODE.has(e.code) || e.code === "Space") e.preventDefault();
    if (!e.repeat) this.codes.push(e.code);
    this.down.add(e.code);
  }

  setViewport(scale: number, offX: number, offY: number): void {
    this.scale = scale;
    this.offX = offX;
    this.offY = offY;
  }

  toLogical(clientX: number, clientY: number): { x: number; y: number } {
    return {
      x: (clientX - this.offX) / this.scale,
      y: (clientY - this.offY) / this.scale,
    };
  }

  get pointer(): { x: number; y: number } {
    return this.toLogical(this.clientX, this.clientY);
  }

  /** Whether an action is held right now. */
  isHeld(action: Action): boolean {
    for (const code of ACTIONS[action]) if (this.down.has(code)) return true;
    return false;
  }

  /** The held actions movement reads. */
  held(): MoveInput {
    return {
      left: this.isHeld("left"),
      right: this.isHeld("right"),
      down: this.isHeld("down"),
      thrust: this.isHeld("up"),
    };
  }

  /** Drop this frame's edge keys and completed contacts. */
  drain(): void {
    this.codes.length = 0;
    this.choices.length = 0;
  }

  /** Let every held key up, which a reset does. */
  releaseAll(): void {
    this.down.clear();
  }
}

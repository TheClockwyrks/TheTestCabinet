// Deepcore — the keyboard and the mouse (specs/controls.md).
//
// Keys are read as `KeyboardEvent.code`, so the bindings are layout-independent.
// Movement, thrust, and drilling are held, so the loop reads the live held set every
// update; the rest are edge actions, drained once a frame. The pointer is collected in
// client pixels and mapped into the stage's logical units by the loop.

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
  /** Clicks this frame, in the stage's logical units. */
  clicks: { x: number; y: number }[] = [];

  attach(canvas: HTMLCanvasElement): void {
    canvas.addEventListener("mousemove", (e) => {
      this.clientX = e.clientX;
      this.clientY = e.clientY;
    });
    canvas.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      this.clicks.push(this.toLogical(e.clientX, e.clientY));
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

  /** Drop this frame's edge keys and clicks. */
  drain(): void {
    this.codes.length = 0;
    this.clicks.length = 0;
  }

  /** Let every held key up, which a reset does. */
  releaseAll(): void {
    this.down.clear();
  }
}

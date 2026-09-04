// Wick — the keyboard beneath the actions, and the pointer beside it
// (specs/controls.md).
//
// Keys are bound by `KeyboardEvent.code`, so a binding is a physical key
// whatever the layout. Each action is reported two ways: as a held value, `1`
// while any of its keys is down, and as a press edge, true once for the frame
// in which the held value went from `0` to `1`. A key event whose `repeat`
// flag is set arms no edge. `Backquote` belongs to the debug overlay rather
// than to the action registry, so it is counted apart.
//
// The pointer is gathered the same way: the listeners sit on the canvas and
// keep each event's client position, and a frame reads where the pointer
// rests, the primary presses since its last read, and the wheel travel since
// then, all mapped into stage units through the fit the frame draws under.

import {
  ACTIONS,
  BINDINGS,
  OVERLAY_TOGGLE_CODE,
  type Action,
} from "./constants";
import type { Held } from "./sim/context";
import type { StagePoint } from "./viewport";

/** The action each bound code fires. */
const CODE_TO_ACTION: ReadonlyMap<string, Action> = (() => {
  const map = new Map<string, Action>();
  for (const action of ACTIONS) {
    for (const code of BINDINGS[action]) map.set(code, action);
  }
  return map;
})();

export class Keyboard {
  /** The bound codes currently down. */
  private readonly down = new Set<string>();
  /** Actions whose edge has armed since the last drain. */
  private readonly edges = new Set<Action>();
  private overlayToggles = 0;
  private firstPress: (() => void) | null = null;
  private pressed = false;
  private detach: (() => void) | null = null;

  /** Start listening on `target`. */
  attach(target: EventTarget): void {
    const onKeyDown = (event: Event): void => {
      const key = event as KeyboardEvent;
      if (this.keyDown(key.code, key.repeat)) key.preventDefault();
    };
    const onKeyUp = (event: Event): void => {
      this.keyUp((event as KeyboardEvent).code);
    };
    const onBlur = (): void => this.releaseAll();
    target.addEventListener("keydown", onKeyDown);
    target.addEventListener("keyup", onKeyUp);
    target.addEventListener("blur", onBlur);
    this.detach = () => {
      target.removeEventListener("keydown", onKeyDown);
      target.removeEventListener("keyup", onKeyUp);
      target.removeEventListener("blur", onBlur);
    };
  }

  /** Stop listening. */
  release(): void {
    this.detach?.();
    this.detach = null;
  }

  /** Run `handler` on the very first key press, the gesture audio waits for. */
  onFirstPress(handler: () => void): void {
    this.firstPress = handler;
  }

  /** `1` while any of `action`'s keys is down, else `0`. */
  held(action: Action): number {
    return BINDINGS[action].some((code) => this.down.has(code)) ? 1 : 0;
  }

  /** The four movement actions as held values. */
  movement(): Held {
    return {
      up: this.held("up"),
      down: this.held("down"),
      left: this.held("left"),
      right: this.held("right"),
    };
  }

  /**
   * The press edges armed since the last call, in `ACTIONS` order, at most
   * one per action.
   */
  drainEdges(): Action[] {
    if (this.edges.size === 0) return [];
    const out = ACTIONS.filter((action) => this.edges.has(action));
    this.edges.clear();
    return out;
  }

  /** How many times the overlay key was pressed since the last call. */
  drainOverlayToggles(): number {
    const count = this.overlayToggles;
    this.overlayToggles = 0;
    return count;
  }

  /**
   * One key down. Returns whether the key belongs to the game, so the
   * listener can keep the page from scrolling under it.
   */
  keyDown(code: string, repeat: boolean): boolean {
    if (!this.pressed) {
      this.pressed = true;
      this.firstPress?.();
    }
    if (code === OVERLAY_TOGGLE_CODE) {
      if (!repeat) this.overlayToggles += 1;
      return true;
    }
    const action = CODE_TO_ACTION.get(code);
    if (action === undefined) return false;
    const wasHeld = this.held(action) === 1;
    this.down.add(code);
    if (!repeat && !wasHeld) this.edges.add(action);
    return true;
  }

  /** One key up. */
  keyUp(code: string): void {
    this.down.delete(code);
  }

  /** Forget every held key, as when the window loses focus mid-hold. */
  releaseAll(): void {
    this.down.clear();
  }
}

/** How a client position and a client travel reach the stage on one frame. */
export interface StageMapping {
  point(clientX: number, clientY: number): StagePoint;
  travel(delta: number): number;
}

/** What the pointer did over one frame, in stage units. */
export interface PointerFrame {
  /** Where the pointer rests, or `null` while it is off the canvas. */
  at: StagePoint | null;
  /** The points of the primary presses since the last read, in order. */
  presses: StagePoint[];
  /** Vertical wheel travel since the last read, downward positive. */
  wheel: number;
}

/** A position in the page's own client CSS pixels. */
interface ClientPoint {
  x: number;
  y: number;
}

/** The button a primary press carries. */
const PRIMARY_BUTTON = 0;

export class Pointer {
  /** Where the pointer rests, in client CSS pixels, or `null` while it is off. */
  private at: ClientPoint | null = null;
  /** The client positions of the primary presses since the last read. */
  private readonly presses: ClientPoint[] = [];
  private travel = 0;
  private detach: (() => void) | null = null;

  /** Start listening on `target`, which is the canvas the stage is drawn on. */
  attach(target: EventTarget): void {
    const onMove = (event: Event): void => {
      const pointer = event as PointerEvent;
      this.moveTo(pointer.clientX, pointer.clientY);
    };
    const onDown = (event: Event): void => {
      const pointer = event as PointerEvent;
      this.moveTo(pointer.clientX, pointer.clientY);
      if (pointer.button === PRIMARY_BUTTON) {
        this.pressAt(pointer.clientX, pointer.clientY);
      }
    };
    const onLeave = (): void => this.leave();
    const onWheel = (event: Event): void => {
      const wheel = event as WheelEvent;
      this.roll(wheel.deltaY);
      wheel.preventDefault();
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerdown", onDown);
    target.addEventListener("pointerleave", onLeave);
    target.addEventListener("wheel", onWheel, { passive: false });
    this.detach = () => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerdown", onDown);
      target.removeEventListener("pointerleave", onLeave);
      target.removeEventListener("wheel", onWheel);
    };
  }

  /** Stop listening. */
  release(): void {
    this.detach?.();
    this.detach = null;
  }

  /** The pointer rests at a client position. */
  moveTo(clientX: number, clientY: number): void {
    this.at = { x: clientX, y: clientY };
  }

  /** One primary press at a client position. */
  pressAt(clientX: number, clientY: number): void {
    this.presses.push({ x: clientX, y: clientY });
  }

  /** The pointer has left the canvas, so it rests on nothing. */
  leave(): void {
    this.at = null;
  }

  /** One wheel event's vertical travel, in client CSS pixels. */
  roll(delta: number): void {
    this.travel += delta;
  }

  /** Everything since the last read, in the stage units `mapping` gives. */
  drain(mapping: StageMapping): PointerFrame {
    const frame: PointerFrame = {
      at: this.at === null ? null : mapping.point(this.at.x, this.at.y),
      presses: this.presses.map((press) => mapping.point(press.x, press.y)),
      wheel: mapping.travel(this.travel),
    };
    this.presses.length = 0;
    this.travel = 0;
    return frame;
  }
}

// Wick — the keyboard beneath the actions (specs/controls.md).
//
// Keys are bound by `KeyboardEvent.code`, so a binding is a physical key
// whatever the layout. Each action is reported two ways: as a held value, `1`
// while any of its keys is down, and as a press edge, true once for the frame
// in which the held value went from `0` to `1`. A key event whose `repeat`
// flag is set arms no edge. `Backquote` belongs to the debug overlay rather
// than to the action registry, so it is counted apart.

import {
  ACTIONS,
  BINDINGS,
  OVERLAY_TOGGLE_CODE,
  type Action,
} from "./constants";
import type { Held } from "./sim/context";

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

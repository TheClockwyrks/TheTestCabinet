// Kessler — the keyboard beneath the actions (specs/controls.md).
//
// The game stands on no engine, so the keyboard belongs to this runtime
// layer. Keys are bound by `KeyboardEvent.code`, and each action is reported
// two ways: as a held value, true while any of its keys is down, and as a
// press edge, true once for the frame in which the held value became true. A
// key event whose `repeat` flag is set arms no edge, and a dispatched
// keyboard event travels exactly the path a player's key does, because there
// is only one path. `Backquote` is not an action: it belongs to the debug
// overlay, a layer of the runtime rather than of the game, so it is counted
// separately.

import {
  ACTIONS,
  BINDINGS,
  OVERLAY_TOGGLE_CODE,
  type Action,
} from "./constants";

/** Every action each bound code fires. `Space` carries two. */
const CODE_TO_ACTIONS: ReadonlyMap<string, readonly Action[]> = (() => {
  const map = new Map<string, Action[]>();
  for (const action of ACTIONS) {
    for (const code of BINDINGS[action]) {
      const list = map.get(code) ?? [];
      list.push(action);
      map.set(code, list);
    }
  }
  return map;
})();

export class Keyboard {
  /** The bound codes currently down. */
  private readonly down = new Set<string>();
  /** Actions whose edge has armed since the last drain, in `ACTIONS` order. */
  private readonly edges = new Set<Action>();
  private overlayToggles = 0;
  private firstPress: (() => void) | null = null;
  private pressed = false;
  private detach: (() => void) | null = null;

  /** Start listening on `target`. */
  attach(target: EventTarget = window): void {
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

  /**
   * Run `handler` on the very first key press, the gesture browsers wait for
   * before they let a page make a sound.
   */
  onFirstPress(handler: () => void): void {
    this.firstPress = handler;
  }

  /** Whether any of `action`'s keys is down right now. */
  held(action: Action): boolean {
    return BINDINGS[action].some((code) => this.down.has(code));
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
   * listener knows to swallow it before the page scrolls under it.
   */
  keyDown(code: string, repeat: boolean): boolean {
    if (!this.pressed) {
      this.pressed = true;
      this.firstPress?.();
    }
    if (code === OVERLAY_TOGGLE_CODE) {
      // Auto-repeat must not flutter the overlay.
      if (!repeat) this.overlayToggles += 1;
      return true;
    }
    const actions = CODE_TO_ACTIONS.get(code);
    if (actions === undefined) return false;
    this.down.add(code);
    // A repeat is not a press: no edge arms while the key stays held.
    if (!repeat) {
      for (const action of actions) this.edges.add(action);
    }
    return true;
  }

  /** One key up. */
  keyUp(code: string): void {
    this.down.delete(code);
  }

  /** Forget every held key — the window lost focus mid-hold. */
  releaseAll(): void {
    this.down.clear();
  }
}

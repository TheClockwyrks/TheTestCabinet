// Orrery — the keyboard beneath the actions (specs/controls.md).
//
// The game stands on no engine, so the keyboard belongs to this runtime layer.
// The game never sees a `KeyboardEvent`: it declares NAMED ACTIONS bound to
// `KeyboardEvent.code` values — physical keys, so a binding survives a
// non-QWERTY layout — and asks one question per frame, "did this action go
// down?".
//
// Every action Orrery has is read as a press edge, once per press
// (specs/controls.md), so held state is tracked only to tell a fresh press
// from a key still down and an OS auto-repeat arms nothing. An edge is armed
// when the action leaves rest, CONSUMED by the first `pressed` that sees it,
// and discarded at the end of the frame it was armed in, so one press is never
// acted on twice and a press nothing read never surfaces later out of order.
//
// One code may drive several actions: `KeyW` carries both `part-grow` and
// `ins-extend`, and `KeyS` both `part-shrink` and `ins-retract`. Each is
// registered on its own and the editor reads the one the current focus names
// (specs/controls.md "Focus"), so the binding is a many-to-many index.
//
// `Backquote` is not an action. It shows and hides the debug overlay, which is
// a layer of the runtime rather than of the game, so it is counted separately.

import {
  ACTIONS,
  BINDINGS,
  OVERLAY_TOGGLE_CODE,
  type Action,
} from "./constants";

/** The mutable state behind one registered action. */
interface ActionState {
  /** The bound codes currently down; held until the last one comes up. */
  readonly held: Set<string>;
  /** An armed edge, waiting to be consumed or dropped at the frame's end. */
  edge: boolean;
}

/**
 * Narrows an `Event` to a keyboard-shaped event structurally rather than with
 * `instanceof`, so an event dispatched from another realm — which is what a
 * test and a browser automation driver both dispatch — still reaches an
 * action.
 */
export function asKeyboardEvent(
  event: Event,
): { code: string; repeat: boolean } | null {
  const candidate = event as Partial<KeyboardEvent>;
  if (typeof candidate.code !== "string") return null;
  return { code: candidate.code, repeat: candidate.repeat === true };
}

/** Every action each bound code fires, built once from `BINDINGS`. */
const CODE_TO_ACTIONS: ReadonlyMap<string, readonly Action[]> = (() => {
  const index = new Map<string, Action[]>();
  for (const action of ACTIONS) {
    for (const code of BINDINGS[action]) {
      const list = index.get(code);
      if (list === undefined) index.set(code, [action]);
      else list.push(action);
    }
  }
  return index;
})();

/** The registry: the single answer to "did the player press this action?". */
export class Keyboard {
  private readonly target: EventTarget;
  private readonly actions = new Map<Action, ActionState>();
  /** Presses of the overlay key since the last drain. */
  private overlayToggles = 0;
  /** Run once, on the first key press: the gesture audio waits for. */
  private firstPress: (() => void) | null = null;
  private hasPressed = false;
  private detached = false;

  private readonly onKeyDown = (event: Event): void => {
    const key = asKeyboardEvent(event);
    if (key === null) return;
    if (!this.hasPressed) {
      this.hasPressed = true;
      this.firstPress?.();
    }
    if (key.code === OVERLAY_TOGGLE_CODE) {
      // An auto-repeat must not flutter the overlay.
      if (!key.repeat) this.overlayToggles += 1;
      return;
    }
    for (const name of CODE_TO_ACTIONS.get(key.code) ?? []) {
      const action = this.stateOf(name);
      const wasHeld = action.held.size > 0;
      action.held.add(key.code);
      // A repeat is not a press: no edge arms while the key stays held.
      if (!wasHeld && !key.repeat) action.edge = true;
    }
  };

  private readonly onKeyUp = (event: Event): void => {
    const key = asKeyboardEvent(event);
    if (key === null) return;
    for (const name of CODE_TO_ACTIONS.get(key.code) ?? []) {
      this.stateOf(name).held.delete(key.code);
    }
  };

  private readonly onBlur = (): void => {
    for (const action of this.actions.values()) action.held.clear();
  };

  constructor(target: EventTarget) {
    this.target = target;
    for (const action of ACTIONS) {
      this.actions.set(action, { held: new Set(), edge: false });
    }
    this.target.addEventListener("keydown", this.onKeyDown);
    this.target.addEventListener("keyup", this.onKeyUp);
    this.target.addEventListener("blur", this.onBlur);
  }

  /** Run `handler` on the very first key press. */
  onFirstPress(handler: () => void): void {
    this.firstPress = handler;
  }

  /** Whether any of the action's keys is down right now. */
  held(action: Action): boolean {
    return this.stateOf(action).held.size > 0;
  }

  /** Whether the action went down since the last frame. Consumes the edge. */
  pressed(action: Action): boolean {
    const state = this.stateOf(action);
    if (!state.edge) return false;
    state.edge = false;
    return true;
  }

  /** The actions armed right now, in `ACTIONS` order, without consuming them. */
  armed(): Action[] {
    return ACTIONS.filter((action) => this.stateOf(action).edge);
  }

  /** How many times the overlay key was pressed since the last call. */
  drainOverlayToggles(): number {
    const count = this.overlayToggles;
    this.overlayToggles = 0;
    return count;
  }

  /** Discard every edge nothing consumed: a press is news for one frame only. */
  endFrame(): void {
    for (const action of this.actions.values()) action.edge = false;
  }

  /** Drop the listeners. Idempotent, because teardown races. */
  detach(): void {
    if (this.detached) return;
    this.detached = true;
    this.target.removeEventListener("keydown", this.onKeyDown);
    this.target.removeEventListener("keyup", this.onKeyUp);
    this.target.removeEventListener("blur", this.onBlur);
  }

  private stateOf(action: Action): ActionState {
    const state = this.actions.get(action);
    if (state === undefined) {
      const created: ActionState = { held: new Set(), edge: false };
      this.actions.set(action, created);
      return created;
    }
    return state;
  }
}

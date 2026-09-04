// Coil — the actions the game is driven with, and the keyboard beneath them
// (specs/controls.md).
//
// The game stands on no engine, so the keyboard is part of the runtime layer this
// build writes. What the game reads is one press edge per action per frame: a
// keydown is mapped through `BINDINGS` to the action it fires and collected into a
// set, the loop drains that set once a frame, and holding a key raises nothing
// beyond the press that began it. A dispatched keyboard event travels the same path
// a player's key does, because there is only one path.
//
// `Backquote` is not an action. It belongs to the diagnostics overlay, which is a
// layer of the runtime rather than part of the game, so it is reported separately.

import type { Action } from "./game";

/** The actions the game registers. */
export const ACTIONS: readonly Action[] = [
  "up",
  "down",
  "left",
  "right",
  "confirm",
  "back",
  "pause",
  "mute",
];

/** The keys bound to each action, named by `KeyboardEvent.code`. */
export const BINDINGS: Record<Action, readonly string[]> = {
  up: ["ArrowUp", "KeyW"],
  down: ["ArrowDown", "KeyS"],
  left: ["ArrowLeft", "KeyA"],
  right: ["ArrowRight", "KeyD"],
  confirm: ["Enter", "Space"],
  back: ["Escape"],
  pause: ["KeyP"],
  mute: ["KeyM"],
};

/** The key that shows and hides the diagnostics overlay. */
export const OVERLAY_KEY = "Backquote";

const CODE_TO_ACTION: ReadonlyMap<string, Action> = new Map(
  ACTIONS.flatMap((action) =>
    BINDINGS[action].map((code) => [code, action] as const),
  ),
);

/** The action `code` fires, or `null` when no action is bound to it. */
export function actionForCode(code: string): Action | null {
  return CODE_TO_ACTION.get(code) ?? null;
}

export class Keyboard {
  /** Actions raised since the last drain, in the order they were first raised. */
  private readonly edges = new Set<Action>();
  private overlayToggles = 0;
  private firstPress: (() => void) | null = null;
  private pressed = false;
  private detach: (() => void) | null = null;

  /** Start listening. The listener is the one path both real and driven keys take. */
  attach(target: EventTarget = window): void {
    const onKeyDown = (event: Event): void =>
      this.onKeyDown(event as KeyboardEvent);
    target.addEventListener("keydown", onKeyDown);
    this.detach = () => target.removeEventListener("keydown", onKeyDown);
  }

  /** Stop listening. */
  release(): void {
    this.detach?.();
    this.detach = null;
  }

  /**
   * Run `handler` on the very first key press of the session, which is the gesture
   * browsers wait for before they will let a page make a sound.
   */
  onFirstPress(handler: () => void): void {
    this.firstPress = handler;
  }

  /** The actions raised since the last call, at most one edge per action. */
  drain(): Action[] {
    if (this.edges.size === 0) return [];
    const out = [...this.edges];
    this.edges.clear();
    return out;
  }

  /** How many times the overlay key has been pressed since the last call. */
  drainOverlayToggles(): number {
    const count = this.overlayToggles;
    this.overlayToggles = 0;
    return count;
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (!this.pressed) {
      this.pressed = true;
      this.firstPress?.();
    }
    // Auto-repeat is not a press: no action repeats while its key is held.
    if (event.repeat) return;
    if (event.code === OVERLAY_KEY) {
      this.overlayToggles += 1;
      event.preventDefault();
      return;
    }
    const action = actionForCode(event.code);
    if (action === null) return;
    // The page never scrolls or scrubs under a key the game answers.
    event.preventDefault();
    this.edges.add(action);
  }
}

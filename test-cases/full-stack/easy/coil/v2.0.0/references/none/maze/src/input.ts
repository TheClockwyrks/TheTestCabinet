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

/** One pointer edge the loop has yet to read, in the page's own CSS pixels. */
export interface PointerEdge {
  /** What the pointer did. */
  kind: "move" | "down" | "up";
  /** Where it did it, in CSS pixels from the top-left of the viewport. */
  clientX: number;
  clientY: number;
}

/**
 * The pointer and the touch contact the menus are driven with (specs/ui.md).
 *
 * One listener serves both. A browser raises pointer events for a mouse and for a
 * finger alike, and the menus want the same thing from either, so what separates
 * them never has to be read. Edges are collected as they arrive and drained once a
 * frame, which is the read `specs/ui.md` states, and their positions are the
 * page's rather than the stage's: converting one into a logical point needs the
 * fit the frame drew under, which is the frame loop's to know.
 */
export class Pointer {
  private readonly edges: PointerEdge[] = [];
  private firstContact: (() => void) | null = null;
  private contacted = false;
  private detach: (() => void) | null = null;

  /** Start listening. The listener is the one path a real and a driven edge take. */
  attach(target: EventTarget = window): void {
    const listen =
      (kind: PointerEdge["kind"]) =>
      (event: Event): void => {
        const pointer = event as PointerEvent;
        if (kind === "down" && !this.contacted) {
          this.contacted = true;
          this.firstContact?.();
        }
        this.edges.push({
          kind,
          clientX: pointer.clientX,
          clientY: pointer.clientY,
        });
      };
    const onMove = listen("move");
    const onDown = listen("down");
    const onUp = listen("up");
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerdown", onDown);
    target.addEventListener("pointerup", onUp);
    this.detach = (): void => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerdown", onDown);
      target.removeEventListener("pointerup", onUp);
    };
  }

  /** Stop listening. */
  release(): void {
    this.detach?.();
    this.detach = null;
  }

  /**
   * Run `handler` on the first press of the session, which is one of the gestures
   * browsers wait for before they will let a page make a sound.
   */
  onFirstContact(handler: () => void): void {
    this.firstContact = handler;
  }

  /** The edges raised since the last call, oldest first. */
  drain(): PointerEdge[] {
    if (this.edges.length === 0) return [];
    return this.edges.splice(0, this.edges.length);
  }
}

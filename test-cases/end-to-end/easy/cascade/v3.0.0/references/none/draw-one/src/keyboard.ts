// Cascade — the keyboard, which this game uses for exactly one thing.
//
// Cascade is played with a pointer (`specs/controls.md`), so there are no key
// bindings and no named actions here. The one key the build listens for is the
// backtick that shows and hides the debug overlay, and that key is runtime
// chrome rather than a move in the game: it changes no game state, so it never
// reaches `update`.
//
// This module is therefore small on purpose. It narrows an `Event` to a
// keyboard-shaped one, and it holds the wiring that calls a handler when a
// named `KeyboardEvent.code` goes down.

/**
 * Narrows an `Event` to a `KeyboardEvent` structurally rather than with
 * `instanceof`, so an event dispatched from another realm — or a plain `Event`
 * carrying a `code`, which is what a test and a browser automation driver both
 * dispatch — still reaches the handler.
 */
export function asKeyboardEvent(event: Event): KeyboardEvent | null {
  const candidate = event as Partial<KeyboardEvent>;
  return typeof candidate.code === "string" ? (event as KeyboardEvent) : null;
}

/** A watcher over one `KeyboardEvent.code`, calling back on each press. */
export class KeyWatcher {
  private readonly target: EventTarget;
  private readonly code: string;
  private readonly handler: () => void;
  private readonly listener: (event: Event) => void;
  private detached = false;

  constructor(target: EventTarget, code: string, handler: () => void) {
    this.target = target;
    this.code = code;
    this.handler = handler;
    this.listener = (event: Event): void => {
      const key = asKeyboardEvent(event);
      // An OS auto-repeat is not a new press: the key never came up.
      if (key === null || key.repeat || key.code !== this.code) return;
      this.handler();
    };
    this.target.addEventListener("keydown", this.listener);
  }

  /** Drop the listener. Idempotent, because teardown races. */
  detach(): void {
    if (this.detached) return;
    this.detached = true;
    this.target.removeEventListener("keydown", this.listener);
  }
}

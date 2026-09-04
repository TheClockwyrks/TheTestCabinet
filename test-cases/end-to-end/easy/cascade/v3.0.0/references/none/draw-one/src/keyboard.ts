// Cascade — the keyboard the runtime layer reads.
//
// Two things reach the game through a key. The backtick shows and hides the
// debug overlay, which is runtime chrome rather than a move in the game — it
// changes no game state, so it never reaches `update` ({@link KeyWatcher}). The
// four MENU ACTIONS `specs/controls.md` names do change the game, so they are
// latched as press EDGES and handed to the update that follows
// ({@link MenuKeys}).
//
// AN EDGE, NOT A HELD KEY. `specs/controls.md`: "Each is read once per frame as
// a press edge, so holding a key moves the selection one step rather than
// repeating it." So an OS auto-repeat is dropped, a key held across many frames
// raises one edge, and the edges a frame collected are consumed by that frame.

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

/** The four actions `specs/controls.md` gives the keyboard over a menu. */
export type MenuAction = "menu-up" | "menu-down" | "menu-confirm" | "menu-back";

/** Which action a `KeyboardEvent.code` raises, or `null` for every other key. */
export type MenuBindings = Readonly<Record<MenuAction, readonly string[]>>;

/**
 * The menu-action press edges a frame collected, in arrival order.
 *
 * The pointer's shape ({@link ../pointer}), for the same reason: an event
 * arrives whenever the browser delivers it, and a frame answers the edges that
 * arrived before it. `endFrame` discards whatever the frame did not consume, so
 * one bad frame cannot leave an edge to surface later, out of order.
 */
export class MenuKeys {
  private readonly target: EventTarget;
  private readonly bindings: MenuBindings;
  private readonly listener: (event: Event) => void;
  private pending: MenuAction[] = [];
  private detached = false;

  constructor(target: EventTarget, bindings: MenuBindings) {
    this.target = target;
    this.bindings = bindings;
    this.listener = (event: Event): void => {
      const key = asKeyboardEvent(event);
      // An OS auto-repeat is not a new press: the key never came up.
      if (key === null || key.repeat) return;
      const action = this.actionFor(key.code);
      if (action !== null) this.pending.push(action);
    };
    this.target.addEventListener("keydown", this.listener);
  }

  /** The action a code raises, or `null`. */
  private actionFor(code: string): MenuAction | null {
    for (const action of Object.keys(this.bindings) as MenuAction[]) {
      if (this.bindings[action].includes(code)) return action;
    }
    return null;
  }

  /** This frame's edges, in arrival order. Consumes them. */
  edges(): MenuAction[] {
    const taken = this.pending;
    this.pending = [];
    return taken;
  }

  /** Drop whatever the frame did not consume. */
  endFrame(): void {
    this.pending = [];
  }

  /** Drop the listener. Idempotent, because teardown races. */
  detach(): void {
    if (this.detached) return;
    this.detached = true;
    this.target.removeEventListener("keydown", this.listener);
  }
}

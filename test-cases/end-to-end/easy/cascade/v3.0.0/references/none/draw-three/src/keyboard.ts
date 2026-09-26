// Cascade — the keyboard the runtime layer reads.
//
// Two things reach the game through a key. The backtick shows and hides the
// debug overlay, which belongs to the runtime rather than to the game
// (specs/instrumentation.md); the four MENU ACTIONS specs/controls.md names do
// change the game, so they are latched as press EDGES and handed to the update
// that follows.
//
// AN EDGE, NOT A HELD KEY. specs/controls.md: "Each is read once per frame as a
// press edge, so holding a key moves the selection one step rather than
// repeating it." An OS auto-repeat is dropped by {@link asKeyboardEvent}, so a
// key held across many frames raises one edge, and the edges a frame collected
// are consumed by that frame.

/** The part of a `KeyboardEvent` this build reads. */
export interface KeyLike {
  /** The physical key, as `KeyboardEvent.code`. */
  readonly code: string;
  /** Whether the event came from auto-repeat rather than a fresh press. */
  readonly repeat?: boolean;
}

/**
 * An event as a key this build answers, or `null` when it is not one.
 *
 * An auto-repeat is dropped: a held backtick would otherwise flicker the panel
 * on and off many times a second.
 */
export function asKeyboardEvent(event: Event): KeyLike | null {
  const candidate = event as unknown as Partial<KeyLike>;
  if (typeof candidate.code !== "string") return null;
  if (candidate.repeat === true) return null;
  return candidate as KeyLike;
}

/** A watch over a set of `KeyboardEvent.code` values. */
export class KeyWatcher {
  private readonly handlers = new Map<string, () => void>();

  /** Answer `code` with `handler`. Re-registering a code replaces it. */
  on(code: string, handler: () => void): void {
    this.handlers.set(code, handler);
  }

  /** Whether any code is watched. */
  get size(): number {
    return this.handlers.size;
  }

  /**
   * Deliver one event, and report whether it was answered.
   *
   * A handler that throws is not allowed to escape into the DOM listener that
   * called it, because a broken panel toggle must not take the page's event
   * dispatch down with it.
   */
  handle(event: Event): boolean {
    const key = asKeyboardEvent(event);
    if (key === null) return false;
    const handler = this.handlers.get(key.code);
    if (handler === undefined) return false;
    try {
      handler();
    } catch {
      // A key handler cannot fail the page.
    }
    return true;
  }
}

/** The four actions specs/controls.md gives the keyboard over a menu. */
export type MenuAction = "menu-up" | "menu-down" | "menu-confirm" | "menu-back";

/** Which `KeyboardEvent.code`s raise each action. */
export type MenuBindings = Readonly<Record<MenuAction, readonly string[]>>;

/**
 * The menu-action press edges a frame collected, in arrival order.
 *
 * `take` consumes them, and `clear` discards whatever the frame did not, so one
 * bad frame cannot leave an edge to surface later, out of order.
 */
export class MenuEdges {
  private readonly bindings: MenuBindings;
  private pending: MenuAction[] = [];

  constructor(bindings: MenuBindings) {
    this.bindings = bindings;
  }

  /** Record the edge a key raises, and report whether it raised one. */
  handle(event: Event): boolean {
    const key = asKeyboardEvent(event);
    if (key === null) return false;
    for (const action of Object.keys(this.bindings) as MenuAction[]) {
      if (this.bindings[action].includes(key.code)) {
        this.pending.push(action);
        return true;
      }
    }
    return false;
  }

  /** This frame's edges, in arrival order. Consumes them. */
  take(): MenuAction[] {
    const taken = this.pending;
    this.pending = [];
    return taken;
  }

  /** Drop whatever the frame did not consume. */
  clear(): void {
    this.pending = [];
  }
}

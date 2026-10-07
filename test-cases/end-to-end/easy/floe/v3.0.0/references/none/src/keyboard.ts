// Floe — the keyboard, beneath the game.
//
// `specs/controls.md` binds physical keys, read as `KeyboardEvent.code` so a
// binding is the same key on every layout, and `specs/instrumentation.md` says
// the keyboard belongs to the runtime layer rather than to the game's debug
// surface. This is that layer: the game registers an intent against the codes
// that drive it and then asks two questions.
//
//   * `value(name)` — is it being asked for right now? What a held direction
//     auto-repeating at `HOP_COOLDOWN` is read from.
//   * `pressed(name)` — did it go down since the last tick? An edge, and the unit
//     a menu move, a confirm, a pause and a mute are counted in.
//
// An edge is armed when the intent leaves rest, CONSUMED by the first `pressed`
// that sees it, and discarded at the end of the tick it was armed in. Consuming
// is what stops one press being acted on twice; the discard is what stops a press
// nothing read surfacing later, out of order.
//
// One code may drive two intents (`Escape` is both `pause` and `back`) and one
// intent may be driven by two codes (`Enter` and `Space` both confirm), so the
// binding is a many-to-many index rather than a map.

/** The mutable state behind one registered intent. */
interface Action {
  readonly name: string;
  readonly keys: readonly string[];
  /** The bound codes currently down: held until the last of them comes up. */
  readonly held: Set<string>;
  /** An armed edge, waiting to be consumed or dropped at the tick's end. */
  edge: boolean;
}

/**
 * Narrows an `Event` to a `KeyboardEvent` structurally rather than with
 * `instanceof`, so an event dispatched from another realm — or a plain `Event`
 * carrying a `code`, which is what a test and a browser automation driver both
 * dispatch — still reaches an intent.
 */
export function asKeyboardEvent(event: Event): KeyboardEvent | null {
  const candidate = event as Partial<KeyboardEvent>;
  return typeof candidate.code === "string" ? (event as KeyboardEvent) : null;
}

/** The registry: the single answer to "is the player asking for X?". */
export class Keyboard {
  private readonly target: EventTarget;
  private readonly actions = new Map<string, Action>();
  /** Reverse index from a key code to the intents it drives. */
  private readonly byCode = new Map<string, string[]>();
  private detached = false;

  private readonly onKeyDown = (event: Event): void => {
    const key = asKeyboardEvent(event);
    // An OS auto-repeat is not a new press: the key never came up. Floe's own
    // auto-repeat is the hop cooldown, which is the game's rather than the
    // platform's (specs/hopping.md).
    if (key === null || key.repeat) return;
    for (const action of this.actionsFor(key.code)) {
      const wasHeld = action.held.size > 0;
      action.held.add(key.code);
      if (!wasHeld) action.edge = true;
    }
  };

  private readonly onKeyUp = (event: Event): void => {
    const key = asKeyboardEvent(event);
    if (key === null) return;
    for (const action of this.actionsFor(key.code)) {
      action.held.delete(key.code);
    }
  };

  constructor(target: EventTarget) {
    this.target = target;
    this.target.addEventListener("keydown", this.onKeyDown);
    this.target.addEventListener("keyup", this.onKeyUp);
  }

  /**
   * Register, or re-register, `name` against `keys`. A re-registration replaces
   * the binding wholesale and returns the intent to rest, because carrying held
   * state across a rebind would strand an intent on with no keyup able to lower
   * it.
   */
  register(name: string, keys: readonly string[]): void {
    this.actions.set(name, {
      name,
      keys: [...keys],
      held: new Set(),
      edge: false,
    });
    this.reindex();
  }

  /**
   * Whether the intent is being asked for, as `1` or `0`.
   *
   * An unregistered name reads `0` rather than throwing: a caller probing for an
   * intent the build should have registered finds it missing without taking the
   * page down mid-tick.
   */
  value(name: string): number {
    return (this.actions.get(name)?.held.size ?? 0) > 0 ? 1 : 0;
  }

  /** Whether the intent went down since the last tick. Consumes the edge. */
  pressed(name: string): boolean {
    const action = this.actions.get(name);
    if (action === undefined || !action.edge) return false;
    action.edge = false;
    return true;
  }

  /** Discard every edge nothing consumed: a press is news for one tick only. */
  endTick(): void {
    for (const action of this.actions.values()) action.edge = false;
  }

  /** Drop the listeners. Idempotent, because teardown races. */
  detach(): void {
    if (this.detached) return;
    this.detached = true;
    this.target.removeEventListener("keydown", this.onKeyDown);
    this.target.removeEventListener("keyup", this.onKeyUp);
  }

  /** The intents bound to `code`; a code nothing is bound to resolves to none. */
  private actionsFor(code: string): Action[] {
    const found: Action[] = [];
    for (const name of this.byCode.get(code) ?? []) {
      const action = this.actions.get(name);
      if (action !== undefined) found.push(action);
    }
    return found;
  }

  /** Rebuild the reverse index, so a rebind removes codes as well as adding them. */
  private reindex(): void {
    this.byCode.clear();
    for (const action of this.actions.values()) {
      for (const code of action.keys) {
        const names = this.byCode.get(code);
        if (names === undefined) this.byCode.set(code, [action.name]);
        else if (!names.includes(action.name)) names.push(action.name);
      }
    }
  }
}

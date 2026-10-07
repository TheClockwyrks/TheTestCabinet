// Meltdown — the keyboard, as named actions.
//
// The game never sees a `KeyboardEvent`. It registers an action name against the
// `KeyboardEvent.code` values that drive it — physical keys, so a binding
// survives a non-QWERTY layout — and then asks one question: did the action go
// down since the last frame? Every action in this game is a one-shot
// (specs/controls.md): nothing is held, so nothing here reports a hold.
//
// An edge is armed when the action leaves rest, CONSUMED by the first `pressed`
// that sees it, and discarded at the end of the frame it was armed in. Consuming
// is what stops one press being acted on twice by two readers; the discard is
// what stops a press nothing read surfacing later, out of order. An OS
// auto-repeat is not a new press, which is what makes a held key fire exactly
// once however long it is held.

/** The mutable state behind one registered action. */
interface Action {
  readonly name: string;
  readonly keys: readonly string[];
  /** The bound codes currently down: the action rests when the last comes up. */
  readonly held: Set<string>;
  /** An armed edge, waiting to be consumed or dropped at frame end. */
  edge: boolean;
}

/**
 * Narrows an `Event` to a `KeyboardEvent` structurally rather than with
 * `instanceof`, so an event dispatched from another realm — or a plain `Event`
 * carrying a `code`, which is what a test and a browser automation driver both
 * dispatch — still reaches an action.
 */
export function asKeyboardEvent(event: Event): KeyboardEvent | null {
  const candidate = event as Partial<KeyboardEvent>;
  return typeof candidate.code === "string" ? (event as KeyboardEvent) : null;
}

/** The registry: the single answer to "did the player just do X?". */
export class Keyboard {
  private readonly target: EventTarget;
  private readonly actions = new Map<string, Action>();
  /** Reverse index from key code to the actions it drives, rebuilt on register. */
  private readonly byCode = new Map<string, string[]>();
  private detached = false;

  private readonly onKeyDown = (event: Event): void => {
    const key = asKeyboardEvent(event);
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
   * the binding wholesale and returns the action to rest, because carrying held
   * state across a rebind would strand an action on with no keyup able to lower
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

  /** Whether the action is held right now. */
  held(name: string): boolean {
    return (this.actions.get(name)?.held.size ?? 0) > 0;
  }

  /**
   * Whether the action went down since the last frame. Consumes the edge.
   *
   * An unregistered name reads `false` rather than throwing: a caller probing
   * for an action the build should have registered discovers it is missing
   * without taking the page down mid-frame.
   */
  pressed(name: string): boolean {
    const action = this.actions.get(name);
    if (action === undefined || !action.edge) return false;
    action.edge = false;
    return true;
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
  }

  /** The actions bound to `code`; a code nothing is bound to resolves to none. */
  private actionsFor(code: string): Action[] {
    const found: Action[] = [];
    for (const name of this.byCode.get(code) ?? []) {
      const action = this.actions.get(name);
      if (action !== undefined) found.push(action);
    }
    return found;
  }

  /** Rebuild the reverse index, so a rebind removes codes as well as adds them. */
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

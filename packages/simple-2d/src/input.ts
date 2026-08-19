/**
 * The action registry: the engine's single answer to "is the player doing X?".
 *
 * A game never reads `KeyboardEvent`s. It registers *named actions* with the keys
 * that drive them and then asks the registry for a value or an edge. Three things
 * fall out of that indirection, and they are the reason it exists:
 *
 * - The same action can be driven from anywhere — a key, a touch layout, or a
 *   driver calling {@link InputRegistry.setAction} — and the game cannot tell which,
 *   so a build is checkable without synthesizing input events at all.
 * - The bindings become *data*. {@link InputRegistry.actions} is a static read that
 *   answers "did this build register and bind everything it was asked to" with no
 *   keystrokes and no gameplay.
 * - Edge detection lives in one place, correctly, instead of in every game.
 *
 * The registry owns no timing of its own: the frame loop calls
 * {@link InputRegistry.endFrame} once per frame, which is what makes "pressed since
 * the last frame" meaningful.
 */

import type { ActionBinding, ActionKind, RegisteredAction, TouchLayout } from "./contract";
import { touchLayout } from "./layouts";

/** The mutable per-action state behind a {@link RegisteredAction}. */
interface ActionState {
  name: string;
  keys: string[];
  kind: ActionKind;
  layout: string | null;
  /**
   * The bound key codes currently down. A set, not a counter or a boolean, because
   * an action bound to several keys must stay held until the *last* of them is
   * released — releasing `KeyW` while `ArrowUp` is still down is not a release.
   */
  heldCodes: Set<string>;
  /** The value a driver pushed in through `setAction`, when no bound key is down. */
  driven: number;
  /** An armed edge, waiting to be consumed by `pressed` or discarded by `endFrame`. */
  edge: boolean;
}

export class InputRegistry {
  readonly #target: EventTarget;
  /** Insertion-ordered, which is what gives {@link actions} its stable order. */
  readonly #actions = new Map<string, ActionState>();
  /**
   * Reverse index from key code to the actions it drives, rebuilt on every
   * registration. Key events are far more frequent than registrations, and a game
   * that binds one code to two actions (a shared `confirm`/`a`, say) must raise both.
   */
  readonly #byCode = new Map<string, string[]>();
  #layout: TouchLayout | null = null;
  #detached = false;

  readonly #onKeyDown = (event: Event): void => {
    const keyboard = asKeyboardEvent(event);
    // An OS auto-repeat is not a new press: the key never came up, so raising the
    // edge again would let a held key machine-gun an action the game only ever
    // meant to fire once per press.
    if (keyboard === null || keyboard.repeat) return;
    for (const state of this.#actionsFor(keyboard.code)) {
      this.#mutate(state, () => state.heldCodes.add(keyboard.code));
    }
  };

  readonly #onKeyUp = (event: Event): void => {
    const keyboard = asKeyboardEvent(event);
    if (keyboard === null) return;
    for (const state of this.#actionsFor(keyboard.code)) {
      this.#mutate(state, () => state.heldCodes.delete(keyboard.code));
    }
  };

  /**
   * Attaches to `target` immediately — the registry is live before any action is
   * registered, so a key held down during start-up is already accounted for by the
   * time the game binds it… and, more usefully, so the game never has to remember
   * to start listening.
   */
  constructor(target: EventTarget) {
    this.#target = target;
    target.addEventListener("keydown", this.#onKeyDown);
    target.addEventListener("keyup", this.#onKeyUp);
  }

  /**
   * Registers (or re-registers) `name`.
   *
   * Re-registering replaces the binding wholesale and resets the action to rest.
   * Carrying held state across a rebind would strand an action on: the code that
   * was down is no longer one of its keys, so no keyup could ever lower it again.
   * The action keeps its position in {@link actions} so the reported order stays
   * stable across a rebind.
   *
   * An unfamiliar `name` is not an error. A game may name actions the engine has
   * never heard of, and that is the normal case for anything beyond a layout's
   * vocabulary.
   */
  register(name: string, binding: ActionBinding): void {
    this.#actions.set(name, {
      name,
      keys: [...binding.keys],
      kind: binding.kind ?? "digital",
      // Only a layout selected *before* this call claims the action: tagging
      // retroactively would let a late `useLayout` rewrite the provenance of
      // actions the game had already bound for itself.
      layout: this.#layout?.actions.includes(name) === true ? this.#layout.name : null,
      heldCodes: new Set(),
      driven: 0,
      edge: false,
    });
    this.#reindex();
  }

  /**
   * Selects the touch layout, which from here on tags any registration of one of
   * its vocabulary actions.
   *
   * @throws if the layout is not in the catalogue — see {@link touchLayout}.
   */
  useLayout(name: string): void {
    this.#layout = touchLayout(name);
  }

  /** The selected layout and its vocabulary, or `null` if none was selected. */
  layout(): TouchLayout | null {
    return this.#layout === null
      ? null
      : { name: this.#layout.name, actions: [...this.#layout.actions] };
  }

  /**
   * Every registered action with its defaults resolved, in registration order.
   *
   * Copied out rather than exposed: this crosses the `window` boundary into a
   * driver, and handing out the live state would let a reader mutate the bindings.
   */
  actions(): RegisteredAction[] {
    return [...this.#actions.values()].map((state) => ({
      name: state.name,
      keys: [...state.keys],
      kind: state.kind,
      layout: state.layout,
    }));
  }

  /**
   * The action's current magnitude: `1` while a bound key is down, otherwise
   * whatever a driver last set. A digital action is quantized to `0` or `1` — the
   * kind is a promise about what the game will read, so a driver pushing `0.5` at a
   * digital action gets "held", not a half-press the game is not written for.
   *
   * An unregistered name reads `0` instead of throwing, because a driver probing
   * for an action a build was supposed to register must be able to discover that it
   * is missing without taking the page down.
   */
  value(name: string): number {
    const state = this.#actions.get(name);
    return state === undefined ? 0 : resolveValue(state);
  }

  /**
   * Whether the action was pressed since the last frame — true exactly once per
   * edge, then consumed.
   *
   * Consumption on read is what makes this safe to poll from more than one place:
   * a menu and the gameplay layer both asking "was confirm pressed" in the same
   * frame must not both act on one press.
   */
  pressed(name: string): boolean {
    const state = this.#actions.get(name);
    if (state === undefined || !state.edge) return false;
    state.edge = false;
    return true;
  }

  /**
   * Drives the action directly, as the host interface does for a driver.
   *
   * This takes the same path a key does, so crossing from rest into motion arms the
   * edge exactly as a keypress would — a driver that sets an action and then checks
   * `pressed` sees what the player would have caused.
   */
  setAction(name: string, value: number): void {
    const state = this.#actions.get(name);
    if (state === undefined) return;
    this.#mutate(state, () => {
      state.driven = value;
    });
  }

  /**
   * Arms the action's edge without touching its held value — a tap.
   *
   * Deliberately not "set to 1": a driver has no release to send afterwards, so a
   * press that also raised the value would leave the action stuck on for the rest
   * of the run.
   */
  pressAction(name: string): void {
    const state = this.#actions.get(name);
    if (state === undefined) return;
    state.edge = true;
  }

  /**
   * Discards every edge that was not consumed this frame.
   *
   * Without this an edge armed during a frame the game did not poll would surface
   * later, out of order with the input that caused it. A press is news for one
   * frame only.
   */
  endFrame(): void {
    for (const state of this.#actions.values()) state.edge = false;
  }

  /**
   * Detaches the key listeners. Idempotent, because teardown races — a page unload
   * and an explicit `stop()` may both reach here.
   */
  detach(): void {
    if (this.#detached) return;
    this.#detached = true;
    this.#target.removeEventListener("keydown", this.#onKeyDown);
    this.#target.removeEventListener("keyup", this.#onKeyUp);
  }

  /** The actions bound to `code`, resolved through the reverse index. */
  #actionsFor(code: string): ActionState[] {
    const names = this.#byCode.get(code) ?? [];
    const states: ActionState[] = [];
    for (const name of names) {
      const state = this.#actions.get(name);
      if (state !== undefined) states.push(state);
    }
    return states;
  }

  /**
   * Applies a change to an action and arms its edge if the change brought it out of
   * rest.
   *
   * Every source of input funnels through here so that "a press" means one thing:
   * the resolved value went from `0` to non-zero. Pressing a second key bound to an
   * already-held action is therefore not a new press, which is what a game expects
   * of two keys that mean the same thing.
   */
  #mutate(state: ActionState, change: () => void): void {
    const before = resolveValue(state);
    change();
    if (before === 0 && resolveValue(state) !== 0) state.edge = true;
  }

  /** Rebuilds the key-code reverse index from the current bindings. */
  #reindex(): void {
    this.#byCode.clear();
    for (const state of this.#actions.values()) {
      for (const code of state.keys) {
        const names = this.#byCode.get(code);
        if (names === undefined) this.#byCode.set(code, [state.name]);
        else if (!names.includes(state.name)) names.push(state.name);
      }
    }
  }
}

/** A held key is full deflection; otherwise the driven value, quantized if digital. */
function resolveValue(state: ActionState): number {
  const raw = state.heldCodes.size > 0 ? 1 : state.driven;
  return state.kind === "digital" ? (raw === 0 ? 0 : 1) : raw;
}

/**
 * Narrows an `Event` to a `KeyboardEvent` structurally rather than with
 * `instanceof`.
 *
 * The registry attaches to whatever `EventTarget` it is handed — a `window`, a
 * canvas, a bare target in a test — and an event dispatched from another realm
 * (an iframe, a jsdom document that is not the global one) is a perfectly good
 * keyboard event that fails an `instanceof` against *this* realm's constructor.
 * Checking for the field we actually read is both narrower and more honest.
 */
function asKeyboardEvent(event: Event): KeyboardEvent | null {
  const candidate = event as Partial<KeyboardEvent>;
  return typeof candidate.code === "string" ? (event as KeyboardEvent) : null;
}

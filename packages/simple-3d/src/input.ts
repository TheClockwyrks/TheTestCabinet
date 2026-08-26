/**
 * The action registry: the engine's single answer to "is the player doing X?".
 *
 * A game never reads `KeyboardEvent`s. It registers *named actions* with the keys
 * that drive them — through `InitApi.input` while it initializes — and then asks
 * for a value or an edge through `UpdateApi.input` while it updates. Three things
 * fall out of that indirection, and they are the reason it exists:
 *
 * - The same action can be driven from anywhere — a key, a touch control, or a
 *   validator calling {@link InputRegistry.setAction} — and the game cannot tell
 *   which, so a build is examinable by delivering input at the seam a player uses.
 * - The bindings become *data*. {@link InputRegistry.actions} is a static read that
 *   answers "did this build register and bind everything it was asked to" with no
 *   keystrokes and no gameplay.
 * - Edge detection lives in one place, correctly, instead of in every game.
 *
 * The registry owns no timing of its own: the frame loop calls
 * {@link InputRegistry.endFrame} once per frame, after the game has rendered, which
 * is what makes "pressed since the last frame" mean anything.
 *
 * **Nothing here grows with the length of a run.** The action map is bounded by the
 * registrations the game makes, and the reverse index by the codes those
 * registrations bind; a key event for a code nothing is bound to is looked up and
 * dropped, never recorded. A run may deliver a million keystrokes without the
 * registry retaining one of them.
 */

import type { TouchLayout } from "./layouts";
import { touchLayout } from "./layouts";
import type { SurfaceMetrics } from "./viewport";

/**
 * Whether an action reports a continuous magnitude or a plain on/off.
 *
 * An `analog` action is sampled every frame for its value; a `digital` action is
 * usually consumed as an edge. Declaring the kind lets the engine decide what a
 * keyboard binding means for that action.
 */
export type ActionKind = "digital" | "analog";

/**
 * What a game supplies when it registers an action.
 *
 * `keys` are `KeyboardEvent.code` values rather than `key` values, so a binding is
 * layout-independent: `KeyW` is the same physical key on QWERTY and AZERTY.
 */
export interface ActionBinding {
  /** The `KeyboardEvent.code` values that drive this action. */
  keys: string[];
  /** How the action is interpreted; defaults to `"digital"`. */
  kind?: ActionKind;
}

/** An action as the engine holds it, with every default resolved. */
export interface RegisteredAction {
  /** The action's name, as the game registered it. */
  name: string;
  /** The resolved `KeyboardEvent.code` bindings. */
  keys: string[];
  /** The resolved kind. */
  kind: ActionKind;
  /** The touch layout this action belongs to, or `null` for one beyond its vocabulary. */
  layout: string | null;
}

/**
 * Where the engine reads the drawing surface's size and pixel density, and
 * what it attaches its key and pointer listeners to.
 *
 * Re-exported here rather than declared here: one seam, one declaration. The
 * type is `viewport.ts`'s, beside `domSurface` — the default implementation of
 * it and the only function in the package that reads a size out of the DOM —
 * and the registry, the pointer, and the engine all consume that one type, so
 * a build supplying its own surface satisfies every consumer at once.
 */
export type { SurfaceMetrics } from "./viewport";

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
  /** The value a caller pushed in through `setAction`, when no bound key is down. */
  driven: number;
  /** An armed edge, waiting to be consumed by `pressed` or discarded by `endFrame`. */
  edge: boolean;
}

export class InputRegistry {
  /**
   * The target the listeners went on, taken from the surface *once*.
   *
   * Re-reading `events()` at detach time would let a surface whose target moved
   * strand a pair of live listeners on the old one, so the registry remembers the
   * target it actually attached to rather than asking again.
   */
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
   * Attaches to the target the surface supplies, immediately.
   *
   * Taking the target from {@link SurfaceMetrics} rather than from a document is
   * the whole point: it is the same seam the engine measures its element through,
   * so an engine built over a surface with no document behind it still has a
   * keyboard. A caller that dispatches a `KeyboardEvent`-shaped event at that
   * target reaches the actions by the path a player's keystrokes take.
   *
   * The listeners go on at construction, before any action is registered, so the
   * game never has to remember to start listening and a key held down during
   * start-up is accounted for by the time its action is bound.
   */
  constructor(surface: SurfaceMetrics) {
    this.#target = surface.events();
    this.#target.addEventListener("keydown", this.#onKeyDown);
    this.#target.addEventListener("keyup", this.#onKeyUp);
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
   *
   * @throws if `binding.kind` is neither `"digital"` nor `"analog"`. The kind is a
   * promise about what the game will read, and an unrecognized one would otherwise
   * fall through to analog and hand a game written for an on/off a fraction.
   */
  register(name: string, binding: ActionBinding): void {
    // Resolved before anything is written, so a rejected registration leaves the
    // action that was already there untouched rather than half-replaced.
    const kind = resolveKind(name, binding.kind);
    this.#actions.set(name, {
      name,
      keys: [...binding.keys],
      kind,
      // Only a layout selected *before* this call claims the action: tagging
      // retroactively would let a late `useLayout` rewrite the provenance of
      // actions the game had already bound for itself.
      layout:
        this.#layout?.actions.includes(name) === true
          ? this.#layout.name
          : null,
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
   * The engine calls this once, from `createEngine`, before a line of game code
   * runs — which is what makes the layout a property of the whole run and lets
   * every registration be attributed against the same vocabulary.
   *
   * @throws if the layout is not in the catalogue — see {@link touchLayout}. The
   * catalogue is closed, and a silent fallback would let a run be configured for
   * one control scheme and executed under another.
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
   * Copied out rather than exposed: this is the "what did the build bind" read, and
   * handing out the live state would let a reader mutate the bindings it came to
   * inspect.
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
   * whatever a caller last drove it to. A digital action is quantized to `0` or
   * `1` — the kind is a promise about what the game will read, so a driver pushing
   * `0.5` at a digital action gets "held", not a half-press the game is not written
   * for.
   *
   * An unregistered name reads `0` instead of throwing, because a check probing for
   * an action a build was supposed to register must be able to discover that it is
   * missing without taking the page down.
   */
  value(name: string): number {
    const state = this.#actions.get(name);
    return state === undefined ? 0 : resolveValue(state);
  }

  /**
   * Whether the action was pressed since the last frame — true exactly once per
   * armed edge, then consumed.
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
   * Drives the action directly, with no key event involved.
   *
   * This takes the same path a key does, so crossing from rest into motion arms the
   * edge exactly as a keypress would — a caller that sets an action and then checks
   * `pressed` sees what the player would have caused.
   *
   * @throws if `value` is not finite. A `NaN` would resolve to a non-zero magnitude
   * that no later `setAction(name, 0)` could be compared against, so an analog
   * action would read `NaN` for the rest of the run; failing here keeps the bad
   * number at the call that produced it.
   */
  setAction(name: string, value: number): void {
    if (!Number.isFinite(value)) {
      throw new Error(
        `Action "${name}" cannot be driven to ${String(value)}; the value must be finite.`,
      );
    }
    const state = this.#actions.get(name);
    if (state === undefined) return;
    this.#mutate(state, () => {
      state.driven = value;
    });
  }

  /**
   * Arms the action's edge without touching its held value — a tap.
   *
   * Deliberately not "set to 1": a caller has no release to send afterwards, so a
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
   * and an explicit `destroy()` may both reach here.
   */
  detach(): void {
    if (this.#detached) return;
    this.#detached = true;
    this.#target.removeEventListener("keydown", this.#onKeyDown);
    this.#target.removeEventListener("keyup", this.#onKeyUp);
  }

  /**
   * The actions bound to `code`, resolved through the reverse index.
   *
   * A code nothing is bound to resolves to nothing and is dropped on the spot,
   * which is what keeps a run's keystrokes from accumulating anywhere.
   */
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

  /**
   * Rebuilds the key-code reverse index from the current bindings.
   *
   * Rebuilt rather than patched: a rebind removes codes as well as adding them, and
   * an index that only ever grew would leave a replaced binding still raising its
   * old action — and would grow with the number of registrations rather than with
   * the codes actually bound.
   */
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
 * The kind an action resolves to, defaulting to `"digital"`.
 *
 * Validated rather than coerced. The kind decides what every later read of the
 * action means, so a typo accepted here would surface frames away as a game
 * receiving a fraction it never handles, with nothing left to point at the
 * registration that caused it.
 */
function resolveKind(name: string, kind: ActionKind | undefined): ActionKind {
  if (kind === undefined) return "digital";
  if (kind !== "digital" && kind !== "analog") {
    throw new Error(
      `Action "${name}" was registered with kind ${JSON.stringify(kind)}; ` +
        `the kinds are "digital" and "analog".`,
    );
  }
  return kind;
}

/**
 * Narrows an `Event` to a `KeyboardEvent` structurally rather than with
 * `instanceof`.
 *
 * The registry attaches to whatever `EventTarget` the surface supplies — a
 * document, a canvas, a bare target under a validator — and an event dispatched
 * from another realm (an iframe, a jsdom document that is not the global one) is a
 * perfectly good keyboard event that fails an `instanceof` against *this* realm's
 * constructor. Checking for the fields we actually read is both narrower and more
 * honest, and it is what lets a validator drive the engine with a plain `Event`
 * carrying a `code` and a `repeat`.
 */
function asKeyboardEvent(event: Event): KeyboardEvent | null {
  const candidate = event as Partial<KeyboardEvent>;
  return typeof candidate.code === "string" ? (event as KeyboardEvent) : null;
}

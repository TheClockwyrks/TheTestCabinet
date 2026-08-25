/**
 * Input: named actions over keyboard bindings and a closed catalogue of touch
 * layouts, with a pointer mapped into the game's logical coordinates.
 *
 * A game registers its actions once, from `InitApi.input` during the game
 * instance's `initialize`, and reads them through a player controller's
 * `InputReader` — the only place a game reads an action. The engine owns the
 * keyboard and the pointer: each action resolves to a single number, edges are
 * armed whenever a change takes the resolved value from `0` to non-zero (a
 * repeat arms nothing), and each player controller consumes edges
 * independently. The input frame closes after the frame renders, discarding
 * every edge left unconsumed, so a press is news for exactly one frame.
 *
 * The bindings live on the engine and survive every level transition. The
 * layout is chosen at construction through `EngineOptions.layout` and holds
 * for the engine's lifetime, so every registration is attributed against the
 * same vocabulary.
 */

import type {
  ActionBinding,
  ActionKind,
  InputReader,
  PointerSample,
  PointerSnapshot,
  RegisteredAction,
  SurfaceMetrics,
  TouchLayout,
  Viewport,
} from "./contract";

/**
 * The four menu actions, appended to every layout's own vocabulary in this
 * order. They are part of the catalogue rather than a convention a game keeps,
 * so every layout answers the same menu vocabulary.
 */
const MENU_ACTIONS = ["confirm", "back", "pause", "mute"] as const;

/** One catalogue entry: the layout's own vocabulary plus the menu actions. */
function layout(name: string, own: readonly string[]): TouchLayout {
  return Object.freeze({
    name,
    actions: Object.freeze([...own, ...MENU_ACTIONS]) as unknown as string[],
  });
}

/**
 * The touch-layout catalogue, exported from the package root as a read-only
 * record.
 *
 * A closed catalogue rather than a game-supplied description, so a reviewer's
 * touch chrome is drawn by the host from a vocabulary it already knows.
 * `EngineOptions.layout` names an entry; a name outside the catalogue is
 * refused at `createEngine`, naming every valid layout.
 */
export const TOUCH_LAYOUTS: Readonly<Record<string, TouchLayout>> =
  Object.freeze({
    /** Two vertical sliders, one per side. */
    "dual-vertical": layout("dual-vertical", [
      "p1-up",
      "p1-down",
      "p2-up",
      "p2-down",
    ]),
    /** One vertical slider. */
    "single-vertical": layout("single-vertical", ["up", "down"]),
    /** A four-way pad. */
    "dpad-4": layout("dpad-4", ["up", "down", "left", "right"]),
    /** A four-way pad and two action buttons. */
    "dpad-4-two-buttons": layout("dpad-4-two-buttons", [
      "up",
      "down",
      "left",
      "right",
      "a",
      "b",
    ]),
  });

/**
 * The most pointer samples one input frame lists.
 *
 * Browsers coalesce `pointermove` to roughly one per animation frame, so a real
 * player never approaches this. The cap exists for the frames that stop closing
 * — a hidden tab whose animation callbacks are suspended while the pointer
 * keeps streaming — where an unbounded list would grow for as long as the tab
 * stays hidden. A sample past the cap still moves the snapshot and the edges;
 * only its place in the list is refused.
 */
const POINTER_SAMPLE_CAP = 1024;

/** What an {@link InputSystem} is built over. */
export interface InputSystemOptions {
  /**
   * Where the key and pointer listeners attach (`events()`), and where the
   * pointer mapping reads its origin and device pixel ratio.
   */
  surface: SurfaceMetrics;
  /**
   * The live logical-to-device fit, read at each pointer event rather than
   * held: events arrive between frames, and the fit in force at that moment —
   * not the one some earlier frame computed — is what places the event on the
   * stage.
   */
  viewport: () => Viewport;
  /**
   * The touch layout selected by `EngineOptions.layout`, or absent when the
   * engine was built without one. A name outside {@link TOUCH_LAYOUTS} throws,
   * naming every valid layout — the catalogue is closed, and a silent fallback
   * would let a run be configured for one control scheme and executed under
   * another.
   */
  layout?: string;
}

/**
 * The mutable per-action state behind a registration.
 *
 * The two edge counters are monotonic. `armed` counts every edge the action has
 * ever armed, and `floor` marks how many of them have been discarded — by the
 * input frame closing, or by a rebind returning the action to rest. A reader
 * remembers how many it has consumed, so "an edge each reader sees once" needs
 * no per-reader bookkeeping here and no registry of the readers themselves: a
 * reader is garbage-collected with the controller that held it.
 */
interface ActionState {
  name: string;
  keys: string[];
  kind: ActionKind;
  layout: string | null;
  /**
   * The bound key codes currently down. A set, not a counter or a boolean,
   * because an action bound to several keys must stay held until the *last* of
   * them is released — releasing `KeyW` while `ArrowUp` is still down is not a
   * release.
   */
  heldCodes: Set<string>;
  /** The magnitude a caller drove in through {@link InputSystem.drive}. */
  driven: number;
  /** Edges armed over the action's whole life. */
  armed: number;
  /** Edges discarded: a reader never consumes below this mark. */
  floor: number;
}

/**
 * The engine's input subsystem: the action registry, the key and pointer
 * listeners, and the per-controller edge bookkeeping.
 *
 * Internal: the engine alone constructs it, once. The listeners attach to the
 * surface's event target at construction, so a dispatched `KeyboardEvent`- or
 * pointer-shaped event drives an action exactly as a player's does — the
 * narrowing is structural rather than `instanceof`, so a plain `Event`
 * carrying the read fields from any realm takes the same path.
 */
export class InputSystem {
  /**
   * The target the listeners went on, taken from the surface *once*.
   * Re-reading `events()` at detach time would let a surface whose target
   * moved strand live listeners on the old one.
   */
  private readonly target: EventTarget;
  private readonly surface: SurfaceMetrics;
  private readonly viewport: () => Viewport;
  /** Insertion-ordered, which is what keeps a rebind's position stable. */
  private readonly actionStates = new Map<string, ActionState>();
  /**
   * Reverse index from key code to the actions it drives, rebuilt on every
   * registration. Key events are far more frequent than registrations, and a
   * key bound to several actions must raise all of them together.
   */
  private readonly byCode = new Map<string, string[]>();
  private readonly selected: TouchLayout | null;
  private detached = false;

  /** The pointer's most recent position and hold. */
  private pointerX = 0;
  private pointerY = 0;
  private pointerDown = false;
  /** Monotonic edge counters and their discard marks, as an action's. */
  private pressArmed = 0;
  private pressFloor = 0;
  private releaseArmed = 0;
  private releaseFloor = 0;
  /** The samples delivered since the input frame last closed. */
  private samples: PointerSample[] = [];

  private readonly onKeyDown = (event: Event): void => {
    const keyboard = asKeyboardEvent(event);
    // An OS auto-repeat is a continuation of the hold, not a new press: the
    // key never came up, so arming again would let a held key machine-gun an
    // action the game only ever meant to fire once per press.
    if (keyboard === null || keyboard.repeat) return;
    for (const state of this.actionsFor(keyboard.code)) {
      this.mutate(state, () => state.heldCodes.add(keyboard.code));
    }
  };

  private readonly onKeyUp = (event: Event): void => {
    const keyboard = asKeyboardEvent(event);
    if (keyboard === null) return;
    for (const state of this.actionsFor(keyboard.code)) {
      this.mutate(state, () => state.heldCodes.delete(keyboard.code));
    }
  };

  private readonly onPointerDown = (event: Event): void => {
    const position = this.position(event);
    if (position.kind !== "at") return;
    // A second `pointerdown` while already held — a chorded mouse button — is
    // a continuation of the hold: the pointer moves, no edge arms, and the
    // listed samples keep alternating `down` and `up` strictly.
    if (this.pointerDown) {
      this.record("move", position.x, position.y);
      return;
    }
    this.pointerDown = true;
    this.pressArmed += 1;
    this.record("down", position.x, position.y);
  };

  private readonly onPointerMove = (event: Event): void => {
    const position = this.position(event);
    if (position.kind !== "at") return;
    this.record("move", position.x, position.y);
  };

  private readonly onPointerUp = (event: Event): void => {
    const position = this.position(event);
    if (position.kind === "ignore") return;
    if (position.kind === "unplaced") {
      // The release still ends the hold: a degenerate fit can place no
      // position, but leaving `down` stranded would hold a drag or an aim for
      // the rest of the run over one hidden-canvas release.
      this.releasePointer();
      return;
    }
    // A `pointerup` while not held has no hold to end; it still says where the
    // pointer is.
    if (!this.pointerDown) {
      this.record("move", position.x, position.y);
      return;
    }
    this.pointerX = position.x;
    this.pointerY = position.y;
    this.releasePointer();
  };

  /**
   * A cancelled pointer — the browser took the gesture for scrolling, the
   * touch left the surface — ends the hold as a release at the last known
   * position. Its own coordinates are not read: a cancel is the browser saying
   * the gesture stopped being the page's, not a report of where it went.
   */
  private readonly onPointerCancel = (event: Event): void => {
    if ((event as Partial<PointerEvent>).isPrimary === false) return;
    this.releasePointer();
  };

  /**
   * Attaches to the target the surface supplies, immediately, before any
   * action is registered — so the game never has to remember to start
   * listening, and a key held down during start-up is accounted for by the
   * time its action is bound.
   *
   * @throws if `options.layout` names a layout outside {@link TOUCH_LAYOUTS},
   * naming every valid layout.
   */
  constructor(options: InputSystemOptions) {
    this.surface = options.surface;
    this.viewport = options.viewport;
    this.selected = resolveLayout(options.layout);

    this.target = options.surface.events();
    this.target.addEventListener("keydown", this.onKeyDown);
    this.target.addEventListener("keyup", this.onKeyUp);
    this.target.addEventListener("pointerdown", this.onPointerDown);
    this.target.addEventListener("pointermove", this.onPointerMove);
    this.target.addEventListener("pointerup", this.onPointerUp);
    this.target.addEventListener("pointercancel", this.onPointerCancel);
  }

  /**
   * Registers or re-registers `name`: `keys` copied, `kind` defaulted to
   * `"digital"`, layout provenance resolved against the selected layout.
   * Re-registering replaces the binding wholesale, returns the action to
   * rest, and keeps its position in the registration order.
   *
   * Any name is accepted: a layout brings a vocabulary the engine recognizes,
   * and a registration under any other name is equally ordinary, which is what
   * lets a design name the actions it actually has.
   */
  register(name: string, binding: ActionBinding): void {
    const previous = this.actionStates.get(name);
    // A `Map.set` on an existing key keeps its position, which is the whole of
    // the ordering rule. Rest means everything: held keys and driven
    // magnitudes are gone (carrying held state across a rebind would strand
    // the action on — the code that was down is no longer one of its keys, so
    // no keyup could ever lower it again), and so is any edge still pending.
    this.actionStates.set(name, {
      name,
      keys: [...binding.keys],
      kind: binding.kind ?? "digital",
      layout:
        this.selected?.actions.includes(name) === true
          ? this.selected.name
          : null,
      heldCodes: new Set(),
      driven: 0,
      armed: previous?.armed ?? 0,
      floor: previous?.armed ?? 0,
    });
    this.reindex();
  }

  /** The layout selected at construction, or `null` when none was named. */
  layout(): TouchLayout | null {
    return this.selected === null
      ? null
      : { name: this.selected.name, actions: [...this.selected.actions] };
  }

  /**
   * Every registered action with its defaults resolved, in registration
   * order — the "what did this build bind" read, copied out so a reader
   * cannot mutate the bindings it came to inspect. Internal: the engine's
   * debug chrome reads it; a game reads actions by name alone.
   */
  actions(): RegisteredAction[] {
    return [...this.actionStates.values()].map((state) => ({
      name: state.name,
      keys: [...state.keys],
      kind: state.kind,
      layout: state.layout,
    }));
  }

  /**
   * Drives an action's magnitude directly, with no key event involved — the
   * seam a host's touch chrome pushes a slider's deflection through. Internal:
   * the documented sources are keys and touch controls, and a game reads the
   * one resolved number whichever moved it.
   *
   * The change takes the same path a key does, so crossing from rest into
   * motion arms the edge exactly as a keypress would. A held key wins over the
   * driven value (full deflection), and a digital action quantizes whatever
   * arrives. An unregistered name is ignored, as a key for an unbound code is.
   *
   * @throws if `value` is not finite: a `NaN` would resolve to a non-zero
   * magnitude no later `drive(name, 0)` could be compared against, so the
   * action would read `NaN` for the rest of the run.
   */
  drive(name: string, value: number): void {
    if (!Number.isFinite(value)) {
      throw new Error(
        `action "${name}" cannot be driven to ${String(value)}; the magnitude must be finite`,
      );
    }
    const state = this.actionStates.get(name);
    if (state === undefined) return;
    this.mutate(state, () => {
      state.driven = value;
    });
  }

  /**
   * A reader with its own copy of every edge, for one player controller.
   *
   * Each reader remembers how many of an action's edges it has consumed, so an
   * edge armed on an action is `pressed` exactly once for each reader that
   * asks and the first read within one reader takes it. The bookkeeping lives
   * on the reader alone — the system holds no list of readers — so a reader
   * dies with the controller that held it and a run of transitions leaks
   * nothing here.
   */
  createReader(): InputReader {
    // How many of each action's edges this reader has consumed, by name. The
    // map is bounded by the names the game registers and asks about.
    const consumed = new Map<string, number>();
    let pressConsumed = 0;
    let releaseConsumed = 0;

    // One edge, consumed against a monotonic pair: `floor` is where discarded
    // edges end and `armed` is where the live ones do, so a reader that was
    // created mid-frame (its own count still zero) starts at the floor and
    // sees exactly the edges armed since — never a stale one from a frame that
    // already closed.
    const take = (consumedSoFar: number, floor: number, armed: number) => {
      const seen = Math.max(consumedSoFar, floor);
      return seen < armed
        ? { taken: true, seen: seen + 1 }
        : { taken: false, seen };
    };

    const system = this;
    return {
      value(name: string): number {
        const state = system.actionStates.get(name);
        return state === undefined ? 0 : resolveValue(state);
      },
      pressed(name: string): boolean {
        const state = system.actionStates.get(name);
        if (state === undefined) return false;
        const result = take(consumed.get(name) ?? 0, state.floor, state.armed);
        consumed.set(name, result.seen);
        return result.taken;
      },
      pointer(): PointerSnapshot {
        return {
          x: system.pointerX,
          y: system.pointerY,
          down: system.pointerDown,
        };
      },
      pointerPressed(): boolean {
        const result = take(
          pressConsumed,
          system.pressFloor,
          system.pressArmed,
        );
        pressConsumed = result.seen;
        return result.taken;
      },
      pointerReleased(): boolean {
        const result = take(
          releaseConsumed,
          system.releaseFloor,
          system.releaseArmed,
        );
        releaseConsumed = result.seen;
        return result.taken;
      },
      pointerSamples(): PointerSample[] {
        return [...system.samples];
      },
    };
  }

  /**
   * Closes the input frame: empties the pointer sample list and discards
   * every edge left unconsumed, on every reader. Called after the frame
   * renders — last, so every controller that ticked this frame had its chance
   * to consume an edge.
   */
  endFrame(): void {
    for (const state of this.actionStates.values()) state.floor = state.armed;
    this.pressFloor = this.pressArmed;
    this.releaseFloor = this.releaseArmed;
    this.samples = [];
  }

  /**
   * Removes every listener. Called from `engine.destroy`. Idempotent, because
   * teardown races — a page unload and an explicit `destroy()` may both reach
   * here.
   */
  detach(): void {
    if (this.detached) return;
    this.detached = true;
    this.target.removeEventListener("keydown", this.onKeyDown);
    this.target.removeEventListener("keyup", this.onKeyUp);
    this.target.removeEventListener("pointerdown", this.onPointerDown);
    this.target.removeEventListener("pointermove", this.onPointerMove);
    this.target.removeEventListener("pointerup", this.onPointerUp);
    this.target.removeEventListener("pointercancel", this.onPointerCancel);
  }

  /**
   * The actions bound to `code`, resolved through the reverse index. A code
   * nothing is bound to resolves to nothing and is dropped on the spot, which
   * is what keeps a run's keystrokes from accumulating anywhere.
   */
  private actionsFor(code: string): ActionState[] {
    const names = this.byCode.get(code) ?? [];
    const states: ActionState[] = [];
    for (const name of names) {
      const state = this.actionStates.get(name);
      if (state !== undefined) states.push(state);
    }
    return states;
  }

  /**
   * Applies a change to an action and arms its edge if the change brought it
   * out of rest.
   *
   * Every source of input funnels through here so that "a press" means one
   * thing: the resolved value went from `0` to non-zero. Pressing a second key
   * bound to an already-held action is therefore not a new press, which is
   * what a game expects of two keys that mean the same thing.
   */
  private mutate(state: ActionState, change: () => void): void {
    const before = resolveValue(state);
    change();
    if (before === 0 && resolveValue(state) !== 0) state.armed += 1;
  }

  /**
   * Rebuilds the key-code reverse index from the current bindings.
   *
   * Rebuilt rather than patched: a rebind removes codes as well as adding
   * them, and an index that only ever grew would leave a replaced binding
   * still raising its old action.
   */
  private reindex(): void {
    this.byCode.clear();
    for (const state of this.actionStates.values()) {
      for (const code of state.keys) {
        const names = this.byCode.get(code);
        if (names === undefined) this.byCode.set(code, [state.name]);
        else if (!names.includes(state.name)) names.push(state.name);
      }
    }
  }

  /** Ends the hold at the last known position, arming the release edge. */
  private releasePointer(): void {
    if (!this.pointerDown) return;
    this.pointerDown = false;
    this.releaseArmed += 1;
    this.record("up", this.pointerX, this.pointerY);
  }

  /**
   * The event's position in logical coordinates, or the refusal that keeps it
   * off the stage.
   *
   * `ignore` is an event this input does not track at all: one with no numeric
   * client position (the narrowing is structural, like the key listeners', so
   * a plain `Event` carrying `clientX`/`clientY` from any realm drives the
   * pointer) or a non-primary pointer — the second touch of a multi-touch
   * gesture — since one logical pointer is tracked. `unplaced` is a real
   * pointer event a degenerate fit (a `scale` of `0`) gives no place on the
   * stage: a `down` or `move` is dropped, and the one listener that must still
   * act — a release, which ends the hold wherever it happened — tells the two
   * apart.
   */
  private position(
    event: Event,
  ):
    | { kind: "at"; x: number; y: number }
    | { kind: "ignore" }
    | { kind: "unplaced" } {
    const candidate = event as Partial<PointerEvent>;
    if (
      typeof candidate.clientX !== "number" ||
      typeof candidate.clientY !== "number"
    ) {
      return { kind: "ignore" };
    }
    if (candidate.isPrimary === false) return { kind: "ignore" };
    const viewport = this.viewport();
    if (viewport.scale === 0) return { kind: "unplaced" };
    // The documented conversion: client position relative to the surface's
    // origin, multiplied by the device pixel ratio, through the inverse
    // viewport map. Over a surface with no `origin`, the origin reads (0, 0),
    // so a dispatched event's client position is read as CSS pixels from the
    // canvas's top-left corner.
    const origin = this.surface.origin?.() ?? { x: 0, y: 0 };
    const dpr = this.surface.dpr();
    const ratio = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
    return {
      kind: "at",
      x:
        ((candidate.clientX - origin.x) * ratio - viewport.offsetX) /
        viewport.scale,
      y:
        ((candidate.clientY - origin.y) * ratio - viewport.offsetY) /
        viewport.scale,
    };
  }

  /**
   * Moves the snapshot and lists the sample, refusing the listing — and only
   * the listing — past the cap.
   */
  private record(type: PointerSample["type"], x: number, y: number): void {
    this.pointerX = x;
    this.pointerY = y;
    if (this.samples.length < POINTER_SAMPLE_CAP) {
      this.samples.push({ type, x, y });
    }
  }
}

/** A held key is full deflection; otherwise the driven value, quantized if digital. */
function resolveValue(state: ActionState): number {
  const raw = state.heldCodes.size > 0 ? 1 : state.driven;
  return state.kind === "digital" ? (raw === 0 ? 0 : 1) : raw;
}

/**
 * The catalogue entry a layout name selects, or `null` for none.
 *
 * The catalogue is closed: a name outside it fails here, at construction,
 * naming every valid layout — a silent fallback to a default would let a run
 * be configured for one control scheme and executed under another, leaving the
 * run record describing a run that never happened.
 */
function resolveLayout(name: string | undefined): TouchLayout | null {
  if (name === undefined) return null;
  const entry = TOUCH_LAYOUTS[name];
  if (entry === undefined) {
    const valid = Object.keys(TOUCH_LAYOUTS)
      .map((key) => `"${key}"`)
      .join(", ");
    throw new Error(
      `unknown touch layout "${name}" — the layouts are ${valid}`,
    );
  }
  return entry;
}

/**
 * Narrows an `Event` to a `KeyboardEvent` structurally rather than with
 * `instanceof`.
 *
 * The system attaches to whatever `EventTarget` the surface supplies — a
 * document, a canvas, a bare target under a validator — and an event
 * dispatched from another realm is a perfectly good keyboard event that fails
 * an `instanceof` against *this* realm's constructor. Checking for the fields
 * actually read is what lets a caller drive the engine with a plain `Event`
 * carrying a `code` and a `repeat`.
 */
function asKeyboardEvent(event: Event): KeyboardEvent | null {
  const candidate = event as Partial<KeyboardEvent>;
  return typeof candidate.code === "string" ? (event as KeyboardEvent) : null;
}

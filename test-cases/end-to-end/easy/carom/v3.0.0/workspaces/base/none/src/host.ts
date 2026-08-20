// Carom — the host. CASE-PROVIDED. Do not edit.
//
// This project is built on no engine, so the runtime every browser game needs is
// part of the build and lives here: the frame loop and the delta time it measures,
// fitting the fixed logical field into the canvas (the uniform scale, the centered
// letterbox, the device pixel ratio, and the resync when any of them changes),
// keyboard input as named actions, an audio bus of named cues over Web Audio with
// its first-gesture unlock, asset resolution under a fixed root, and the
// diagnostics overlay.
//
// What is NOT here is the game. `createHost` binds one `Game` and drives it: an
// `initialize` that runs once and returns the state, then an `update` and a
// `render` per frame. That contract is `src/game.ts`, and this file is the whole
// of what stands behind it.
//
// READ THIS FILE BEFORE WRITING `src/game.ts`. It is the reference for every API
// the three functions receive, and the doc comment on each member is the
// authority on what that member does.

/* -------------------------------------------------------------------------- */
/* Clocks                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The source of a frame's delta time.
 *
 * A clock answers one question: how much time is this frame worth. Returning
 * `null` declines the tick, which leaves the simulation and the frame counter
 * untouched.
 *
 * Nothing here distinguishes a clock that drives itself from one that is stepped,
 * so a clock that ignores `nowMs` yields the same sequence of deltas under
 * {@link Host.run} and {@link Host.advance} alike.
 */
export interface Clock {
  /** This tick's delta in milliseconds, or `null` when the tick is not a frame. */
  delta(nowMs: number): number | null;
}

/**
 * Real elapsed time, floored at zero and clamped to a ceiling. This is the clock
 * a shipped build runs under.
 *
 * The ceiling exists because a backgrounded tab resumes with a gap measured in
 * seconds, and a game asked to integrate half a minute in one step tunnels
 * through its own walls. The floor exists because timestamps are not guaranteed
 * monotonic, and a negative delta rewinds the simulation. The first tick reports
 * zero: a delta is a measurement between two frames, and there is no earlier
 * frame to measure from.
 */
export class WallClock implements Clock {
  private readonly maxDeltaMs: number;
  private previousMs: number | null = null;

  constructor(maxDeltaMs = 100) {
    if (!(Number.isFinite(maxDeltaMs) && maxDeltaMs > 0)) {
      throw new RangeError(
        `WallClock needs a positive maxDeltaMs, got ${maxDeltaMs}`,
      );
    }
    this.maxDeltaMs = maxDeltaMs;
  }

  delta(nowMs: number): number {
    const previousMs = this.previousMs;
    this.previousMs = nowMs;
    if (previousMs === null) return 0;
    const elapsedMs = nowMs - previousMs;
    if (!(elapsedMs > 0)) return 0;
    return Math.min(elapsedMs, this.maxDeltaMs);
  }
}

/**
 * The same delta every tick, whatever the host timestamp says.
 *
 * What a check steps with: `advance(n)` under this clock is exactly `n` frames of
 * exactly the stated size, so a duration is a whole number of frames and a
 * scenario replays identically on every machine.
 */
export class ConstantClock implements Clock {
  private readonly stepMs: number;

  constructor(stepMs: number) {
    if (!(Number.isFinite(stepMs) && stepMs > 0)) {
      throw new RangeError(
        `ConstantClock needs a positive stepMs, got ${stepMs}`,
      );
    }
    this.stepMs = stepMs;
  }

  delta(): number {
    return this.stepMs;
  }
}

/**
 * A fixed sequence of deltas, repeated once it runs out.
 *
 * An uneven frame divided into stated pieces, which is how a check establishes
 * that the same interval of game time reaches the same state however it was
 * divided into frames.
 */
export class SequenceClock implements Clock {
  private readonly stepsMs: readonly number[];
  private cursor = 0;

  constructor(stepsMs: readonly number[]) {
    if (stepsMs.length === 0) {
      throw new RangeError("SequenceClock needs at least one step");
    }
    for (const step of stepsMs) {
      if (!(Number.isFinite(step) && step > 0)) {
        throw new RangeError(
          `SequenceClock steps must be positive, got ${step}`,
        );
      }
    }
    this.stepsMs = [...stepsMs];
  }

  delta(): number {
    const step = this.stepsMs[this.cursor % this.stepsMs.length] ?? 0;
    this.cursor += 1;
    return step;
  }
}

/* -------------------------------------------------------------------------- */
/* The frame                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The frame loop's position. `count` is the tick unit a check asserts against;
 * `timeMs` is the sum of the deltas delivered rather than elapsed wall time.
 */
export interface FrameInfo {
  /** Frames run since the loop started. */
  count: number;
  /** Total simulated time in milliseconds. */
  timeMs: number;
  /** The delta the most recent frame was stepped by, in milliseconds. */
  lastDeltaMs: number;
}

/** How a run halts. */
export interface RunOptions {
  /** Aborting this halts the loop and resolves the promise `run` returned. */
  signal?: AbortSignal;
}

/* -------------------------------------------------------------------------- */
/* Input                                                                      */
/* -------------------------------------------------------------------------- */

/** Whether an action reports a continuous magnitude or a plain on/off. */
export type ActionKind = "digital" | "analog";

/**
 * What the game supplies when it registers an action. `keys` are
 * `KeyboardEvent.code` values, so a binding is a physical key rather than a
 * layout-dependent character.
 */
export interface ActionBinding {
  /** The `KeyboardEvent.code` values that drive this action. */
  keys: string[];
  /** How the action is interpreted; defaults to `"digital"`. */
  kind?: ActionKind;
}

/** An action as the host holds it, with every default resolved. */
export interface RegisteredAction {
  name: string;
  keys: string[];
  kind: ActionKind;
  /** The touch layout this action belongs to, or `null` for one beyond it. */
  layout: string | null;
}

/**
 * A touch layout: the name of a control scheme and the action vocabulary it
 * brings with it. Selecting one registers nothing and draws nothing; it fixes the
 * vocabulary, so what the build speaks is readable as a static fact.
 */
export interface TouchLayout {
  name: string;
  actions: string[];
}

/** The vocabulary every layout carries on top of its own. */
const MENU_ACTIONS: readonly string[] = ["confirm", "back", "pause", "mute"];

/** Each layout's own vocabulary, before the menu actions are appended. */
const LAYOUT_VOCABULARIES: Readonly<Record<string, readonly string[]>> = {
  "dual-vertical": ["p1-up", "p1-down", "p2-up", "p2-down"],
  "single-vertical": ["up", "down"],
  "dpad-4": ["up", "down", "left", "right"],
};

/**
 * The layout named `name`, as a fresh copy the caller owns. The catalogue is
 * closed, so an unknown name throws rather than falling back to a default that
 * would leave the build configured for one control scheme and run under another.
 */
export function touchLayout(name: string): TouchLayout {
  const vocabulary = LAYOUT_VOCABULARIES[name];
  if (vocabulary === undefined) {
    const valid = Object.keys(LAYOUT_VOCABULARIES).join(", ");
    throw new Error(
      `Unknown touch layout "${name}". The catalogue is closed; valid layouts are: ${valid}.`,
    );
  }
  return { name, actions: [...vocabulary, ...MENU_ACTIONS] };
}

/** The mutable per-action state behind a {@link RegisteredAction}. */
interface ActionState {
  name: string;
  keys: string[];
  kind: ActionKind;
  layout: string | null;
  /** The bound codes currently down: an action stays held until the last is up. */
  heldCodes: Set<string>;
  /** The value a caller pushed in, when no bound key is down. */
  driven: number;
  /** An armed edge, waiting to be consumed by `pressed` or dropped at frame end. */
  edge: boolean;
}

/** A held key is full deflection; otherwise the driven value, quantized if digital. */
function resolveValue(state: ActionState): number {
  const raw = state.heldCodes.size > 0 ? 1 : state.driven;
  return state.kind === "digital" ? (raw === 0 ? 0 : 1) : raw;
}

/**
 * Narrows an `Event` to a `KeyboardEvent` structurally rather than with
 * `instanceof`, so an event dispatched from another realm — or a plain `Event`
 * carrying a `code`, which is what a check dispatches — still reaches an action.
 */
function asKeyboardEvent(event: Event): KeyboardEvent | null {
  const candidate = event as Partial<KeyboardEvent>;
  return typeof candidate.code === "string" ? (event as KeyboardEvent) : null;
}

/**
 * The action registry: the single answer to "is the player doing X?".
 *
 * The game never reads a `KeyboardEvent`. It registers named actions with the keys
 * that drive them and asks for a value or an edge, so the same action can be
 * driven from a key or from a check, and the game cannot tell which.
 */
class InputRegistry {
  private readonly target: EventTarget;
  /** Insertion-ordered, which is what gives {@link actions} its stable order. */
  private readonly actionStates = new Map<string, ActionState>();
  /** Reverse index from key code to the actions it drives, rebuilt on register. */
  private readonly byCode = new Map<string, string[]>();
  private selected: TouchLayout | null = null;
  private detached = false;

  private readonly onKeyDown = (event: Event): void => {
    const keyboard = asKeyboardEvent(event);
    // An OS auto-repeat is not a new press: the key never came up.
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

  constructor(surface: SurfaceMetrics) {
    this.target = surface.events();
    this.target.addEventListener("keydown", this.onKeyDown);
    this.target.addEventListener("keyup", this.onKeyUp);
  }

  /**
   * Registers (or re-registers) `name`. Re-registering replaces the binding
   * wholesale and resets the action to rest, because carrying held state across a
   * rebind would strand an action on with no keyup able to lower it.
   */
  register(name: string, binding: ActionBinding): void {
    const kind = resolveKind(name, binding.kind);
    this.actionStates.set(name, {
      name,
      keys: [...binding.keys],
      kind,
      layout:
        this.selected?.actions.includes(name) === true
          ? this.selected.name
          : null,
      heldCodes: new Set(),
      driven: 0,
      edge: false,
    });
    this.reindex();
  }

  /** Selects the layout, which from here on tags any registration in it. */
  useLayout(name: string): void {
    this.selected = touchLayout(name);
  }

  /** The selected layout and its vocabulary, or `null` if none was selected. */
  layout(): TouchLayout | null {
    return this.selected === null
      ? null
      : { name: this.selected.name, actions: [...this.selected.actions] };
  }

  /** Every registered action with its defaults resolved, in registration order. */
  actions(): RegisteredAction[] {
    return [...this.actionStates.values()].map((state) => ({
      name: state.name,
      keys: [...state.keys],
      kind: state.kind,
      layout: state.layout,
    }));
  }

  /**
   * The action's current magnitude. An unregistered name reads `0` rather than
   * throwing, so a check probing for an action the build should have registered
   * discovers it is missing without taking the page down.
   */
  value(name: string): number {
    const state = this.actionStates.get(name);
    return state === undefined ? 0 : resolveValue(state);
  }

  /**
   * Whether the action was pressed since the last frame — true exactly once per
   * armed edge, then consumed, so a menu and the gameplay layer polling in one
   * frame cannot both act on one press.
   */
  pressed(name: string): boolean {
    const state = this.actionStates.get(name);
    if (state === undefined || !state.edge) return false;
    state.edge = false;
    return true;
  }

  /** Drives the action directly, taking the same path a key does. */
  setAction(name: string, value: number): void {
    if (!Number.isFinite(value)) {
      throw new Error(
        `Action "${name}" cannot be driven to ${String(value)}; the value must be finite.`,
      );
    }
    const state = this.actionStates.get(name);
    if (state === undefined) return;
    this.mutate(state, () => {
      state.driven = value;
    });
  }

  /** Arms the action's edge without touching its held value — a tap. */
  pressAction(name: string): void {
    const state = this.actionStates.get(name);
    if (state === undefined) return;
    state.edge = true;
  }

  /** Discards every edge nothing consumed: a press is news for one frame only. */
  endFrame(): void {
    for (const state of this.actionStates.values()) state.edge = false;
  }

  /** Detaches the key listeners. Idempotent, because teardown races. */
  detach(): void {
    if (this.detached) return;
    this.detached = true;
    this.target.removeEventListener("keydown", this.onKeyDown);
    this.target.removeEventListener("keyup", this.onKeyUp);
  }

  /** The actions bound to `code`; a code nothing is bound to resolves to nothing. */
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
   * Applies a change and arms the edge if it brought the action out of rest, so
   * "a press" means one thing: the resolved value went from `0` to non-zero.
   */
  private mutate(state: ActionState, change: () => void): void {
    const before = resolveValue(state);
    change();
    if (before === 0 && resolveValue(state) !== 0) state.edge = true;
  }

  /** Rebuilds the reverse index, so a rebind removes codes as well as adding them. */
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
}

/** The kind an action resolves to, defaulting to `"digital"`. */
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

/* -------------------------------------------------------------------------- */
/* Audio                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The synthesis description behind a named cue. Small on purpose: it covers the
 * bleeps a 2D game needs without the build shipping audio assets.
 */
export interface CueSpec {
  /** The oscillator waveform; defaults to a sine. */
  wave?: "sine" | "square" | "sawtooth" | "triangle";
  /** The starting frequency in hertz. */
  freq: number;
  /** The frequency to sweep to over the cue's duration; absent holds `freq`. */
  freqTo?: number;
  /** Peak gain in `[0, 1]`; defaults to {@link DEFAULT_CUE_GAIN}. */
  gain?: number;
  /** How long the cue sounds, in milliseconds. */
  durationMs: number;
}

/** The peak gain a cue plays at when its spec names none. */
const DEFAULT_CUE_GAIN = 0.2;

/** The floor an exponential gain ramp decays to; it cannot reach zero. */
const SILENCE_GAIN = 0.0001;

/**
 * The audio bus: named cues, played by name, announced as events.
 *
 * A cue is announced whether or not anything is audible — muted, still locked, or
 * running with no audio support at all. Mute is a gain of zero rather than a
 * missing event, which keeps a build that reacted while muted distinguishable
 * from one that never reacted. Nothing about audio may fail a frame.
 */
class AudioBus {
  private readonly cues = new Map<string, CueSpec>();
  private readonly emit: HostEmitter;
  private readonly nowMs: () => number;
  private context: AudioContext | null = null;
  private mutedFlag = false;
  private unlockedFlag = false;
  private teardown: Array<() => void> = [];

  constructor(emit: HostEmitter, nowMs: () => number) {
    this.emit = emit;
    this.nowMs = nowMs;
  }

  /** Declare a cue under a name; redeclaring replaces it. */
  define(cue: string, spec: CueSpec): void {
    this.cues.set(cue, { ...spec });
  }

  /**
   * Play a declared cue. Playing one that was never declared throws: that is a
   * typo in the build, and silence is the expected outcome of a muted bus, so the
   * mistake would otherwise be indistinguishable from an inaudible cue.
   */
  play(cue: string): void {
    const spec = this.cues.get(cue);
    if (spec === undefined) {
      throw new Error(`Cue "${cue}" was played but never defined.`);
    }
    const gain = this.mutedFlag ? 0 : (spec.gain ?? DEFAULT_CUE_GAIN);
    this.emit("cue:played", { cue, t: this.nowMs(), gain });
    if (gain > 0) this.sound(spec, gain);
  }

  /** Mute or unmute the bus. */
  setMuted(muted: boolean): void {
    this.mutedFlag = muted;
  }

  /** Whether the bus is muted. */
  muted(): boolean {
    return this.mutedFlag;
  }

  /** Whether a user gesture has unlocked the audio context. */
  unlocked(): boolean {
    return this.unlockedFlag;
  }

  /**
   * Listen for the first user gesture and open the context then.
   *
   * A context created outside a gesture starts suspended and some browsers count
   * the attempt against the page, so nothing is created until one arrives. A host
   * with no document (a check driving the bus in process) has no gesture to wait
   * for and simply stays locked, which is silent and correct.
   */
  armUnlock(): void {
    if (typeof document === "undefined") return;
    const unlock = (): void => {
      this.open();
      this.disarm();
      if (this.unlockedFlag) this.emit("audio:unlocked", {});
    };
    for (const type of ["pointerdown", "keydown", "touchstart"] as const) {
      document.addEventListener(type, unlock, { once: true });
      this.teardown.push(() => document.removeEventListener(type, unlock));
    }
  }

  /** Drop the gesture listeners and close the context. Idempotent. */
  dispose(): void {
    this.disarm();
    const context = this.context;
    this.context = null;
    this.unlockedFlag = false;
    void context?.close().catch(() => undefined);
  }

  private disarm(): void {
    for (const remove of this.teardown) remove();
    this.teardown = [];
  }

  /** Open the Web Audio context, degrading to silence where there is none. */
  private open(): void {
    if (this.context !== null) return;
    const Ctor =
      typeof globalThis.AudioContext === "function"
        ? globalThis.AudioContext
        : null;
    if (Ctor === null) return;
    try {
      this.context = new Ctor();
      void this.context.resume().catch(() => undefined);
      this.unlockedFlag = true;
    } catch {
      this.context = null;
    }
  }

  /** One oscillator through one gain envelope. Never throws into a frame. */
  private sound(spec: CueSpec, gain: number): void {
    const context = this.context;
    if (context === null) return;
    try {
      const at = context.currentTime;
      const seconds = Math.max(spec.durationMs, 1) / 1000;
      const oscillator = context.createOscillator();
      const envelope = context.createGain();
      oscillator.type = spec.wave ?? "sine";
      oscillator.frequency.setValueAtTime(spec.freq, at);
      if (spec.freqTo !== undefined) {
        oscillator.frequency.exponentialRampToValueAtTime(
          Math.max(spec.freqTo, 1),
          at + seconds,
        );
      }
      envelope.gain.setValueAtTime(gain, at);
      envelope.gain.exponentialRampToValueAtTime(SILENCE_GAIN, at + seconds);
      oscillator.connect(envelope).connect(context.destination);
      oscillator.start(at);
      oscillator.stop(at + seconds);
    } catch {
      // A context that died mid-frame degrades to silence, never to a thrown frame.
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Assets                                                                     */
/* -------------------------------------------------------------------------- */

/** The root every asset path resolves under when none is supplied. */
const DEFAULT_ASSET_ROOT = "assets/";

/**
 * Asset resolution under a fixed root, with each arrival and each failure
 * announced. Carom ships no assets, so nothing here runs in a conformant build;
 * it exists because the game's `initialize` is handed the same surface whatever
 * the build turns out to need.
 */
class AssetLoader {
  private readonly root: string;
  private readonly emit: HostEmitter;

  constructor(root: string, emit: HostEmitter) {
    this.root = root.endsWith("/") ? root : `${root}/`;
    this.emit = emit;
  }

  /** The URL a path resolves to, without loading it. */
  resolve(path: string): string {
    const relative = path.replace(/^\/+/, "");
    return `${this.root}${relative}`;
  }

  /** Load any asset under the asset root. */
  async load(path: string): Promise<Blob> {
    const url = this.resolve(path);
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      this.emit("asset:loaded", { path, url });
      return blob;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.emit("asset:failed", { path, url, reason });
      throw error;
    }
  }

  /** Load an image under the asset root. */
  async loadImage(path: string): Promise<ImageBitmap> {
    return createImageBitmap(await this.load(path));
  }

  /** Load and decode an audio file under the asset root. */
  async loadAudio(path: string): Promise<AudioBuffer> {
    const blob = await this.load(path);
    const Ctor =
      typeof globalThis.AudioContext === "function"
        ? globalThis.AudioContext
        : null;
    if (Ctor === null) {
      throw new Error(`Cannot decode "${path}": this host has no Web Audio.`);
    }
    return new Ctor().decodeAudioData(await blob.arrayBuffer());
  }
}

/* -------------------------------------------------------------------------- */
/* Events                                                                     */
/* -------------------------------------------------------------------------- */

/** The events the host broadcasts, by name, with the payload each carries. */
export interface HostEventMap {
  /** An asset arrived. */
  "asset:loaded": { path: string; url: string };
  /** An asset was refused or failed to arrive. */
  "asset:failed": { path: string; url: string; reason: string };
  /** A cue played. `t` is frame-loop time; `gain` is `0` while muted. */
  "cue:played": { cue: string; t: number; gain: number };
  /** A user gesture unlocked the audio context. */
  "audio:unlocked": Record<string, never>;
}

/**
 * Subscription to the host's events. Handlers are called synchronously at the
 * moment the event happens, so a subscriber observes the frame the event belongs
 * to and the host retains nothing that grows with the length of a run.
 */
export interface HostEvents {
  /** Subscribe to `event`. Returns the function that removes the handler. */
  on<K extends keyof HostEventMap>(
    event: K,
    handler: (payload: HostEventMap[K]) => void,
  ): () => void;
}

/** How the subsystems announce what they did. */
type HostEmitter = <K extends keyof HostEventMap>(
  event: K,
  payload: HostEventMap[K],
) => void;

/** The event bus: a handler set per event name, and nothing else. */
class EventBus implements HostEvents {
  private readonly handlers = new Map<string, Set<(payload: never) => void>>();

  on<K extends keyof HostEventMap>(
    event: K,
    handler: (payload: HostEventMap[K]) => void,
  ): () => void {
    const set = this.handlers.get(event) ?? new Set<(payload: never) => void>();
    this.handlers.set(event, set);
    set.add(handler as (payload: never) => void);
    return () => {
      set.delete(handler as (payload: never) => void);
    };
  }

  /**
   * Announce `event`. A throwing subscriber is isolated: the host's own frame is
   * not a subscriber's to fail.
   */
  emit<K extends keyof HostEventMap>(event: K, payload: HostEventMap[K]): void {
    const set = this.handlers.get(event);
    if (set === undefined) return;
    for (const handler of [...set]) {
      try {
        (handler as (value: HostEventMap[K]) => void)(payload);
      } catch {
        // A subscriber's failure is the subscriber's.
      }
    }
  }

  /** Drop every handler. */
  clear(): void {
    this.handlers.clear();
  }
}

/* -------------------------------------------------------------------------- */
/* Viewport                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The map from the logical design size onto the canvas's backing store.
 *
 * `scale` and the offsets are in device pixels, with the device pixel ratio
 * folded into `scale`, so a logical point maps to device space as
 * `offsetX + x * scale`.
 */
export interface Viewport {
  /** The logical design width; the game draws in `0..width`. */
  readonly width: number;
  /** The logical design height; the game draws in `0..height`. */
  readonly height: number;
  /** Device pixels per logical unit. */
  scale: number;
  /** The left letterbox bar, in device pixels. */
  offsetX: number;
  /** The top letterbox bar, in device pixels. */
  offsetY: number;
}

/**
 * Where the host reads the drawing surface's size and pixel density, and what it
 * attaches its key listeners to. Every measurement the host would otherwise take
 * from the DOM passes through here, which is what lets it run over a canvas with
 * no document behind it.
 */
export interface SurfaceMetrics {
  /** The element's laid-out width in CSS pixels. */
  cssWidth(): number;
  /** The element's laid-out height in CSS pixels. */
  cssHeight(): number;
  /** Device pixels per CSS pixel. */
  dpr(): number;
  /** The target key events are listened for on. */
  events(): EventTarget;
}

/** A device pixel ratio worth multiplying by; anything else collapses to `1`. */
function normalizeDpr(dpr: number): number {
  return Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
}

/** A non-negative, finite dimension; anything else collapses to `0`. */
function normalizeSize(size: number): number {
  return Number.isFinite(size) && size > 0 ? size : 0;
}

/**
 * The letterboxed, centered, device-pixel-ratio-aware fit of a logical field into
 * an element.
 *
 * The scale is uniform — a single `min` of the two axis ratios — so the aspect
 * ratio holds and the whole field stays visible; the leftover on the long axis is
 * split into two equal bars. A degenerate input yields `scale: 0`, which draws
 * nothing this frame and recovers as soon as the element has a size.
 */
export function fitViewport(
  logicalWidth: number,
  logicalHeight: number,
  cssWidth: number,
  cssHeight: number,
  dpr: number,
): Viewport {
  const ratio = normalizeDpr(dpr);
  const width = normalizeSize(logicalWidth);
  const height = normalizeSize(logicalHeight);
  const availW = normalizeSize(cssWidth);
  const availH = normalizeSize(cssHeight);

  const fit =
    width > 0 && height > 0 && availW > 0 && availH > 0
      ? Math.min(availW / width, availH / height)
      : 0;
  const scale = fit * ratio;

  // Rounded the same way the backing store is sized below, so the two bars really
  // do sum to the drawable area rather than leaving a sub-pixel seam at one edge.
  const deviceW = Math.round(availW * ratio);
  const deviceH = Math.round(availH * ratio);

  return {
    width,
    height,
    scale,
    offsetX: (deviceW - width * scale) / 2,
    offsetY: (deviceH - height * scale) / 2,
  };
}

/* -------------------------------------------------------------------------- */
/* The scoped APIs                                                            */
/* -------------------------------------------------------------------------- */

/** What the game may reach while it initializes. */
export interface InitApi {
  readonly input: {
    /** Register or re-register an action. */
    register(name: string, binding: ActionBinding): void;
    /** The selected touch layout and its vocabulary. */
    layout(): TouchLayout | null;
  };
  readonly audio: {
    /** Declare a synthesized cue under a name. */
    define(cue: string, spec: CueSpec): void;
  };
  readonly assets: {
    /** Load an image under the asset root. */
    loadImage(path: string): Promise<ImageBitmap>;
    /** Load and decode an audio file under the asset root. */
    loadAudio(path: string): Promise<AudioBuffer>;
    /** Load any asset under the asset root. */
    load(path: string): Promise<Blob>;
    /** The URL a path resolves to, without loading it. */
    resolve(path: string): string;
  };
  readonly diagnostics: {
    /** Name a value for the overlay. The source is called on every read. */
    register(name: string, source: () => unknown): void;
  };
  readonly events: HostEvents;
  /** The current logical-to-device fit. */
  viewport(): Viewport;
}

/**
 * What the game may reach while it updates. Nothing here draws, which is what
 * lets a simulation be stepped and inspected with no drawing surface taking part
 * in the result.
 */
export interface UpdateApi {
  readonly input: {
    /** The action's current magnitude. */
    value(name: string): number;
    /** Whether the action was pressed since the last frame. */
    pressed(name: string): boolean;
  };
  readonly audio: {
    /** Play a defined cue. */
    play(cue: string): void;
    /** Mute or unmute the bus. */
    setMuted(muted: boolean): void;
    /** Whether the bus is muted. */
    muted(): boolean;
  };
  /** The frame counter, simulated time, and the most recent step. */
  frame(): FrameInfo;
  /** The current logical-to-device fit. */
  viewport(): Viewport;
}

/**
 * What the game may reach while it renders. Nothing here reads input or plays a
 * cue, so a frame's audible and observable behavior is decided entirely by the
 * update.
 */
export interface RenderApi {
  /** The destination, cleared and already carrying the logical transform. */
  readonly ctx: CanvasRenderingContext2D;
  /** The frame counter, simulated time, and the most recent step. */
  frame(): FrameInfo;
  /** The current logical-to-device fit. */
  viewport(): Viewport;
}

/* -------------------------------------------------------------------------- */
/* The game                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The three functions and the state type the game supplies.
 *
 * `S` is the game's own state, returned by `initialize` and handed back to every
 * `update` and `render`. It is the only channel between the three, so everything
 * a frame needs is reachable from a value the type system already checked.
 */
export interface Game<S> {
  /** Declare the bindings, cues, and diagnostics, and build the state. */
  initialize(api: InitApi): S | Promise<S>;
  /** Advance the simulation by `dt` seconds. */
  update(state: S, api: UpdateApi, dt: number): void;
  /** Draw the state the update left behind. */
  render(state: S, api: RenderApi): void;
}

/* -------------------------------------------------------------------------- */
/* The host                                                                   */
/* -------------------------------------------------------------------------- */

/** What the game hands `createHost`. */
export interface HostOptions<S> {
  /** The canvas the host sizes, clears, and renders through. */
  canvas: HTMLCanvasElement;
  /** The logical design width the game draws in. */
  width: number;
  /** The logical design height the game draws in. */
  height: number;
  /** The game this host drives, bound for the host's lifetime. */
  game: Game<S>;
  /** A CSS color cleared to before every frame; absent clears to transparency. */
  background?: string;
  /** A touch layout from the catalogue, whose vocabulary the game registers. */
  layout?: string;
  /** The clock supplying each frame's delta; defaults to a {@link WallClock}. */
  clock?: Clock;
  /** Where the host reads element size and pixel density. */
  surface?: SurfaceMetrics;
  /** The root every asset path resolves under; defaults to `"assets/"`. */
  assetRoot?: string;
}

/**
 * The host, as the build holds it.
 *
 * Construction runs no game code, so a caller may replace the clock and subscribe
 * to {@link Host.events} before anything the game does is observable.
 */
export interface Host<S> {
  /** Subscribe to host events. Available from construction. */
  readonly events: HostEvents;
  /** The value `initialize` resolved to, live. Throws before then. */
  readonly state: S;
  /** Run the game's `initialize` and resolve to the state it produced. */
  initialize(): Promise<S>;
  /** Drive the game off the host's frame callback until the signal aborts. */
  run(options?: RunOptions): Promise<void>;
  /** Tick the clock `frames` times, running a frame for each tick it accepts. */
  advance(frames: number): Promise<void>;
  /** Replace the clock. The next frame takes its delta from the new one. */
  setClock(clock: Clock): void;
  /** The frame counter, simulated time, and the most recent step. */
  frame(): FrameInfo;
  /** The current logical-to-device fit, as a snapshot the caller owns. */
  viewport(): Viewport;
  /** Every action the game registered, for a reader inspecting the bindings. */
  actions(): RegisteredAction[];
  /** Halt the loop, drop every listener, and release the canvas. */
  destroy(): void;
}

/** The key that toggles the diagnostics overlay. */
const OVERLAY_KEY = "Backquote";

/** The overlay's own drawing metrics, in device-independent CSS pixels. */
const OVERLAY = {
  padding: 8,
  lineHeight: 14,
  fontPx: 11,
  background: "rgba(0, 0, 0, 0.65)",
  color: "#9ef0d6",
} as const;

/** Whether this host has a real frame callback to pump against. */
function hasRaf(): boolean {
  return typeof globalThis.requestAnimationFrame === "function";
}

/**
 * Build a host over `canvas` and bind it to one game.
 *
 * Nothing the game supplies runs here: `initialize` is a separate call, so a
 * caller may install its own clock and subscribe to events first and see
 * everything the game does from its very first frame.
 */
export function createHost<S>(options: HostOptions<S>): Host<S> {
  const { canvas, width, height, game } = options;
  const bus = new EventBus();
  const emit: HostEmitter = (event, payload) => bus.emit(event, payload);

  const surface: SurfaceMetrics = options.surface ?? domSurface(canvas);
  const input = new InputRegistry(surface);
  if (options.layout !== undefined) input.useLayout(options.layout);

  const diagnostics = new Map<string, () => unknown>();
  const assets = new AssetLoader(options.assetRoot ?? DEFAULT_ASSET_ROOT, emit);

  let clock: Clock = options.clock ?? new WallClock();
  let frameCount = 0;
  let accumulatedMs = 0;
  let lastDeltaMs = 0;
  let overlayVisible = false;
  let destroyed = false;
  let live: { value: S } | null = null;
  let viewport = fitViewport(
    width,
    height,
    surface.cssWidth(),
    surface.cssHeight(),
    surface.dpr(),
  );

  const audio = new AudioBus(emit, () => accumulatedMs);

  const context = (): CanvasRenderingContext2D => {
    const ctx = canvas.getContext("2d");
    if (ctx === null) {
      throw new Error("Carom: the canvas has no 2D context");
    }
    return ctx;
  };

  const frame = (): FrameInfo => ({
    count: frameCount,
    timeMs: accumulatedMs,
    lastDeltaMs,
  });

  const currentViewport = (): Viewport => ({ ...viewport });

  /**
   * Resize the backing store to the element's laid-out size and recompute the fit.
   *
   * Run at the top of every frame rather than from a resize observer: the fit
   * depends on the element's size, the device pixel ratio, and the logical field,
   * and re-deriving it costs three reads while a listener would have to be armed,
   * disarmed, and kept in step with the ratio changing under a window moved
   * between displays.
   */
  const syncCanvas = (): void => {
    const cssWidth = surface.cssWidth();
    const cssHeight = surface.cssHeight();
    const dpr = surface.dpr();
    const deviceW = Math.round(normalizeSize(cssWidth) * normalizeDpr(dpr));
    const deviceH = Math.round(normalizeSize(cssHeight) * normalizeDpr(dpr));
    if (canvas.width !== deviceW) canvas.width = deviceW;
    if (canvas.height !== deviceH) canvas.height = deviceH;
    viewport = fitViewport(width, height, cssWidth, cssHeight, dpr);
  };

  const overlayToggle = (event: Event): void => {
    const keyboard = asKeyboardEvent(event);
    if (keyboard === null || keyboard.code !== OVERLAY_KEY) return;
    overlayVisible = !overlayVisible;
  };
  surface.events().addEventListener("keydown", overlayToggle);

  /** Draw the registered diagnostics over the frame just drawn. */
  const drawOverlay = (ctx: CanvasRenderingContext2D): void => {
    if (!overlayVisible) return;
    const info = frame();
    const lines = [
      `frame ${info.count}  dt ${info.lastDeltaMs.toFixed(2)}ms`,
      ...[...diagnostics.entries()].map(
        ([name, source]) => `${name} ${format(readSource(source))}`,
      ),
    ];
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.font = `${OVERLAY.fontPx}px monospace`;
    const boxWidth =
      Math.max(...lines.map((line) => ctx.measureText(line).width)) +
      OVERLAY.padding * 2;
    ctx.fillStyle = OVERLAY.background;
    ctx.fillRect(
      0,
      0,
      boxWidth,
      lines.length * OVERLAY.lineHeight + OVERLAY.padding * 2,
    );
    ctx.fillStyle = OVERLAY.color;
    ctx.textBaseline = "top";
    lines.forEach((line, index) => {
      ctx.fillText(
        line,
        OVERLAY.padding,
        OVERLAY.padding + index * OVERLAY.lineHeight,
      );
    });
    ctx.restore();
  };

  /** One frame: bookkeeping, then update, render, the overlay, and frame end. */
  const runFrame = (deltaMs: number): void => {
    const state = live;
    if (state === null) return;
    frameCount += 1;
    accumulatedMs += deltaMs;
    lastDeltaMs = deltaMs;

    syncCanvas();
    const ctx = context();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (options.background === undefined) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    } else {
      ctx.fillStyle = options.background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.setTransform(
      viewport.scale,
      0,
      0,
      viewport.scale,
      viewport.offsetX,
      viewport.offsetY,
    );

    try {
      // Seconds for the game: every rate a 2D game writes down is per second, and
      // milliseconds invite a factor-of-1000 error in every one of them.
      game.update(state.value, updateApi, deltaMs / 1000);
      game.render(state.value, { ctx, frame, viewport: currentViewport });
      drawOverlay(ctx);
    } finally {
      // An edge nothing consumed is discarded even when the frame threw, so one
      // bad frame cannot leave a press to surface out of order later.
      input.endFrame();
    }
  };

  const updateApi: UpdateApi = {
    input: {
      value: (name) => input.value(name),
      pressed: (name) => input.pressed(name),
    },
    audio: {
      play: (cue) => audio.play(cue),
      setMuted: (muted) => audio.setMuted(muted),
      muted: () => audio.muted(),
    },
    frame,
    viewport: currentViewport,
  };

  const initApi: InitApi = {
    input: {
      register: (name, binding) => input.register(name, binding),
      layout: () => input.layout(),
    },
    audio: { define: (cue, spec) => audio.define(cue, spec) },
    assets: {
      loadImage: (path) => assets.loadImage(path),
      loadAudio: (path) => assets.loadAudio(path),
      load: (path) => assets.load(path),
      resolve: (path) => assets.resolve(path),
    },
    diagnostics: {
      register: (name, source) => {
        diagnostics.set(name, source);
      },
    },
    events: bus,
    viewport: currentViewport,
  };

  // The pump's state. One promise is shared by every live `run` call: a second
  // `run` is a caller asking to wait for the halt, not to start a second pump.
  let running = false;
  let handle: number | null = null;
  let pendingRun: Promise<void> | null = null;
  let settleRun: (() => void) | null = null;
  const unwatch = new Set<() => void>();

  const now = (): number =>
    typeof performance === "undefined" ? Date.now() : performance.now();

  const armFrame = (): void => {
    handle = hasRaf()
      ? globalThis.requestAnimationFrame(pump)
      : (setTimeout(() => pump(now()), 16) as unknown as number);
  };

  const cancelPending = (): void => {
    if (handle === null) return;
    if (hasRaf()) globalThis.cancelAnimationFrame(handle);
    else clearTimeout(handle);
    handle = null;
  };

  const halt = (): void => {
    running = false;
    cancelPending();
    for (const remove of unwatch) remove();
    unwatch.clear();
    const settle = settleRun;
    settleRun = null;
    pendingRun = null;
    settle?.();
  };

  function pump(stamp: number): void {
    handle = null;
    if (!running) return;
    try {
      tick(Number.isFinite(stamp) ? stamp : now());
    } finally {
      // Re-armed in `finally` so a throw out of the game surfaces where it is
      // visible without freezing the game forever on one bad frame.
      if (running && handle === null) armFrame();
    }
  }

  /** Ask the clock what this tick is worth, and run a frame if it is worth one. */
  const tick = (nowMs: number): void => {
    const deltaMs = clock.delta(nowMs);
    if (deltaMs === null) return;
    runFrame(deltaMs);
  };

  const watch = (signal: AbortSignal): void => {
    if (signal.aborted) {
      halt();
      return;
    }
    const onAbort = (): void => halt();
    signal.addEventListener("abort", onAbort, { once: true });
    unwatch.add(() => signal.removeEventListener("abort", onAbort));
  };

  return {
    events: bus,

    get state(): S {
      if (live === null) {
        throw new Error("Carom: the host has not initialized yet");
      }
      return live.value;
    },

    async initialize(): Promise<S> {
      if (live !== null) return live.value;
      audio.armUnlock();
      syncCanvas();
      live = { value: await game.initialize(initApi) };
      return live.value;
    },

    run(runOptions: RunOptions = {}): Promise<void> {
      const promise =
        pendingRun ??
        new Promise<void>((resolve) => {
          settleRun = resolve;
        });
      pendingRun = promise;
      if (!running) {
        running = true;
        armFrame();
      }
      // Watched after arming, so a signal that has already aborted halts the loop
      // it just started rather than leaving a pump running behind a resolved
      // promise.
      if (runOptions.signal) watch(runOptions.signal);
      return promise;
    },

    advance(frames: number): Promise<void> {
      if (!Number.isInteger(frames) || frames < 0) {
        throw new RangeError(
          `advance() needs a whole, non-negative frame count, got ${frames}`,
        );
      }
      for (let i = 0; i < frames; i++) tick(now());
      return Promise.resolve();
    },

    setClock(next: Clock): void {
      clock = next;
    },

    frame,
    viewport: currentViewport,
    actions: () => input.actions(),

    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      halt();
      surface.events().removeEventListener("keydown", overlayToggle);
      input.detach();
      audio.dispose();
      bus.clear();
      diagnostics.clear();
      live = null;
    },
  };
}

/** A diagnostic source's value, with a throwing source reported rather than raised. */
function readSource(source: () => unknown): unknown {
  try {
    return source();
  } catch (error) {
    return error instanceof Error ? `<${error.message}>` : "<error>";
  }
}

/** A diagnostic value as one short line of the overlay. */
function format(value: unknown): string {
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }
  if (typeof value === "string") return value;
  return JSON.stringify(value) ?? String(value);
}

/**
 * The default surface: the canvas element's own laid-out size and the window's
 * pixel ratio, with key events read from the document.
 *
 * The one place this file touches the DOM for a measurement. Every other read
 * goes through {@link SurfaceMetrics}, which is what lets a check drive the host
 * over a canvas with no document behind it.
 */
function domSurface(canvas: HTMLCanvasElement): SurfaceMetrics {
  return {
    cssWidth: () => canvas.clientWidth,
    cssHeight: () => canvas.clientHeight,
    dpr: () => (typeof window === "undefined" ? 1 : window.devicePixelRatio),
    events: () =>
      typeof document === "undefined"
        ? (canvas as unknown as EventTarget)
        : document,
  };
}

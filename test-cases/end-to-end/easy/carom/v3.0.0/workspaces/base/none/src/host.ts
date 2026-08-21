// Carom — the host. CASE-PROVIDED. Do not edit.
//
// This project is built on no engine, so the runtime every browser game needs is
// part of the build and lives here: the frame loop and the delta time it measures,
// fitting the fixed logical field into the canvas (the uniform scale, the centered
// letterbox, the device pixel ratio, and the resync when any of them changes),
// keyboard input as named actions, an audio bus of named cues over Web Audio with
// its first-gesture unlock, asset resolution under a fixed root, the diagnostics
// overlay, and an opt-in draw-command recorder whose recordings replay the frames
// the game drew.
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

/**
 * A 32-bit integer hash of `(seed, index)`.
 *
 * A hash rather than a stateful pseudo-random generator because the draw is
 * *indexed*, not streamed: frame 900's delta must be the same whether it was
 * reached by running 900 frames or asked for directly, and it must survive a
 * frame being run twice or skipped without the whole tail of the sequence
 * shifting. A stream position is one more piece of state that can drift out of
 * step with the frame counter; an index cannot.
 *
 * The avalanche steps — the shift-xor / multiply rounds, in the murmur3 finalizer
 * family — are what stop neighbouring indices, which is all a frame counter ever
 * produces, from yielding neighbouring outputs. Without them the "jitter" is a
 * slow ramp: every frame slightly longer than the last, which is not what a real
 * frame trace looks like and is not the thing a check means to test against.
 */
function hash32(seed: number, index: number): number {
  let h =
    (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(index | 0, 0x85ebca6b)) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  h = Math.imul(h, 0x21f0aaad) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h, 0x735a2d97) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  return h >>> 0;
}

/** The hash as a uniform `[0, 1)` float. */
function unit(seed: number, index: number): number {
  return hash32(seed, index) / 0x1_0000_0000;
}

/**
 * A seeded draw from a range, indexed by frame.
 *
 * The clock that stands in for a real machine under load, and the seed is
 * mandatory rather than optional on purpose. A claim that a build is delta-time
 * independent is worth making only when the failing case replays exactly: an
 * unseeded jitter that fails once in forty runs is indistinguishable from a
 * flaky check, and nobody can act on it. With a seed, the failure is a value to
 * paste into an issue.
 *
 * Equal bounds are allowed and degenerate to a constant, which keeps a
 * parameterized check that sweeps a range down to zero from needing a special
 * case.
 */
export class JitterClock implements Clock {
  private readonly minMs: number;
  private readonly spanMs: number;
  private readonly seed: number;

  /** How many deltas have been drawn — the index the hash is taken over. */
  private index = 0;

  constructor(minMs: number, maxMs: number, seed: number) {
    if (
      !(Number.isFinite(minMs) && minMs > 0) ||
      !(Number.isFinite(maxMs) && maxMs > 0)
    ) {
      throw new RangeError(
        `JitterClock needs positive bounds, got minMs ${minMs} and maxMs ${maxMs}`,
      );
    }
    if (maxMs < minMs) {
      throw new RangeError(
        `JitterClock needs maxMs >= minMs, got minMs ${minMs} and maxMs ${maxMs}`,
      );
    }
    if (!Number.isFinite(seed)) {
      throw new RangeError(`JitterClock needs a finite seed, got ${seed}`);
    }
    this.minMs = minMs;
    this.spanMs = maxMs - minMs;
    this.seed = seed;
  }

  /** A draw from `[minMs, maxMs]`. The host timestamp is not consulted. */
  delta(): number {
    const index = this.index;
    this.index = index + 1;
    return this.minMs + unit(this.seed, index) * this.spanMs;
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
/* Recording                                                                  */
/* -------------------------------------------------------------------------- */
//
// Draw-command recording: the host's flight recorder.
//
// A recording is the list of operations the build issued against its 2D context,
// frame by frame, in the order it issued them. Replaying it re-issues those
// operations against another context and reproduces the picture the build drew —
// so the evidence a reviewer sees is the build's own drawing rather than a
// re-shoot of it.
//
// Three decisions shape the format, and each of them is what makes a later
// property true:
//
// 1. Every frame carries the context state it inherited. A frame's own operations
//    are not enough to draw it: a game that sets `font` once on its first frame
//    relies on the context still carrying it a thousand frames later. Recording
//    the inherited state at the top of each frame makes every frame independently
//    renderable, which is what lets a player seek to frame 900 without replaying
//    the 899 before it. That is the whole reason two recordings can be scrubbed
//    side by side in step.
// 2. Values that are not data are interned, not dropped. A gradient is created
//    through the context and then mutated through the object the context
//    returned, so a recorder that only watched the context would record the
//    creation and miss every colour stop. Anything the context hands back is given
//    an id and wrapped, so calls made on it are recorded against that id and a
//    later use of it as a value records as a reference to it.
// 3. Recording is bracketed by the frame, not by the host's lifetime. The recorder
//    is armed and disarmed by the caller, so a validator records the section of a
//    scenario its check is about and pays nothing for the setup that got there.
//    Nothing accumulates while the recorder is idle.
//
// What is deliberately outside a recording: the diagnostics overlay, which is
// chrome drawn over the finished picture rather than part of it, and anything the
// game draws to a surface of its own rather than through the context the host
// handed it.

/**
 * The version this recorder writes and a player must understand.
 *
 * A reader takes it first and can then refuse a recording it does not know how to
 * draw, rather than drawing a wrong picture confidently. It is bumped whenever the
 * meaning of anything below changes, which is a different event from this build's
 * own version: a recording outlives the run that produced it and is read by a
 * console that was built separately.
 */
export const RECORDING_FORMAT = 1;

/**
 * A value carried inside a recorded operation.
 *
 * Plain data travels as itself. `$ref` names a value an earlier recorded call
 * produced, which is how a gradient created through the context and then filled
 * with colour stops replays as the same gradient. `$opaque` names a value the
 * recorder could not carry, so a player reports the operation it cannot reproduce
 * instead of drawing something else.
 */
export type DrawValue =
  | null
  | boolean
  | number
  | string
  | readonly DrawValue[]
  | { readonly $ref: number }
  | { readonly $opaque: string }
  | { readonly [key: string]: DrawValue };

/**
 * One recorded operation.
 *
 * `target` is absent for an operation the context performed and names an interned
 * value for an operation performed on something the context returned. `id` is
 * present when the call produced a value later operations refer to.
 */
export type DrawOp =
  | {
      readonly op: "call";
      readonly target?: number;
      readonly method: string;
      readonly args: readonly DrawValue[];
      readonly id?: number;
    }
  | {
      readonly op: "set";
      readonly target?: number;
      readonly property: string;
      readonly value: DrawValue;
    };

/**
 * The context state a frame inherited from the frame before it.
 *
 * Recording it is what makes a frame independently renderable: a game that sets a
 * font once relies on the context still carrying it much later, and a player that
 * seeks straight to a frame has no earlier frame to have inherited it from.
 */
export interface DrawState {
  /** The style properties in force, by name. */
  readonly properties: Readonly<Record<string, DrawValue>>;
  /** The transform as `[a, b, c, d, e, f]`, or `null` when unreadable. */
  readonly transform: readonly number[] | null;
  /** The dash pattern, or `null` when unreadable. */
  readonly lineDash: readonly number[] | null;
}

/** One frame of a recording. */
export interface RecordedFrame {
  /** The host's frame counter at this frame. */
  readonly count: number;
  /** Accumulated simulated time through this frame, in milliseconds. */
  readonly timeMs: number;
  /** What this frame was worth, in milliseconds. */
  readonly deltaMs: number;
  /** The canvas backing store this frame was drawn into, in device pixels. */
  readonly surface: { readonly width: number; readonly height: number };
  /** The context state this frame inherited. */
  readonly state: DrawState;
  /** The operations this frame issued, in order. */
  readonly ops: readonly DrawOp[];
}

/**
 * A recorded run of frames.
 *
 * Every frame stands alone, so a player may draw any frame without drawing the
 * ones before it. That is what lets two recordings be scrubbed together in step.
 */
export interface Recording {
  /** The format version a player checks before drawing anything. */
  readonly format: number;
  /** The logical design width the operations were issued in. */
  readonly width: number;
  /** The logical design height the operations were issued in. */
  readonly height: number;
  /** The colour each frame was cleared to, or `null` for transparency. */
  readonly background: string | null;
  /** The frames captured, in order. */
  readonly frames: readonly RecordedFrame[];
}

/**
 * The 2D context properties a frame inherits from the one before it.
 *
 * This is the whole of the canvas state that survives a frame boundary, minus the
 * transform and the dash pattern, which are read through their own accessors
 * below. The list is explicit rather than derived from the context object because
 * enumerating a `CanvasRenderingContext2D` yields its methods too, and because the
 * set has to mean the same thing on a browser context and on the native canvas a
 * validator runs against — where several of these are simply absent.
 */
const STATE_PROPERTIES = [
  "globalAlpha",
  "globalCompositeOperation",
  "filter",
  "imageSmoothingEnabled",
  "imageSmoothingQuality",
  "strokeStyle",
  "fillStyle",
  "shadowOffsetX",
  "shadowOffsetY",
  "shadowBlur",
  "shadowColor",
  "lineWidth",
  "lineCap",
  "lineJoin",
  "miterLimit",
  "lineDashOffset",
  "font",
  "textAlign",
  "textBaseline",
  "direction",
  "letterSpacing",
  "wordSpacing",
  "fontKerning",
] as const;

/** Whether a value can be carried as-is, with no encoding at all. */
function isPrimitive(
  value: unknown,
): value is null | boolean | number | string {
  return (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  );
}

/**
 * The name to report for a value the recorder cannot carry.
 *
 * The constructor name rather than `typeof`, because every interesting case here
 * is an object and "object" tells a reader nothing about which one leaked. A value
 * with no constructor at all still yields a usable label.
 */
function opaqueName(value: unknown): string {
  if (value === undefined) return "undefined";
  const proto = Object.getPrototypeOf(value) as {
    constructor?: { name?: string };
  } | null;
  return proto?.constructor?.name ?? "object";
}

/**
 * The recorder: one instance per host, armed and disarmed by its owner.
 *
 * It wraps the host's context once, at construction, and hands out that wrapper
 * for the host's whole life. A wrapper installed only while recording would be a
 * different object from the one the game may have held on to from an earlier
 * frame, and the game would keep drawing through the unwrapped context it
 * captured — so the identity is stable and the arming is a flag inside it.
 *
 * While disarmed the wrapper forwards and records nothing, so the cost of carrying
 * it is one property lookup and one call per operation.
 */
class ContextRecorder {
  /** The wrapper the host draws through and hands to the game. */
  readonly context: CanvasRenderingContext2D;

  private readonly target: CanvasRenderingContext2D;

  /**
   * Method wrappers, cached by property name.
   *
   * A trap that built a fresh closure per read would allocate one for every draw
   * call of every frame, which for a game issuing a few hundred operations at
   * sixty frames a second is tens of thousands of closures a second thrown away.
   * The wrapper for a given name never varies, so it is built once.
   */
  private readonly methods = new Map<string, (...args: unknown[]) => unknown>();

  /** Ids handed to values the context returned, so a later use records as a ref. */
  private readonly interned = new WeakMap<object, number>();

  /** Wrappers for interned values, so calls made on them are recorded. */
  private readonly wrappers = new WeakMap<object, object>();

  /** The inverse of {@link wrappers}: a wrapper to the object it stands for. */
  private readonly unwrapped = new WeakMap<object, object>();

  private nextId = 0;

  /** The frames closed so far, or `null` while the recorder is disarmed. */
  private frames: RecordedFrame[] | null = null;

  /** The operations of the frame in progress, or `null` between frames. */
  private ops: DrawOp[] | null = null;

  /** The state the open frame inherited, captured when the frame opened. */
  private pendingState: DrawState | null = null;

  /** What the recording says it was drawn at, fixed when the recorder is armed. */
  private design: { width: number; height: number; background: string | null } =
    { width: 0, height: 0, background: null };

  constructor(target: CanvasRenderingContext2D) {
    this.target = target;
    this.context = this.wrap(target) as CanvasRenderingContext2D;
  }

  /** Whether operations are being captured. */
  get active(): boolean {
    return this.frames !== null;
  }

  /**
   * Arm the recorder.
   *
   * The design size and background are taken here rather than read back from the
   * canvas later, because a recording states the coordinate system its operations
   * were issued in and that is the host's fixed logical size, not whatever the
   * element happens to be sized to when the recording is closed.
   */
  start(design: {
    width: number;
    height: number;
    background: string | null;
  }): void {
    this.design = { ...design };
    this.frames = [];
    this.ops = null;
  }

  /** Disarm, and hand back everything captured since {@link start}. */
  stop(): Recording {
    const frames = this.frames ?? [];
    this.frames = null;
    this.ops = null;
    return {
      format: RECORDING_FORMAT,
      width: this.design.width,
      height: this.design.height,
      background: this.design.background,
      frames,
    };
  }

  /**
   * Open a frame.
   *
   * The state snapshot is taken here, before the frame's first operation, so it is
   * the state the frame INHERITED. Taking it after the frame's own sets would
   * record the state the frame left behind, and replaying a frame from that would
   * draw its first operations under its last operation's style.
   */
  beginFrame(): void {
    if (this.frames === null) return;
    this.ops = [];
    this.pendingState = this.snapshotState();
  }

  /**
   * Close a frame and keep it.
   *
   * A frame that opened while the recorder was armed and closes after it was
   * disarmed is dropped rather than kept: the recording it would have joined has
   * already been handed to its caller, and a half-frame appended to nothing is a
   * frame no reader could ask for.
   */
  endFrame(
    info: { count: number; timeMs: number; deltaMs: number },
    surface: { width: number; height: number },
  ): void {
    const frames = this.frames;
    const ops = this.ops;
    const state = this.pendingState;
    this.ops = null;
    this.pendingState = null;
    if (frames === null || ops === null || state === null) return;
    frames.push({
      count: info.count,
      timeMs: info.timeMs,
      deltaMs: info.deltaMs,
      surface: { width: surface.width, height: surface.height },
      state,
      ops,
    });
  }

  /**
   * The inherited canvas state, read defensively.
   *
   * Every read is guarded because the set of properties a context carries is not
   * the same everywhere: a native canvas used by a validator implements most of
   * this list and not all of it, and a browser adds to it over time. A property
   * that is absent, or that throws on read, is omitted — a replay that restores
   * one property fewer draws a slightly different frame, while a recorder that
   * threw here would take the whole run down over a property nobody used.
   */
  private snapshotState(): DrawState {
    const target = this.target as unknown as Record<string, unknown>;
    const properties: Record<string, DrawValue> = {};
    for (const name of STATE_PROPERTIES) {
      try {
        const value = target[name];
        if (value === undefined) continue;
        properties[name] = this.encode(value);
      } catch {
        // A context that refuses to report a property it nominally has is telling
        // us the property is not usable; leaving it out is the same outcome a
        // context that never had it produces.
      }
    }

    let transform: readonly number[] | null = null;
    try {
      const matrix = this.target.getTransform();
      transform = [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f];
    } catch {
      // `getTransform` is the one accessor a very old context may lack. Without it
      // the frame relies on the transform its own operations establish, which for
      // a host-drawn frame is every frame: the clear and the viewport transform
      // happen before the game draws.
    }

    let lineDash: readonly number[] | null = null;
    try {
      lineDash = [...this.target.getLineDash()];
    } catch {
      // As above: absent means "no dash pattern to restore".
    }

    return { properties, transform, lineDash };
  }

  /**
   * Encode one value for the recording.
   *
   * Plain data is carried as itself. A value the context produced is carried as a
   * reference to the operation that produced it, which is what makes a gradient
   * replayable. Anything else is carried as an opaque marker naming its type: a
   * reader can then say which operation it cannot reproduce, instead of a player
   * failing on a value it cannot explain.
   */
  private encode(value: unknown): DrawValue {
    if (isPrimitive(value)) return value;
    if (typeof value === "object") {
      const id = this.interned.get(value as object);
      if (id !== undefined) return { $ref: id };
      if (Array.isArray(value)) return value.map((entry) => this.encode(entry));
      // A plain object — a `DOMMatrix2DInit`, an options bag — travels field by
      // field. Anything with a prototype of its own is a host object, and its
      // fields would not reconstruct it.
      const proto = Object.getPrototypeOf(value) as object | null;
      if (proto === Object.prototype || proto === null) {
        const encoded: Record<string, DrawValue> = {};
        for (const [key, entry] of Object.entries(
          value as Record<string, unknown>,
        )) {
          encoded[key] = this.encode(entry);
        }
        return encoded;
      }
    }
    return { $opaque: opaqueName(value) };
  }

  /** Record an operation, if a frame is open to record it into. */
  private push(op: DrawOp): void {
    this.ops?.push(op);
  }

  /**
   * Intern a value the context produced, so later operations can name it.
   *
   * Only objects are interned, and only while recording: an id handed out while
   * disarmed would refer to a creating operation no recording contains, and a
   * later frame that used the value would replay as a reference to nothing.
   */
  private intern(value: unknown): number | undefined {
    if (this.ops === null) return undefined;
    if (value === null || typeof value !== "object") return undefined;
    const existing = this.interned.get(value);
    if (existing !== undefined) return existing;
    const id = this.nextId++;
    this.interned.set(value, id);
    return id;
  }

  /**
   * Wrap a context or a value it produced.
   *
   * `target` is `undefined` for the context itself and an interned id for anything
   * else, which is exactly the distinction an operation carries: an operation with
   * no target is one the context performed, and one with a target is an operation
   * performed on a value the context handed out.
   */
  private wrap(object: object, target?: number): object {
    const cached = this.wrappers.get(object);
    if (cached !== undefined) return cached;

    const methods =
      target === undefined
        ? this.methods
        : new Map<string, (...args: unknown[]) => unknown>();
    const proxy = new Proxy(object, {
      get: (subject, property): unknown => {
        const value = Reflect.get(subject, property, subject) as unknown;
        if (typeof value !== "function") return value;
        const name = String(property);
        const cachedMethod = methods.get(name);
        if (cachedMethod !== undefined) return cachedMethod;
        const method = (...args: unknown[]): unknown => {
          // Arguments are unwrapped on the way in and encoded from the unwrapped
          // values: a game that passes back a gradient passes the wrapper it was
          // handed, and a native method refuses a proxy where it expects one of
          // its own objects.
          const real = args.map((arg) => this.unwrap(arg));
          // Applied to the real subject, never to the proxy: a native canvas
          // method called with a proxy as its receiver throws, because the
          // internal slots it needs are on the object itself.
          const result = (value as (...rest: unknown[]) => unknown).apply(
            subject,
            real,
          );
          if (this.ops === null) return result;
          const id = this.intern(result);
          this.push({
            op: "call",
            ...(target === undefined ? {} : { target }),
            method: name,
            args: real.map((arg) => this.encode(arg)),
            ...(id === undefined ? {} : { id }),
          });
          // Hand back the wrapper rather than the value, so calls made on what the
          // context returned are recorded too. The value is interned first, so the
          // wrapper and the id name the same thing.
          return id === undefined ? result : this.wrap(result as object, id);
        };
        methods.set(name, method);
        return method;
      },
      set: (subject, property, value): boolean => {
        // The recorded value is encoded before the assignment rather than after,
        // because a context normalizes what it is given — a colour written as
        // `#fff` reads back as `#ffffff` — and the recording states what the build
        // did, not what the context made of it.
        if (this.ops !== null) {
          this.push({
            op: "set",
            ...(target === undefined ? {} : { target }),
            property: String(property),
            value: this.encode(this.unwrap(value)),
          });
        }
        return Reflect.set(subject, property, this.unwrap(value), subject);
      },
    });
    this.wrappers.set(object, proxy);
    // The wrapper is registered against itself as well, so a value that reaches the
    // recorder already wrapped is not wrapped a second time, and against the object
    // it stands for, so a wrapper handed back to the context is unwrapped again.
    this.wrappers.set(proxy, proxy);
    this.unwrapped.set(proxy, object);
    return proxy;
  }

  /**
   * The real object behind a wrapper, if this is one.
   *
   * A game that assigns a gradient to `fillStyle` assigns the wrapper it was
   * handed, and a native context refuses a proxy where it expects one of its own
   * objects. Unwrapping on the way in keeps the wrapping invisible to the context
   * while leaving it visible to the recorder.
   */
  private unwrap(value: unknown): unknown {
    if (value === null || typeof value !== "object") return value;
    const real = this.unwrapped.get(value);
    return real ?? value;
  }
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
  /** Whether draw-command recording is currently capturing. */
  recording(): boolean;
  /**
   * Begin capturing draw commands. Capture starts at the next frame, so a caller
   * that arms the recorder from inside a frame records whole frames only.
   */
  startRecording(): void;
  /** Stop capturing and hand back everything captured since `startRecording`. */
  stopRecording(): Recording;
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

  /**
   * The flight recorder, built over the drawing context the first time anything
   * needs one and held for the rest of the host's life.
   *
   * Built lazily, because the canvas is not asked for a context until something
   * draws — but built exactly ONCE, because the wrapper it hands out has to be the
   * same object every frame: a game that holds on to the context it was given on
   * its first frame would otherwise keep drawing through a wrapper the recorder
   * had stopped watching.
   *
   * Everything drawn as part of a frame goes through that wrapper — the host's own
   * clear and viewport transform as well as the game's render — because the blank
   * page a frame starts from is part of the picture a replay has to reproduce.
   */
  let recorder: ContextRecorder | null = null;
  const flightRecorder = (): ContextRecorder => {
    recorder ??= new ContextRecorder(context());
    return recorder;
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
    const record = flightRecorder();
    // The frame opens BEFORE the clear and the viewport transform, so both are
    // recorded as part of it and a replayed frame starts from the same blank page
    // the original did.
    record.beginFrame();
    const ctx = record.context;
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
      // Closed at the end of the render and before the overlay, so the overlay
      // stays out of the recording: it is chrome laid over the finished picture,
      // and baking a debug panel into a reviewer's evidence would misreport what
      // the game drew. Drawn through the raw context for the same reason.
      record.endFrame(
        { count: frameCount, timeMs: accumulatedMs, deltaMs },
        { width: canvas.width, height: canvas.height },
      );
      drawOverlay(context());
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

    // A host that has never drawn has no recorder yet, and it is certainly not
    // capturing — so the question is answered without building one.
    recording: (): boolean => recorder?.active ?? false,

    /**
     * Arm the recorder, so the frames from here on are captured.
     *
     * Capture begins at the next frame rather than part-way through the current
     * one. A recorder armed from inside an `update` would otherwise open a frame
     * whose clear and viewport transform had already happened, and replaying that
     * frame would draw the game's own operations onto whatever the player's canvas
     * already held.
     *
     * A second call while already recording is refused rather than silently
     * discarding what has been captured: the mistake is always an unbalanced
     * `stopRecording`, and a caller told about it loses nothing, while a caller
     * handed an empty recording has lost the frames its check was about.
     */
    startRecording(): void {
      const record = flightRecorder();
      if (record.active) {
        throw new Error(
          "Carom: startRecording() was called while already recording; call stopRecording() first",
        );
      }
      record.start({
        width,
        height,
        background: options.background ?? null,
      });
    },

    /**
     * Disarm the recorder and hand back what it captured.
     *
     * Refuses when nothing is being recorded, for the same reason `startRecording`
     * refuses a second arming: an empty recording returned from an unbalanced call
     * reads as "the game drew nothing", which is a claim about the build rather
     * than about the caller.
     */
    stopRecording(): Recording {
      const record = flightRecorder();
      if (!record.active) {
        throw new Error(
          "Carom: stopRecording() was called while not recording; call startRecording() first",
        );
      }
      return record.stop();
    },

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

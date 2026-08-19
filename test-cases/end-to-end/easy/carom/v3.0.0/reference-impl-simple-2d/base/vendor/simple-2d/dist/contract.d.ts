/**
 * The vocabulary shared by the engine's subsystems and by its host interface.
 *
 * These types are declared once, here, rather than beside the subsystem that owns
 * each one, because almost every one of them is spoken by *both* sides of the
 * package: the game-facing API (`createEngine`) accepts them, and the host
 * interface (`window.__tcabEngine`, the `./host` export) returns them to a driver.
 * Keeping the declarations in a leaf module with no imports means the two entry
 * points cannot drift apart, and that `./host` can be consumed for its types alone
 * — by a validation script or a driver — without pulling in the engine
 * implementation.
 *
 * Everything here is data: plain structural types, no classes and no behaviour, so
 * a value crossing the `window` boundary into a driver survives structured cloning
 * and JSON serialization unchanged.
 */
/**
 * Whether an action reports a continuous magnitude or a plain on/off.
 *
 * The distinction exists because a game reads the two differently: an `analog`
 * action is sampled every frame for its `value` (a touch slider, a held direction
 * ramping to full tilt), while a `digital` action is usually consumed as an edge —
 * "was fire pressed since the last frame". Declaring the kind up front lets the
 * engine decide what a keyboard binding means for that action instead of forcing
 * every game to reinvent the mapping.
 */
export type ActionKind = "digital" | "analog";
/**
 * What a game supplies when it registers an action: the keyboard codes that drive
 * it, and optionally how it should be interpreted.
 *
 * `keys` are `KeyboardEvent.code` values (`"ArrowUp"`, `"KeyW"`) rather than
 * `key` values, so a binding is layout-independent — `KeyW` is the same physical
 * key on QWERTY and AZERTY, which matters for the WASD cluster.
 */
export interface ActionBinding {
    /** The `KeyboardEvent.code` values that drive this action. */
    keys: string[];
    /** How the action is interpreted; defaults to `"digital"`. */
    kind?: ActionKind;
}
/**
 * An action as the engine holds it, with every default resolved.
 *
 * This is the shape the host interface hands back from `actions()`, and it is
 * deliberately the *complete* record rather than an echo of the binding: a driver
 * confirming that a build registered and bound everything it was asked to needs to
 * read the resolved `kind` and the `layout` the action came from, neither of which
 * the game necessarily wrote down. Because it is a static read, checking the
 * bindings takes no simulated keystrokes at all.
 */
export interface RegisteredAction {
    /** The action's name, as the game registered it and reads it back. */
    name: string;
    /** The resolved `KeyboardEvent.code` bindings. */
    keys: string[];
    /** The resolved kind — never absent here, unlike on {@link ActionBinding}. */
    kind: ActionKind;
    /**
     * The touch layout this action belongs to, or `null` for an action the game
     * registered itself beyond the layout's vocabulary.
     */
    layout: string | null;
}
/** A manual clock that steps by the same amount every frame. */
export interface ScheduleFixed {
    kind: "fixed";
    /** The delta time, in milliseconds, handed to every frame. */
    stepMs: number;
}
/**
 * A manual clock that walks a fixed list of deltas, cycling once it runs off the
 * end. This is how an uneven but *reproducible* frame pattern is expressed — a
 * long frame every so often, a stutter, a burst of short frames.
 */
export interface ScheduleSequence {
    kind: "sequence";
    /** The deltas in milliseconds, replayed in order and then repeated. */
    stepsMs: number[];
}
/**
 * A manual clock that draws each delta uniformly from `[minMs, maxMs]`.
 *
 * The `seed` is required, not optional: the point of driving a build off a jittery
 * clock is to show that its simulation is delta-time independent, and a claim like
 * that is only worth making if the failing case can be replayed exactly.
 */
export interface ScheduleJitter {
    kind: "jitter";
    /** The shortest delta, in milliseconds. */
    minMs: number;
    /** The longest delta, in milliseconds. */
    maxMs: number;
    /** Seeds the engine's PRNG so a run is reproducible. */
    seed: number;
}
/** The delta-time pattern a manual clock advances on. */
export type Schedule = ScheduleFixed | ScheduleSequence | ScheduleJitter;
/**
 * Where the frame loop's time comes from.
 *
 * `"auto"` is the wall clock driving `requestAnimationFrame` — what a human
 * playing the game gets. `"manual"` hands the clock to the host interface, so
 * `advance(steps)` runs exactly that many frames synchronously off the current
 * {@link Schedule}. A validation script counting ticks therefore counts frames,
 * with no real time elapsing and no waiting.
 */
export type ClockMode = "auto" | "manual";
/**
 * The frame loop's position, as the host interface reports it.
 *
 * `count` is the tick unit a validation script asserts against; `timeMs` is the
 * accumulated simulated time (which under a manual clock is the sum of the
 * scheduled deltas, not elapsed wall time); `lastDeltaMs` is what the most recent
 * frame was actually stepped by, which is how a driver confirms a schedule took
 * effect.
 */
export interface FrameInfo {
    /** Frames run since the loop started. */
    count: number;
    /** Total simulated time in milliseconds. */
    timeMs: number;
    /** The delta the most recent frame was stepped by, in milliseconds. */
    lastDeltaMs: number;
}
/**
 * The synthesis description behind a named audio cue.
 *
 * Cues are *synthesized*, not sampled, so a game gets sound without shipping audio
 * assets and without touching Web Audio itself — the engine owns the graph and the
 * first-interaction unlock. Keeping the description this small (one oscillator, a
 * frequency sweep, a gain envelope, a duration) is the point: it covers the bleeps
 * a 2D game needs, and anything richer is out of scope by design.
 */
export interface CueSpec {
    /** The oscillator waveform; defaults to a sine. */
    wave?: "sine" | "square" | "sawtooth" | "triangle";
    /** The starting frequency in hertz. */
    freq: number;
    /** The frequency to sweep to over the cue's duration; absent holds `freq`. */
    freqTo?: number;
    /** Peak gain in `[0, 1]`; defaults to the engine's cue gain. */
    gain?: number;
    /** How long the cue sounds, in milliseconds. */
    durationMs: number;
}
/**
 * One entry in the cue log — a *semantic* record that a named cue played, rather
 * than anything about the audio graph.
 *
 * This is what makes audio checkable at all: asserting that a bounce made a noise
 * means reading this log, not analyzing samples, and it works identically under a
 * muted engine and in a headless browser where nothing is audible.
 */
export interface CueEvent {
    /** The cue name that was played. */
    cue: string;
    /** The frame-loop time in milliseconds at which it played. */
    t: number;
    /** The gain it played at — `0` while muted, so a mute is visible in the log. */
    gain: number;
}
/**
 * The audio bus's two observable bits.
 *
 * `unlocked` is separate from `muted` because browsers refuse to start an audio
 * context before a user gesture: a silent game may be silent because the player
 * muted it, or because nothing has been clicked yet, and only the second is a bug.
 */
export interface AudioState {
    /** Whether the game (or the player) has muted the bus. */
    muted: boolean;
    /** Whether a user gesture has unlocked the audio context yet. */
    unlocked: boolean;
}
/**
 * One entry in the asset log: a path the game asked for, the URL it resolved to
 * under the fixed asset root, and whether the load succeeded.
 *
 * Logging `ok` rather than throwing on a miss keeps a broken asset from taking the
 * whole game down, while still making the miss plainly visible to a driver — a
 * game that silently renders nothing is otherwise indistinguishable from one that
 * renders correctly off-screen.
 */
export interface AssetEvent {
    /** The path the game passed to `assets.load`, relative to the asset root. */
    path: string;
    /** The URL it resolved to. */
    url: string;
    /** Whether the load succeeded. */
    ok: boolean;
}
/**
 * A touch layout: the name of a control scheme and the action vocabulary it brings
 * with it.
 *
 * The catalogue is closed, and a layout carries its `actions` so that naming one
 * settles the vocabulary the build is expected to speak. Selection is declarative:
 * it neither draws controls nor registers actions, it tags the actions the game
 * registers, so a driver can read back exactly which vocabulary is live.
 */
export interface TouchLayout {
    /** The layout's name, e.g. `"dual-vertical"`. */
    name: string;
    /** The action names the layout provides, including the universal menu actions. */
    actions: string[];
}
/**
 * The two functions a game hands to the frame loop.
 *
 * They are split rather than merged into one `frame(dt, ctx)` because they are
 * stepped independently: a manual clock advances `update` per scheduled step,
 * and the separation is what lets a game be checked for delta-time independence
 * without its rendering being involved at all.
 */
export interface FrameCallbacks {
    /** Advances the simulation by `dt` **seconds** — real elapsed time, clamped. */
    update(dt: number): void;
    /** Draws the frame into the engine's letterboxed, scaled 2D context. */
    render(ctx: CanvasRenderingContext2D): void;
}

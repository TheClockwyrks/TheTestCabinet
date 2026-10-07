// What this package knows about an engine, and how little that is.
//
// THE PACKAGE DEPENDS ON NO ENGINE. There are four of them — `simple-2d`,
// `structured-2d`, `simple-3d`, `structured-3d` — and a case's validator project
// has exactly one on its import graph. If this package named one, every case on
// the other three would carry it into its project for nothing, and a fifth engine
// would mean editing this package to add it.
//
// So every type below is STRUCTURAL: it says what shape the kit reaches for, and
// an engine's own type satisfies it by having those members. Nothing here is
// imported from an engine, nothing here is exported to one, and a case hands the
// kit its engine's real objects — `createEngine`, `ConstantClock`, the game
// definition — as VALUES through {@link EngineCaseConfig}. That is the same rule
// the engineless half lives by, one level up: types by generics, values by config.
//
// WHAT IS ACTUALLY IDENTICAL ACROSS THE FOUR. Member for member: `Clock`,
// `SurfaceMetrics`, `Viewport`, `RunOptions`, the five asset and cue events, and
// the engine methods `events`, `debug`, `run`, `advance`, `setClock`, `frame`,
// `viewport`, `diagnostics`, `recording`, `startRecording`, `destroy`. Those are
// the members below, and they are why one kit can serve all four.
//
// THE THREE PLACES THEY SPLIT are deliberately NOT in this file, because each is
// a decision the case makes and hands over:
//
//   1. THE STATE MODEL. A simple engine's `Engine<S, D>` carries `state` and
//      `apply`; a structured engine's `Engine<D>` carries `instance`, `world` and
//      `renderer`. Neither appears here. What the kit needs off a surface arrives
//      through `EngineCaseConfig.driver` — see `./driver`, which ships the three
//      strategies those two models produce.
//   2. RECORDING. A 2D engine's `stopRecording()` answers a draw-op log
//      synchronously; a 3D engine's answers a promise of VP9 video. So
//      {@link RecordingEngine} — the 2D one — lives beside the 2D replay stack in
//      `./replay`, and the neutral {@link DrivenEngine} below declares neither.
//   3. THE PROJECTION. Four distinct bodies map a logical point to a device
//      pixel, so the kit takes one: `EngineCaseConfig.toLogical`.
//
// Everything in this file is dimension-neutral. A 3D case reaches it without
// touching a single line of the 2D readings, and a 2D case without the WebGL stub.

import type { Point } from "../point";

/**
 * What each frame is worth, in milliseconds — the engines' `Clock`, member for
 * member.
 *
 * `null` declines the tick, which is how a clock paces below the rate its ticks
 * arrive at. `rewind` is the package's own optional extension (see `../clock`)
 * and no engine requires it, so it is optional here too: a case's hand-written
 * clock implements `delta` and nothing else and still satisfies this.
 */
export interface EngineClock {
  /** This tick's delta in milliseconds, or `null` when the tick is not a frame. */
  delta(nowMs: number): number | null;
  /** Give `frames` deltas back, so a sweep that stopped early can be replayed. */
  rewind?(frames: number): void;
}

/**
 * The map from the case's logical design size onto the canvas's backing store —
 * the engines' `Viewport`, member for member.
 *
 * `scale` and the offsets are DEVICE pixels, with the device pixel ratio folded
 * into `scale`, so a logical point maps to device space as `offsetX + x * scale`.
 * That is the arithmetic {@link EngineHarnessBase.device} repeats.
 *
 * NOT THE PACKAGE'S OWN `Viewport`, which carries a second CSS-pixel trio the
 * engines do not report. The kit answers the engine's own fit rather than one it
 * recomputed, because under an engine the fit IS the engine's — asking the engine
 * is asking the authority, and recomputing it would be grading the engine against
 * this package.
 */
export interface EngineViewport {
  readonly width: number;
  readonly height: number;
  /** Device pixels per logical unit. */
  scale: number;
  /** The letterbox bars, in device pixels. */
  offsetX: number;
  offsetY: number;
}

/**
 * Where an engine reads the drawing surface's size and density, and what it
 * attaches its listeners to — the engines' `SurfaceMetrics`.
 *
 * The optional four are the superset across the four engines. A surface with no
 * element behind it — which is every surface this kit builds — owns no browser
 * gestures and captures no pointers, so it omits them, and an engine that reads
 * for them finds them absent and falls back exactly as it does in a run.
 */
export interface EngineSurfaceMetrics {
  cssWidth(): number;
  cssHeight(): number;
  dpr(): number;
  events(): EventTarget;
  origin?(): Point;
  claimGestures?(): () => void;
  capturePointer?(pointerId: number): void;
  releasePointerCapture?(pointerId: number): void;
}

/** The frame loop's position — the engines' `FrameInfo`. */
export interface EngineFrameInfo {
  /** Frames run since the loop started, 1-based once a frame has run. */
  count: number;
  /** Accumulated simulated time, the sum of the deltas delivered. */
  timeMs: number;
  /** What the most recent frame was stepped by. */
  lastDeltaMs: number;
}

/** One cue firing, as every engine announces it on `cue:played`. */
export interface CuePayload {
  cue: string;
  /** The frame loop's simulated time when it played, in milliseconds. */
  t: number;
  /** The cue's gain: zero while the bus is muted, positive otherwise. */
  gain: number;
}

/** One asset that never arrived, as every engine announces it on `asset:failed`. */
export interface AssetFailurePayload {
  path: string;
  url?: string;
  reason: string;
}

/**
 * The five events all four engines carry, with the payload each hands over.
 *
 * The engines each broadcast more than these — a structured engine also announces
 * worlds opening, actors spawning and collisions — but those are the parts of the
 * four contracts that DIFFER, so nothing shared may name them. A case that wants
 * one reaches its own engine's events through `EngineHarness.engine`, where the
 * engine's own types apply.
 */
export interface EngineEventMap {
  "asset:loaded": { path: string; url: string };
  "asset:failed": AssetFailurePayload;
  "cue:played": CuePayload;
  "cue:looped": CuePayload;
  "cue:stopped": { cue: string; t: number };
}

/**
 * Subscription to an engine's events.
 *
 * A handler runs SYNCHRONOUSLY at the moment the event happens, which is what
 * lets a cue be stamped with the frame that was still running when it sounded
 * rather than with one inferred afterwards.
 */
export interface EngineEvents {
  /** Subscribe to `event`. Returns the function that removes the handler. */
  on<K extends keyof EngineEventMap>(
    event: K,
    handler: (payload: EngineEventMap[K]) => void,
  ): () => void;
}

/**
 * As much of an engine as the neutral kit drives.
 *
 * Every member here is present, with this signature, on all four engines. `debug`
 * is `unknown` rather than the case's surface type because what a check holds the
 * surface to is the CASE's `surface.ts` and never the type the build declared —
 * see `./surface`, which reads it off here and narrows it.
 */
export interface DrivenEngine {
  readonly events: EngineEvents;
  readonly debug: unknown;
  advance(frames: number): Promise<void>;
  setClock(clock: EngineClock): void;
  frame(): EngineFrameInfo;
  viewport(): EngineViewport;
  diagnostics(): readonly unknown[];
  recording(): boolean;
  startRecording(): void;
  destroy(): void;
}

/** How far a sweep may run, and how many frames separate two samples. */
export interface UntilOptions {
  /** The bound, in frames. */
  maxFrames?: number;
  /** The same bound, for a suite that counts in ticks. */
  maxTicks?: number;
  /** How many frames to run between two samples of the predicate. */
  poll?: number;
}

/**
 * What a sweep found: whether the predicate ever held, and where it stopped.
 *
 * `frames` and `ticks` are ONE counter under two names, exactly as the engineless
 * half's `UntilResult` carries them. The engine harnesses disagreed about which
 * word to use — some count `.frames`, some `.ticks` — and folding them would have
 * silently rewritten one vocabulary's call sites, so both ship and each suite
 * reads the word it was written in.
 */
export interface UntilResult<S> {
  hit: boolean;
  /** Frames run before the sample that ended the sweep. */
  frames: number;
  /** The same count, for a suite that counts in ticks. */
  ticks: number;
  snapshot: S;
}

/** How far a sweep runs when the caller names no bound. */
export const DEFAULT_MAX_FRAMES = 600;

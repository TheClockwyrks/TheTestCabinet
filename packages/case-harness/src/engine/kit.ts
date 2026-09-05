// One case, one engine, one call: the shared engine harness bound to both.
//
// TYPES BY GENERICS, VALUES BY CONFIG — the same rule `../kit` lives by, one
// level over. A case says what its snapshot, its driver and its engine ARE as
// type arguments, and hands over everything else about itself in one object; what
// comes back is this package's machinery under the case's own names and types.
//
// AND ONE MORE RULE THIS HALF ADDS: THE ENGINE ARRIVES AS VALUES TOO. There are
// four engines and a case's project has exactly one on its import graph, so this
// package names none of them. `createEngine`, the clock, the game definition, the
// background, the layout — all of it is closed over by the CASE and handed here
// as functions. What this file knows about an engine is the structural contract
// in `./contract`, and a fifth engine would need no change to this package at all.
//
// ```ts
// // validation/structured-2d/harness.ts
// const kit = createEngineCaseHarness<RefractSnapshot, RefractDriver, RefractEngine>({
//   slug: "refract",
//   projectRoot: dirname(fileURLToPath(import.meta.url)),
//   stage: { width: STAGE_W, height: STAGE_H },
//   tickHz: TICK_HZ,
//   surfaceRequirement: SURFACE_REQUIREMENT,
//   recorder: { measureText: true },
//   defaultClock: () => new ConstantClock(TICK_MS),
//   createEngine: ({ canvas, clock, surface }) =>
//     createEngine<RefractSurface>({ canvas, width: STAGE_W, height: STAGE_H,
//       game, background: BACKGROUND, layout: LAYOUT, clock, surface }),
//   driver: (_engine, raw) => identityDriver(raw as RefractSurface),
//   snapshot: (debug) => projectCells(debug.snapshot()),
// });
// ```
//
// WHAT IS NOT HERE, AND WHY. Every scenario helper — `loadBoard`, `startCampaign`,
// `solveGenerated` — stays with the case. Those pose the case's own game through
// the case's own surface, and there is nothing shared about them; a kit that
// swallowed them would be a kit with one user. What is shared is the frame, the
// canvas, the recorder, the surface, the driver, the sweep, the cues and the
// evidence, and that is what this returns.

import { makeTickMath, type TickMath } from "../clock";
import type { Stage } from "../config";
import type { DrawCall } from "../draw-calls";
import type { Pixel } from "../pixels";
import type { Point } from "../point";
import {
  createRecordingCanvas,
  type ImageSources,
  type RecorderOptions,
} from "./canvas";
import {
  DEFAULT_MAX_FRAMES,
  type AssetFailurePayload,
  type CuePayload,
  type DrivenEngine,
  type EngineClock,
  type EngineSurfaceMetrics,
  type EngineViewport,
  type UntilOptions,
  type UntilResult,
} from "./contract";
import {
  DevicePointerEvent,
  KeyEvent,
  PointerPositionEvent,
  breathe,
  surfaceMetrics,
  type PointerEventType,
  type SurfaceShape,
} from "./events";
import { captureOutputSync } from "./capture";
import { deviceOf, pixelAt } from "./read";
import { readDebugSurface } from "./surface";

/* -------------------------------------------------------------------------- */
/* What a check reads                                                         */
/* -------------------------------------------------------------------------- */

/** One cue the build played, as the engine announced it. */
export interface PlayedCue {
  cue: string;
  /** The frame loop's simulated time when it played, in milliseconds. */
  t: number;
  /** The cue's gain: zero while the bus is muted, positive otherwise. */
  gain: number;
}

/**
 * A cue, stamped with the frame it sounded on.
 *
 * A SUPERSET OF {@link PlayedCue} AND OF THE ENGINELESS HALF'S `TimedCue`, rather
 * than a third shape. Every engine publishes `cue:played` SYNCHRONOUSLY from
 * inside the play call, so the handler runs while the frame that played it is
 * still running and the engine's own frame counter is that frame's number — which
 * is what makes the stamp exact rather than inferred.
 *
 * `frame` and `tick` are ONE counter under two names, exactly as
 * {@link UntilResult}'s two counts are: the harnesses disagreed about which word
 * to use and folding them would have rewritten one vocabulary's call sites.
 */
export interface TimedCue extends PlayedCue {
  /** The frame it sounded on, 1-based, as the engine's frame counter reports. */
  frame: number;
  /** The same frame, for a suite that counts in ticks. */
  tick: number;
  /** Whether the firing STARTED A LOOP rather than played once. */
  looped: boolean;
}

/** One asset the build asked for and did not get. */
export interface AssetFailure {
  path: string;
  reason: string;
}

/** The window the harness reports to the engine, and the pixel density of it. */
export interface EngineHarnessOptions {
  /** The clock each frame takes its delta from. Defaults to the case's rate. */
  clock?: EngineClock;
  /** The element's laid-out CSS width. Defaults to the logical stage width. */
  cssWidth?: number;
  /** The element's laid-out CSS height. Defaults to the logical stage height. */
  cssHeight?: number;
  /** Device pixels per CSS pixel. Defaults to 1, so one device pixel is one unit. */
  dpr?: number;
}

/**
 * Everything a check reads off one engine running one build.
 *
 * `S` is the case's snapshot, `D` its driver — the surface as a check calls
 * it — and `E` the engine's own type, which is the case's to name because it is
 * the engine's. Nothing here interprets any of the three.
 *
 * Every member is declared as a METHOD rather than as a property holding a
 * function, so a case may hand one to a helper typed over a looser harness.
 */
export interface EngineHarness<S, D, E> {
  /** The engine itself, for everything this interface deliberately does not wrap. */
  readonly engine: E;
  /** The debug surface the build returned, as a check calls it. */
  readonly debug: D;
  /** The real 2D context, for `getImageData`. Draw calls also reach it. */
  readonly ctx: import("@napi-rs/canvas").SKRSContext2D;
  /** The surface the engine drew into, holding the last frame that ran. */
  readonly canvas: import("@napi-rs/canvas").Canvas;
  /** Every call and property set the render made, oldest first. */
  readonly calls: DrawCall[];
  /** Every cue the build played, oldest first, each stamped with its frame. */
  readonly cues: TimedCue[];
  /** Every asset the build failed to load, oldest first. */
  readonly assetFailures: AssetFailure[];
  /** The real bitmap behind each interned image id, when the case interns. */
  readonly images: ImageSources;
  /**
   * The event target the surface hands the engine — where its own input system
   * attached its key and pointer listeners.
   *
   * {@link hold}, {@link release} and {@link tap} are the keyboard side of it and
   * {@link pointer} the pointer side; it stays exposed for a check that needs to
   * raise some other event on the same target.
   */
  readonly events: EventTarget;
  /** The window this harness reports, and the density it reports it at. */
  readonly shape: SurfaceShape;

  /** A fresh read of the game's state through the case's `snapshot`. */
  snapshot(): S;
  /** The engine's frame counter, 1-based once a frame has run. */
  frame(): number;
  /** The same counter, for a suite that counts in ticks. */
  tick(): number;
  /** The simulated time those frames covered, in milliseconds. */
  timeMs(): number;
  /** Run `frames` frames back to back. */
  advance(frames: number): Promise<void>;
  /** Advance until `predicate` holds, sampling every `poll` frames. */
  until(
    predicate: (snapshot: S) => boolean,
    options?: UntilOptions,
  ): Promise<UntilResult<S>>;

  /** Press a key and leave it down, as a player holding it would. */
  hold(code: string): void;
  /** Release a key held by {@link hold}. */
  release(code: string): void;
  /** Press and release a key, then run the one frame that delivers its edge. */
  tap(code: string): Promise<void>;

  /**
   * Dispatch a REAL pointer event at a logical point, through the engine's own
   * pointer input — the player's path, where the sample is read by the next
   * frame's update — as opposed to a debug surface's pointer operations, which
   * are immediate poses. Advance a frame after dispatching for the game to read
   * it.
   */
  pointer(type: PointerEventType, x: number, y: number, device?: string): void;

  /** The engine's own logical-to-device fit, as it stands. */
  viewport(): EngineViewport;
  /** Where a logical point lands in the canvas's backing store. */
  device(x: number, y: number): Point;
  /** The device pixel under a logical point, as `[r, g, b, a]`. */
  pixel(x: number, y: number): Pixel;

  /** Halt the loop and drop the engine's listeners. */
  dispose(): void;
}

/* -------------------------------------------------------------------------- */
/* What a case says about itself                                              */
/* -------------------------------------------------------------------------- */

/** What the harness builds and hands the case's engine factory. */
export interface EngineParts {
  /** The recording canvas, dressed as the element an engine takes. */
  canvas: HTMLCanvasElement;
  /** The clock the caller chose, or the case's default. */
  clock: EngineClock;
  /** The metrics the engine takes every measurement through. */
  surface: EngineSurfaceMetrics;
  /** The window and density those metrics report. */
  shape: SurfaceShape;
}

/**
 * How a logical point becomes the client position a pointer event reports.
 *
 * TWO SPELLINGS SHIP AND THEY ARE NOT THE SAME GESTURE, by up to half a device
 * pixel on each axis:
 *
 *   - `"exact"` maps the point straight through the fit. The event lands where
 *     the caller asked, and a check measuring how a build resolves a sub-pixel
 *     position reads what it posed.
 *   - `"device-pixel"` rounds to the pixel a READING would sample first, then
 *     divides by the ratio. The gesture and the pixel a check samples afterwards
 *     are then the same place, which is what a check comparing "where I pressed"
 *     against "what is drawn there" wants.
 *
 * Half a pixel decides a point whenever a build's hit radius passes through it,
 * so neither can stand in for the other and a case binds the one its verdicts
 * were taken under.
 */
export type PointerPrecision = "exact" | "device-pixel";

/** Everything this package needs to know about one case on one engine. */
export interface EngineCaseConfig<S, D, E, X = unknown> {
  /** The case's slug, which names it in anything this package writes or warns. */
  slug: string;
  /**
   * The case's own validator-project directory — `dirname(fileURLToPath(
   * import.meta.url))` in its `harness.ts`, and never derived here.
   *
   * This package is staged one directory DEEPER than the case's files, so a root
   * taken from this module would address every output one directory too far down,
   * and silently: the writers are required not to raise. `../media` turns a wrong
   * root into a thrown error rather than a quietly misplaced file.
   */
  projectRoot: string;
  /** The logical drawing surface the case's coordinates are stated in. */
  stage: Stage;
  /** The rate the case's suite steps at, which fixes what a second of game time is. */
  tickHz: number;
  /**
   * What the build owes when its surface is missing: the `Expected:` line every
   * check that reaches for an absent surface lands on.
   *
   * The case's own sentence, because where the surface comes from is phrased
   * differently by the two state models — beside the state as `[state, debug]`,
   * or from the instance's `initialize` — and a fault that misdescribed the
   * return would send a reviewer to the wrong line of the build.
   */
  surfaceRequirement: string;
  /** What the recorder over the 2D context keeps. */
  recorder?: RecorderOptions;
  /**
   * Which cue events land in {@link EngineHarness.cues} and in `watchCues`.
   *
   * Defaults to `["cue:played"]` alone, which is what every engine harness in the
   * tree subscribed. A LOOP IS NOT A PLAY: a case whose specification counts
   * firings would have every count moved by folding the two together, and a case
   * whose specification is ABOUT a bed starting cannot read it without them. So
   * the set is the case's, and a case that names `"cue:looped"` reads the two
   * apart afterwards through {@link TimedCue.looped}.
   */
  cueEvents?: readonly ("cue:played" | "cue:looped")[];
  /** The clock a harness takes when the caller names none. */
  defaultClock(): EngineClock;
  /** Build the case's engine over the harness's canvas, clock and metrics. */
  createEngine(parts: EngineParts): E;
  /**
   * Run the engine's own `initialize` and answer what it resolved to.
   *
   * Defaults to calling `initialize()` on the engine, which is what all four
   * engines carry. A case overrides it only to hold on to something the resolve
   * hands back that the engine does not keep.
   */
  initialize?(engine: E): Promise<unknown>;
  /** The surface as a check calls it — see `./driver` for the three strategies. */
  driver(engine: E, raw: object): D;
  /** A fresh read of the game's state through the case's own `snapshot`. */
  snapshot(driver: D, engine: E): S;
  /**
   * The case's logical point, in the space the engine's viewport maps.
   *
   * THE ONE PLACE THE FOUR ENGINES REALLY DIVERGE, and the reason it is a
   * parameter: a simple 2D engine maps the identity, a structured 2D engine goes
   * through `world.camera.worldToLogical`, and the two 3D engines each project
   * differently again. Defaults to the identity.
   */
  toLogical?(engine: E, x: number, y: number): Point;
  /** How a logical point becomes a pointer event's client position. */
  pointerPrecision?: PointerPrecision;
  /**
   * The pointer event a real gesture is raised as.
   *
   * Defaults to {@link PointerPositionEvent} — position and nothing more — which
   * is what a case whose engine may read `button`/`buttons` and fall back has
   * always dispatched. A case whose specification distinguishes devices binds
   * {@link DevicePointerEvent} instead. See `./events` on why the two are not
   * interchangeable.
   */
  pointerEvent?(
    type: PointerEventType,
    clientX: number,
    clientY: number,
    device: string | undefined,
  ): Event;
  /**
   * Whatever else this case's `Harness` carries, built over the base.
   *
   * Where a case reaches PAST the neutral contract into its own engine's object
   * model — a structured engine's `world`, `state` and `instance`, which a simple
   * engine has none of. Answering an object of getters is what keeps `h.world`
   * reading fresh on every access rather than freezing the world open at the
   * moment the harness was built.
   */
  extend?(base: EngineHarness<S, D, E>, engine: E, initialized: unknown): X;
}

/* -------------------------------------------------------------------------- */
/* The kit                                                                    */
/* -------------------------------------------------------------------------- */

/** This package's engine machinery, bound to one case on one engine. */
export interface EngineCaseKit<S, D, E, X> extends TickMath {
  /** The stage, rate and roots this kit was built with. */
  readonly config: EngineCaseConfig<S, D, E, X>;
  /** Build an engine over a canvas of the harness's own and initialize the game. */
  createHarness(
    options?: EngineHarnessOptions,
  ): Promise<EngineHarness<S, D, E> & X>;
  /**
   * Keep the picture on the canvas as the review item's `outputId`.
   *
   * The still is here and the REPLAY is not, and the split is the layering: a
   * still is a PNG off a canvas and every engine harness in the tree has one,
   * while a replay is a 2D engine's draw-op log and a 3D engine answers video
   * instead. `./replay`'s `makeReplayCapture` binds the 2D one for a case that
   * has it, and a 3D case reaches neither.
   */
  captureStill(h: EngineHarness<S, D, E>, outputId: string): void;
  /** Collect every cue the build plays FROM NOW ON, stamped with its frame. */
  watchCues(h: EngineHarness<S, D, E>): TimedCue[];
  /** Every recorded firing of the cue named `name`, oldest first. */
  cuesNamed(h: EngineHarness<S, D, E>, name: string): TimedCue[];
  /** Forget every cue recorded so far, so a check reads its own section alone. */
  clearCues(h: EngineHarness<S, D, E>): void;
}

/** The cue events a harness subscribes when the case names none. */
const DEFAULT_CUE_EVENTS: readonly ("cue:played" | "cue:looped")[] = [
  "cue:played",
];

/** The identity projection: the case's logical point is the engine's. */
function identityPoint(_engine: unknown, x: number, y: number): Point {
  return { x, y };
}

/** Bind this package's engine machinery to one case, once. */
export function createEngineCaseHarness<S, D extends object, E, X = unknown>(
  config: EngineCaseConfig<S, D, E, X>,
): EngineCaseKit<S, D, E, X> {
  const toLogical = config.toLogical ?? identityPoint;
  const cueEvents = config.cueEvents ?? DEFAULT_CUE_EVENTS;
  const rounds = config.pointerPrecision === "device-pixel";
  const raise =
    config.pointerEvent ??
    ((type, clientX, clientY, device) =>
      device === undefined
        ? new PointerPositionEvent(type, clientX, clientY)
        : new DevicePointerEvent(type, clientX, clientY, device));

  async function createHarness(
    options: EngineHarnessOptions = {},
  ): Promise<EngineHarness<S, D, E> & X> {
    const shape: SurfaceShape = {
      cssWidth: options.cssWidth ?? config.stage.width,
      cssHeight: options.cssHeight ?? config.stage.height,
      dpr: options.dpr ?? 1,
    };
    const recording = createRecordingCanvas(shape, config.recorder);
    const target = new EventTarget();
    const engine = config.createEngine({
      canvas: recording.element,
      clock: options.clock ?? config.defaultClock(),
      surface: surfaceMetrics(shape, target),
      shape,
    });
    const driven = engine as unknown as DrivenEngine;

    // Subscribed BEFORE `initialize`, which is what makes the game's own loading
    // observable: construction runs no game code, so nothing has happened yet.
    const assetFailures: AssetFailure[] = [];
    const cues: TimedCue[] = [];
    const stamp = (looped: boolean) => (played: CuePayload) => {
      const count = driven.frame().count;
      cues.push({ ...played, frame: count, tick: count, looped });
    };
    driven.events.on(
      "asset:failed",
      ({ path, reason }: AssetFailurePayload) => {
        assetFailures.push({ path, reason });
      },
    );
    for (const event of cueEvents) {
      driven.events.on(event, stamp(event === "cue:looped"));
    }

    const initialized = await (config.initialize === undefined
      ? (engine as unknown as { initialize(): Promise<unknown> }).initialize()
      : config.initialize(engine));
    const debug = config.driver(
      engine,
      readDebugSurface<object>(driven, config.surfaceRequirement),
    );

    const dispatch = (type: "keydown" | "keyup", code: string): void => {
      target.dispatchEvent(new KeyEvent(type, code));
    };
    const device = (x: number, y: number): Point => {
      const at = toLogical(engine, x, y);
      return deviceOf(driven.viewport(), at.x, at.y);
    };

    const base: EngineHarness<S, D, E> = {
      engine,
      debug,
      ctx: recording.ctx,
      canvas: recording.canvas,
      calls: recording.calls,
      cues,
      assetFailures,
      images: recording.images,
      events: target,
      shape,

      snapshot: () => config.snapshot(debug, engine),
      frame: () => driven.frame().count,
      tick: () => driven.frame().count,
      timeMs: () => driven.frame().timeMs,
      advance: (frames) => driven.advance(frames),

      async until(predicate, untilOptions = {}) {
        const maxFrames =
          untilOptions.maxFrames ?? untilOptions.maxTicks ?? DEFAULT_MAX_FRAMES;
        const poll = Math.max(1, untilOptions.poll ?? 1);

        let snapshot = config.snapshot(debug, engine);
        if (predicate(snapshot)) {
          return { hit: true, frames: 0, ticks: 0, snapshot };
        }

        let frames = 0;
        let since = Date.now();
        while (frames < maxFrames) {
          const step = Math.min(poll, maxFrames - frames);
          await driven.advance(step);
          frames += step;
          snapshot = config.snapshot(debug, engine);
          if (predicate(snapshot)) {
            return { hit: true, frames, ticks: frames, snapshot };
          }
          // A sweep of several hundred frames runs inside one `await`, and the
          // reporter, the timers and every socket read live on the loop it is
          // holding. Nothing observable changes; the host stops looking hung.
          since = await breathe(since);
        }
        return { hit: false, frames, ticks: frames, snapshot };
      },

      hold: (code) => dispatch("keydown", code),
      release: (code) => dispatch("keyup", code),
      async tap(code) {
        dispatch("keydown", code);
        dispatch("keyup", code);
        await driven.advance(1);
      },

      pointer: (type, x, y, pointerDevice) => {
        // The inverse of the engine's own mapping: its input reads `clientX` and
        // `clientY` as CSS pixels from the surface's origin, multiplies by the
        // ratio, and maps through the live fit — so a logical point goes back out
        // the same way, through the case's projection and the fit, then divided
        // by the ratio.
        const view = driven.viewport();
        const at = toLogical(engine, x, y);
        const dx = view.offsetX + at.x * view.scale;
        const dy = view.offsetY + at.y * view.scale;
        const client = rounds
          ? { x: Math.round(dx), y: Math.round(dy) }
          : { x: dx, y: dy };
        target.dispatchEvent(
          raise(
            type,
            client.x / shape.dpr,
            client.y / shape.dpr,
            pointerDevice,
          ),
        );
      },

      viewport: () => driven.viewport(),
      device,
      pixel: (x, y) => pixelAt(recording.ctx, device(x, y)),
      dispose: () => driven.destroy(),
    };

    if (config.extend === undefined) return base as EngineHarness<S, D, E> & X;
    return Object.defineProperties(
      base,
      Object.getOwnPropertyDescriptors(
        config.extend(base, engine, initialized),
      ),
    ) as EngineHarness<S, D, E> & X;
  }

  return {
    config,
    createHarness,
    captureStill: (h, outputId) => {
      captureOutputSync(config.slug, config.projectRoot, outputId, "png", () =>
        h.canvas.toBuffer("image/png"),
      );
    },
    watchCues: (h) => {
      const played: TimedCue[] = [];
      const engine = h.engine as unknown as DrivenEngine;
      const stamp = (looped: boolean) => (cue: CuePayload) => {
        const count = engine.frame().count;
        played.push({ ...cue, frame: count, tick: count, looped });
      };
      for (const event of cueEvents) {
        engine.events.on(event, stamp(event === "cue:looped"));
      }
      return played;
    },
    cuesNamed: (h, name) => h.cues.filter((cue) => cue.cue === name),
    clearCues: (h) => {
      h.cues.length = 0;
    },
    ...makeTickMath(config.tickHz),
  };
}

// Arc Foundry — the shared validator harness. CASE-PROVIDED.
//
// Every check in this project is an ordinary vitest test that runs IN THE SAME
// PROCESS as the build. It imports the engine and the build's own `src/game.ts`,
// creates an engine over a canvas it owns and a clock it chose, and steps the game
// with `engine.advance`. Nothing drives a browser, nothing serves a site, nothing
// polls, and no wall-clock time passes: a check asks for a number of frames and
// gets exactly that number, at exactly the deltas its clock supplied.
//
// WHAT A CHECK READS. The game's own state (through the debug surface's
// `snapshot`), the six layout readings, the engine's frame counter, the cues
// the engine announced, the assets the build failed to load, and — for the
// rendering checks — the pixels on the canvas or the operations the render issued
// against the 2D context. Nothing here fabricates an outcome: the scenario
// helpers below only ARRANGE the yard through the debug surface, and the real
// `update` the build wrote is what runs from there.
//
// WHY THE DEBUG SURFACE RATHER THAN RAW ASSIGNMENT. `specs/instrumentation.md`
// fixes its operations, so they mean the same thing in every build:
// `clearStructures` empties the yard and recomputes the route, `placeComponent`
// stands one permanent component up and appends it to the snapshot,
// `setUnitFrozen` holds one unit's travel and nothing else about it, and
// `spawnUnit` releases through the real spawner into a wave whose schedule is
// empty. Posing through it is how a scenario is reproducible, and it is the seam
// the case's specification documents. `surface.ts` is that specification as types,
// and it is the only description of the surface this harness reads: the build's
// own module for it is never imported.
//
// WHERE THE SURFACE COMES FROM. Off `engine.debug`, never built here. The build's
// `initialize` returns it beside the state, as `[state, debug]`, the engine holds
// the second element and returns it from `engine.debug`, and reading it back off
// the engine is the only way a surface reaches a check. So a build that returned
// no surface, or a surface missing an operation, fails the checks that reach the
// game through it. See {@link readDebugSurface}.
//
// HOW THE SURFACE IS DRIVEN. The engine holds the state by value and hands it out
// read-only, so the surface is pure: a pose takes the current state and returns
// the next, a reading takes the current state and returns what it read
// (`surface.ts`). A check still writes `h.debug.setCharge(500)` and
// `h.debug.snapshot()`, because `h.debug` is a {@link Driver} over the raw
// surface: it runs each pose through `engine.apply` and hands each reading
// `engine.state`. Nothing a check does holds a writable state — `h.state` is the
// engine's current value, read fresh on every access, and the only way to change
// it is a pose.
//
// THE CLOCK IS THE ENGINE'S, AND SO IS THE INPUT. `specs/instrumentation.md` puts
// no clock and no input operation on the surface under an engine, because both
// belong to the runtime: `engine.advance(n)` runs whole frames off a clock this
// harness supplies, and a key or a pointer press is a real event dispatched at the
// engine's own surface, which the game reads through the actions it registered.
// The default clock is a steady 120 Hz, which makes every duration below a whole
// number of frames — and which keeps a projectile's step (`PROJECTILE_SPEED / 120`,
// about 4.3 units) inside its own hit radius, so a shot's arrival is a fact about
// the game rather than about the step size.
//
// ONE ENGINE PER HARNESS, AND ONE HARNESS PER CHECK. `createHarness` builds a
// fresh canvas, a fresh event target and a fresh engine every time, so every check
// drives a game that has just initialized, with no key held, nothing muted, and
// nothing placed. `dispose` destroys the engine and drops its listeners.
//
// AND THIS FILE OWNS EVERY COMPOUND SEQUENCE. The surface is atomic by design: one
// operation sets one field. Opening a run, emptying the yard, standing one
// structure up, releasing one held unit, pressing one named control — each of
// those is several operations in a fixed order, and each lives HERE so that a
// hundred suites say what their scenario is about in one line and say it the same
// way. A check that needs only part of a sequence calls the operations it needs.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import {
  createCanvas,
  Image,
  type Canvas,
  type SKRSContext2D,
} from "@napi-rs/canvas";

// The engine's recorder decides whether a draw source is a bitmap by matching the
// host's own constructor names, and a name the host does not define never matches.
// Node defines no `ImageBitmap`, so the images this harness draws from -- which are
// `@napi-rs/canvas`'s `Image` -- were recorded as an opaque marker with no pixels
// behind it. Every replay that drew a produced sprite therefore reached a reviewer
// with the sprite missing from it.
//
// Naming that class `ImageBitmap` on the host is the whole fix, and it belongs here
// rather than in the engine: matching by name is the engine's deliberate design, and
// it is correct in the browser it is written for. This harness is the Node-side
// adapter, so supplying the name the host lacks is its job.
(globalThis as Record<string, unknown>).ImageBitmap ??= Image;
import {
  ConstantClock,
  createEngine,
  type CapturedImage,
  type Clock,
  type DrawOp,
  type DrawState,
  type DrawValue,
  type Engine,
  type Game,
  type PathSegment,
  type RecordedFrame,
  type Recording,
  type Resource,
  type SurfaceMetrics,
  type Viewport,
} from "@test-cabinet/simple-2d";
import type { DeepReadonly } from "ts-essentials";
import { expect } from "vitest";
import {
  type ActionName,
  BACKGROUND,
  BAR_H,
  BOARD_H,
  BOARD_W,
  BOARD_X,
  BOARD_Y,
  type ComboId,
  type ComponentType,
  type DifficultyId,
  keyFor,
  LAYOUT,
  type MapId,
  type MenuAction,
  PANEL_W,
  PANEL_X,
  type PanelAction,
  type Point,
  type PressControl as PressAction,
  STAGE_H,
  STAGE_W,
  STAMPS_PER_LEVEL,
  type StatusControl as StatusAction,
  structureCenter,
  TARGETING_PRIORITIES,
  tileCenter,
} from "./constants";
import { game as build, type FoundryState } from "../src/game";
import { assertTruthy, fail } from "./assert";
import {
  READINGS,
  type FoundryDebugApi,
  type FoundrySnapshot,
  type IngredientState,
  type MenuButton,
  type OverlayName,
  type PanelButton,
  type PressButton,
  type RecipeEntry,
  type Screen,
  type SpawnType,
  type StatusControl,
  type StatusReadout,
  type StatusReadoutName,
  type StructureView,
  type Targeting,
  type Tier,
  type UnitView,
} from "./surface";

export {
  READINGS,
  REQUIRED_OPS,
  type FoundrySnapshot,
  type IngredientState,
  type MenuButton,
  type OverlayName,
  type PanelButton,
  type PressButton,
  type ProjectileView,
  type RecipeEntry,
  type Screen,
  type StatusControl,
  type StatusReadout,
  type StatusReadoutName,
  type StructureView,
  type Targeting,
  type UnitView,
  type WaypointView,
} from "./surface";

/* -------------------------------------------------------------------------- */
/* The step schedule                                                          */
/* -------------------------------------------------------------------------- */
//
// The suite chooses the size of a frame, because the specification deliberately
// fixes none: every rate in this game is per second and is integrated against the
// elapsed time of the frame, so a build must reach the same place however that
// time was divided. A check that is specifically about the step size builds
// harnesses with clocks of its own; every other check takes the default.

/** The frame the suite steps in. */
export const TICK_HZ = 120;
export const TICK_MS = 1000 / TICK_HZ;

/** Seconds of simulated time in `n` frames of the default clock. */
export function seconds(n: number): number {
  return n / TICK_HZ;
}

/** Frames of the default clock covering `s` seconds, rounded up. */
export function ticks(s: number): number {
  return Math.ceil(s * TICK_HZ);
}

/** A speed in units per second from a displacement measured over `n` frames. */
export function speedOverTicks(delta: number, n: number): number {
  return (Math.abs(delta) * TICK_HZ) / n;
}

/** The straight-line distance between two points. */
export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/* -------------------------------------------------------------------------- */
/* The harness                                                                */
/* -------------------------------------------------------------------------- */

/** The case's surface, bound to the state type the build declared. */
export type FoundrySurface = FoundryDebugApi<FoundryState>;

/**
 * The build's game, typed against the surface the CASE specifies.
 *
 * The build declares its own type for the surface its `initialize` returns, and
 * that type is the build's: what a check holds it to is `surface.ts`, so the game
 * is cast to the case's `Game<FoundryState, FoundrySurface>` here and the engine
 * is parameterized with it. A surface that departs from the specification is
 * caught where a check reaches for the missing member, not by the build's own
 * compiler.
 */
const game = build as unknown as Game<FoundryState, FoundrySurface>;

/**
 * A member of a pure surface, as a check calls it.
 *
 * A pose `(state, ...args) => S` becomes `(...args) => void`: the driver runs it
 * through `engine.apply`, so the state it returns is the state the next frame
 * receives. A reading `(state) => R` becomes `() => R`: the driver hands it
 * `engine.state`. Anything else (`version`) is carried as it is.
 */
type Driven<S, M> = M extends (state: DeepReadonly<S>, ...args: infer A) => S
  ? (...args: A) => void
  : M extends (state: DeepReadonly<S>) => infer R
    ? () => R
    : M;

/**
 * The imperative reading of a pure surface: every member of `D`, minus its state
 * argument, over the engine that holds the state.
 */
export type Driver<S, D> = {
  [K in keyof D]: Driven<S, NonNullable<D[K]>>;
};

/** The surface as every check drives it. */
export type FoundryDriver = Driver<FoundryState, FoundrySurface>;

/** One recorded operation on the 2D context, in the order the render made it. */
export type DrawCall =
  | { kind: "call"; method: string; args: unknown[] }
  | { kind: "set"; property: string; value: unknown };

/** One cue the build played, as the engine announced it. */
export interface TimedCue {
  /** The cue's name, one of the twelve `CUES` fixes (specs/ui.md). */
  cue: string;
  /** The frame loop's simulated time when it played, in milliseconds. */
  t: number;
  /** The cue's gain: zero while the bus is muted, positive otherwise. */
  gain: number;
  /** The frame it played on, 1-based, as `engine.frame().count` reports. */
  frame: number;
}

/** One asset the build asked for and did not get. */
export interface AssetFailure {
  path: string;
  reason: string;
}

export interface HarnessOptions {
  /** The clock each frame takes its delta from. Defaults to 120 Hz. */
  clock?: Clock;
  /** The element's laid-out CSS width. Defaults to the logical stage width. */
  cssWidth?: number;
  /** The element's laid-out CSS height. Defaults to the logical stage height. */
  cssHeight?: number;
  /** Device pixels per CSS pixel. Defaults to 1, so one device pixel is one unit. */
  dpr?: number;
}

/** How far a sweep may run, and how many frames separate two samples. */
export interface UntilOptions {
  maxFrames?: number;
  poll?: number;
}

/** What a sweep found: whether the predicate ever held, and where it stopped. */
export interface UntilResult {
  hit: boolean;
  /** Frames advanced before the sample that ended the sweep. */
  frames: number;
  snapshot: FoundrySnapshot;
}

export interface Harness {
  readonly engine: Engine<FoundryState, FoundrySurface>;
  /**
   * The engine's current state, read fresh on every access. Read it, or pose it
   * through `debug`; nothing here can write to it.
   */
  readonly state: DeepReadonly<FoundryState>;
  /**
   * The debug surface the BUILD returned beside its state, driven over the
   * engine: each pose runs through `engine.apply`, each reading is handed
   * `engine.state`.
   */
  readonly debug: FoundryDriver;
  /** The real 2D context, for `getImageData`. Draw calls also reach it. */
  readonly ctx: SKRSContext2D;
  /**
   * The surface the engine drew into, holding the last frame that ran. Exposed
   * for {@link captureStill}, which encodes it.
   */
  readonly canvas: Canvas;
  /** Every call and property set the render made, oldest first. */
  readonly calls: DrawCall[];
  /** Every cue the build played, oldest first. */
  readonly cues: TimedCue[];
  /** Every asset the build failed to load, oldest first. */
  readonly assetFailures: AssetFailure[];

  /** This engine's frame counter, as `engine.frame().count` reports it. */
  frame(): number;
  /** The simulated time those frames covered, in milliseconds. */
  timeMs(): number;

  /** A fresh read of the game's state through the case's `snapshot`. */
  snapshot(): FoundrySnapshot;
  /** Run `frames` frames back to back, each the length the clock says. */
  advance(frames: number): Promise<void>;
  /** Run whole frames of the default clock covering `s` seconds of game time. */
  advanceSeconds(s: number): Promise<void>;
  /** Advance until `predicate` holds, sampling every `poll` frames. */
  until(
    predicate: (snapshot: FoundrySnapshot) => boolean,
    options?: UntilOptions,
  ): Promise<UntilResult>;
  /** Drive the engine's own frame loop for `ms` of real time, then halt it. */
  runFor(ms: number): Promise<void>;

  /** Press a key and leave it down, as a player holding it would. */
  hold(code: string): void;
  /** Release a key held by `hold`. */
  release(code: string): void;
  /**
   * Press and release a key, then run the one frame that delivers its edge.
   *
   * The engine discards an edge nothing consumed by the end of the frame it was
   * armed in, so a tap that ran no frame would never reach the game. The release
   * is delivered before the frame because an edge, once armed, survives it: an
   * action read as a LEVEL — `modify` — is held with {@link Harness.hold}
   * instead, and {@link withModify} is the shape that does it.
   */
  tap(code: string): Promise<void>;

  /** Move the pointer, without pressing. */
  pointerMove(x: number, y: number): void;
  /** Press the pointer at a logical point. */
  pointerDown(x: number, y: number): void;
  /** Release the pointer at a logical point. */
  pointerUp(x: number, y: number): void;

  /**
   * Land a touch contact at a logical point.
   *
   * `specs/controls.md` delivers a contact on the same reads as the pointer and in
   * the same logical units, which under this engine means the same pointer events
   * carrying a touch device. So a contact is dispatched exactly as a pointer act is,
   * and what tells the two apart is the device the engine reads off the event.
   */
  touchStart(x: number, y: number): void;
  /** Move the contact that is down to a logical point. Nothing, with none down. */
  touchMove(x: number, y: number): void;
  /** Lift the contact at the position it is at. Nothing, with none down. */
  touchEnd(): void;

  /** Run exactly one frame and hand back every operation its render issued. */
  frameCalls(): Promise<DrawCall[]>;
  /**
   * Reflect the surface without invoking it: `typeof` for each name, and the
   * version it reports.
   */
  probe(names: readonly string[]): {
    version: unknown;
    ops: Record<string, string>;
  };

  /** How the stage is mapped onto this harness's canvas. */
  viewport(): Viewport;
  /** Where a logical point lands in the canvas's backing store. */
  device(x: number, y: number): { x: number; y: number };
  /** The device pixel under a logical point, as `[r, g, b, a]`. */
  pixel(x: number, y: number): [number, number, number, number];
  /** Many logical points at once. */
  pixels(points: readonly Point[]): [number, number, number, number][];

  /** Halt the engine and drop every listener. */
  dispose(): void;
}

/** A `KeyboardEvent`-shaped event: the engine reads `code` and `repeat`. */
class KeyEvent extends Event {
  readonly code: string;
  readonly repeat: boolean;

  constructor(type: "keydown" | "keyup", code: string, repeat = false) {
    super(type);
    this.code = code;
    this.repeat = repeat;
  }
}

/**
 * A `PointerEvent`-shaped event: the engine reads `clientX`, `clientY` and
 * `isPrimary`, and maps the position through the same fit the game draws under.
 *
 * At the default shape — the stage's own size at one device pixel per CSS pixel —
 * that fit is the identity, so a logical point is dispatched directly.
 */
class PointerEvt extends Event {
  readonly clientX: number;
  readonly clientY: number;
  readonly isPrimary = true;
  readonly pointerType: "mouse" | "touch";

  constructor(
    type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
    x: number,
    y: number,
    pointerType: "mouse" | "touch" = "mouse",
  ) {
    super(type);
    this.clientX = x;
    this.clientY = y;
    this.pointerType = pointerType;
  }
}

function toDevice(view: Viewport, x: number, y: number): Point {
  return {
    x: Math.round(view.offsetX + x * view.scale),
    y: Math.round(view.offsetY + y * view.scale),
  };
}

/**
 * A proxy that records every call and property set on its way to the real
 * context, so one frame produces both a pixel buffer to sample and a call list to
 * inspect.
 */
function recorder(target: SKRSContext2D, calls: DrawCall[]): SKRSContext2D {
  return new Proxy(target, {
    get(object, property) {
      const value = Reflect.get(object, property, object) as unknown;
      if (typeof value !== "function") return value;
      return (...args: unknown[]): unknown => {
        calls.push({ kind: "call", method: String(property), args });
        return (value as (...rest: unknown[]) => unknown).apply(object, args);
      };
    },
    set(object, property, value) {
      calls.push({ kind: "set", property: String(property), value });
      return Reflect.set(object, property, value, object);
    },
  });
}

/** Every argument list `method` was called with, in order. */
export function callsTo(
  calls: readonly DrawCall[],
  method: string,
): unknown[][] {
  return calls.flatMap((call) =>
    call.kind === "call" && call.method === method ? [call.args] : [],
  );
}

/** Every value `property` was set to, in order. */
export function setsOf(
  calls: readonly DrawCall[],
  property: string,
): unknown[] {
  return calls.flatMap((call) =>
    call.kind === "set" && call.property === property ? [call.value] : [],
  );
}

/** Every string the frame drew, through `fillText` or `strokeText`. */
export function drawnText(calls: readonly DrawCall[]): string[] {
  return [
    ...callsTo(calls, "fillText"),
    ...callsTo(calls, "strokeText"),
  ].flatMap((args) => (typeof args[0] === "string" ? [args[0]] : []));
}

/**
 * Whether the frame drew `text` as part of some run of text, ignoring case.
 *
 * Substring rather than equality on purpose: the copy a check asserts is the
 * case's own, but how a build presents it is the build's, and a label is commonly
 * drawn with a marker or padding around it.
 */
export function drewText(calls: readonly DrawCall[], text: string): boolean {
  const wanted = text.trim().toLowerCase();
  return drawnText(calls).some((drawn) => drawn.toLowerCase().includes(wanted));
}

/**
 * What `specs/instrumentation.md` requires of the surface: the `Expected:` line of
 * the failure every check that reaches for a missing surface lands on, beside what
 * `engine.debug` was found holding instead.
 */
export const SURFACE_REQUIREMENT =
  "the debug and automation surface src/game.ts's initialize returns beside " +
  "its state, as [state, debug], which the engine hands back from engine.debug " +
  "(specs/instrumentation.md)";

/** Fail the running check on `fault`, paired with what the specification requires. */
export function failSurface(fault: string): never {
  return fail(SURFACE_REQUIREMENT, fault);
}

/**
 * A stand-in for the surface a build never returned: every operation on it fails
 * the check that reached for it, with the missing return named.
 *
 * A proxy rather than a hand-written stub, so an operation a check reaches for by
 * name reports the build's missing surface rather than looking like a harness bug.
 *
 * Keys that belong to the MACHINERY rather than to a check are answered with
 * `undefined` instead: awaiting a value probes `then`, and vitest's own error
 * formatting probes symbols and `constructor`. Failing those would replace the
 * verdict with noise from the machinery that was trying to report it.
 */
function missingSurface(reason: string): FoundrySurface {
  return new Proxy({} as FoundrySurface, {
    get: (_target, property): unknown => {
      if (typeof property === "symbol") return undefined;
      if (property === "then" || property === "constructor") return undefined;
      return failSurface(reason);
    },
  });
}

/**
 * The debug surface the BUILD returned beside its state, read off the engine that
 * holds it.
 *
 * This is deliberately a READ and never a construction. The surface is the build's
 * deliverable: its `initialize` returns `[state, debug]`
 * (specs/instrumentation.md), the engine keeps the second element, and
 * `engine.debug` is the only way it reaches a check.
 *
 * A build that returned no pair at all never gets this far, because the engine
 * rejects `initialize` itself and the rejection fails the suite's `beforeEach`
 * with the engine's own message. What IS decided here is a pair whose second
 * element is no surface. That is a fault in the build and not in this harness, so
 * it must not present as one: it is neither thrown from here — which would bury
 * the verdict under the harness's own stack — nor swallowed. {@link missingSurface}
 * stands in and fails, by assertion, at the moment a check first reaches for an
 * operation on it.
 */
function readDebugSurface(
  engine: Engine<FoundryState, FoundrySurface>,
): FoundrySurface {
  const surface: unknown = engine.debug;
  if (typeof surface !== "object" || surface === null) {
    return missingSurface(
      `engine.debug holds ${surface === null ? "null" : typeof surface}, not an object`,
    );
  }
  return surface as FoundrySurface;
}

/**
 * The imperative reading of the raw surface, over the engine that holds the state.
 *
 * A proxy, and a lazy one, for the same reason {@link missingSurface} is: the
 * member is read off the raw surface at the moment a check reaches for it, so a
 * missing surface or a missing operation fails the check that needed it and never
 * the `beforeEach` that built the harness.
 *
 * A reading is called with `engine.state` and its result handed back. A pose is run
 * through `engine.apply`, so the engine stores what it returned and the next
 * frame's `update` receives it; a pose that returns nothing is refused by the
 * engine with a message naming the rule.
 */
function driveSurface(
  engine: Engine<FoundryState, FoundrySurface>,
  raw: FoundrySurface,
): FoundryDriver {
  const readings: readonly string[] = READINGS;
  return new Proxy({} as FoundryDriver, {
    get: (_target, property): unknown => {
      if (typeof property === "symbol") return undefined;
      if (property === "then" || property === "constructor") return undefined;
      const member = (raw as unknown as Record<string, unknown>)[property];
      if (typeof member !== "function") return member;
      const op = member as (
        state: DeepReadonly<FoundryState>,
        ...args: unknown[]
      ) => unknown;
      if (readings.includes(property)) {
        return (): unknown => op.call(raw, engine.state);
      }
      return (...args: unknown[]): void => {
        engine.apply((state) => op.call(raw, state, ...args) as FoundryState);
      };
    },
  });
}

/**
 * Build an engine over a canvas of the harness's own, initialize the build's game,
 * and hand back everything a check reads.
 *
 * The options passed to the factory are the ones the seeded `src/main.ts` passes —
 * the design size, the build's exported `BACKGROUND`, and the touch layout — so one
 * harness serves every build of this case. Everything else the build decided lives
 * inside `src/game.ts`.
 *
 * THE PRODUCED FILES DO NOT RESOLVE HERE, and that is the intended reading. There
 * is no page behind the loader, so every path under `assets/` fails, the engine
 * announces each failure, and `specs/assets.md` requires the build to stay playable
 * on its own geometry when a file does not arrive. A check about a produced file
 * reads the file off disk itself; every other check runs against the fallbacks,
 * which is a strictly harder game to pass.
 */
export async function createHarness(
  options: HarnessOptions = {},
): Promise<Harness> {
  const cssWidth = options.cssWidth ?? STAGE_W;
  const cssHeight = options.cssHeight ?? STAGE_H;
  const dpr = options.dpr ?? 1;

  const canvas = createCanvas(
    Math.round(cssWidth * dpr),
    Math.round(cssHeight * dpr),
  );
  const ctx = canvas.getContext("2d");
  const calls: DrawCall[] = [];
  const recorded = recorder(ctx, calls);
  const element = Object.assign(canvas, {
    style: {} as CSSStyleDeclaration,
    getContext: (): SKRSContext2D => recorded,
  }) as unknown as HTMLCanvasElement;

  const events = new EventTarget();
  const metrics: SurfaceMetrics = {
    cssWidth: () => cssWidth,
    cssHeight: () => cssHeight,
    dpr: () => dpr,
    events: () => events,
  };

  const engine = createEngine<FoundryState, FoundrySurface>({
    canvas: element,
    width: STAGE_W,
    height: STAGE_H,
    game,
    // The build's own stage background, handed to the engine exactly as the seeded
    // `src/main.ts` hands it (specs/overview.md).
    background: BACKGROUND,
    layout: LAYOUT,
    clock: options.clock ?? new ConstantClock(TICK_MS),
    surface: metrics,
  });

  // Subscribed BEFORE `initialize`, which is what makes the game's own loading and
  // its opening cues observable: construction runs no game code, so nothing has
  // happened yet.
  const assetFailures: AssetFailure[] = [];
  const cues: TimedCue[] = [];
  engine.events.on("asset:failed", ({ path, reason }) => {
    assetFailures.push({ path, reason });
  });
  engine.events.on("cue:played", ({ cue, t, gain }) => {
    cues.push({ cue, t, gain, frame: engine.frame().count });
  });

  await engine.initialize();
  const raw = readDebugSurface(engine);
  const debug = driveSurface(engine, raw);

  const key = (type: "keydown" | "keyup", code: string): void => {
    events.dispatchEvent(new KeyEvent(type, code));
  };
  const pointer = (
    type: "pointerdown" | "pointermove" | "pointerup",
    x: number,
    y: number,
    device: "mouse" | "touch" = "mouse",
  ): void => {
    events.dispatchEvent(new PointerEvt(type, x, y, device));
  };

  // Where the one touch contact is, or `null` with none down. `specs/instrumentation.md`
  // holds one contact down at a time, lifts it "at the position it is at", and ignores a
  // move or an end with none down.
  let contact: Point | null = null;

  // WHY A DRIVE HANDS THE EVENT LOOP A TURN. `engine.advance(n)` returns a promise,
  // but the `n` frames have already run by the time it does: the engine steps them
  // synchronously and resolves after the last one. So a check that drives a wave to
  // its clear holds this worker's event loop for as long as that simulation takes,
  // and awaiting an already-settled promise does not give the loop back — it queues
  // a microtask, which runs before the loop is reached at all. Vitest reports a
  // running file to its runner over a socket served by that same loop, and a
  // report left unanswered for long enough is abandoned, which spoils the RUN over
  // a check that passed. `step` therefore lets one real turn of the loop through
  // whenever the frames just run have held it for {@link YIELD_AFTER_MS}. Nothing
  // measured here depends on wall-clock time — every check supplies its own clock
  // and the engine reads no other — so the turn changes no reading, and it costs a
  // microsecond, only after a drive has already spent a tenth of a second.
  const YIELD_AFTER_MS = 100;
  let yieldedAt = Date.now();
  const step = async (frames: number): Promise<void> => {
    await engine.advance(frames);
    if (Date.now() - yieldedAt >= YIELD_AFTER_MS) {
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
      yieldedAt = Date.now();
    }
  };

  const harness: Harness = {
    engine,
    get state() {
      return engine.state;
    },
    debug,
    ctx,
    canvas,
    calls,
    cues,
    assetFailures,

    frame: () => engine.frame().count,
    timeMs: () => engine.frame().timeMs,

    snapshot: () => debug.snapshot(),

    advance: (frames) => step(frames),
    advanceSeconds: (s) => step(ticks(s)),

    async until(predicate, untilOptions = {}) {
      const maxFrames = untilOptions.maxFrames ?? 1200;
      const poll = Math.max(1, untilOptions.poll ?? 1);

      let snapshot = debug.snapshot();
      if (predicate(snapshot)) return { hit: true, frames: 0, snapshot };

      let frames = 0;
      while (frames < maxFrames) {
        const chunk = Math.min(poll, maxFrames - frames);
        await step(chunk);
        frames += chunk;
        snapshot = debug.snapshot();
        if (predicate(snapshot)) return { hit: true, frames, snapshot };
      }
      return { hit: false, frames, snapshot };
    },

    async runFor(ms) {
      const controller = new AbortController();
      const running = engine.run({ signal: controller.signal });
      await new Promise((resolve) => setTimeout(resolve, ms));
      controller.abort();
      await running;
    },

    hold: (code) => key("keydown", code),
    release: (code) => key("keyup", code),
    async tap(code) {
      key("keydown", code);
      key("keyup", code);
      await step(1);
    },

    pointerMove: (x, y) => pointer("pointermove", x, y),
    pointerDown: (x, y) => pointer("pointerdown", x, y),
    pointerUp: (x, y) => pointer("pointerup", x, y),

    touchStart: (x, y) => {
      contact = { x, y };
      pointer("pointerdown", x, y, "touch");
    },
    touchMove: (x, y) => {
      if (contact === null) return;
      contact = { x, y };
      pointer("pointermove", x, y, "touch");
    },
    touchEnd: () => {
      if (contact === null) return;
      const at = contact;
      contact = null;
      pointer("pointerup", at.x, at.y, "touch");
    },

    async frameCalls() {
      calls.length = 0;
      await step(1);
      return [...calls];
    },

    probe(names) {
      const target = raw as unknown as Record<string, unknown>;
      const ops: Record<string, string> = {};
      for (const name of names) ops[name] = typeof target[name];
      return { version: target.version, ops };
    },

    viewport: () => engine.viewport(),
    device: (x, y) => toDevice(engine.viewport(), x, y),
    pixel: (x, y) => harness.pixels([{ x, y }])[0]!,
    pixels(points) {
      const view = engine.viewport();
      return points.map((point) => {
        const at = toDevice(view, point.x, point.y);
        const x = Math.min(Math.max(at.x, 0), Math.max(canvas.width - 1, 0));
        const y = Math.min(Math.max(at.y, 0), Math.max(canvas.height - 1, 0));
        const { data } = ctx.getImageData(x, y, 1, 1);
        return [data[0]!, data[1]!, data[2]!, data[3]!];
      });
    },

    dispose: () => engine.destroy(),
  };

  return harness;
}

/* -------------------------------------------------------------------------- */
/* Evidence capture                                                           */
/* -------------------------------------------------------------------------- */
//
// A review item may declare a `replay` OUTPUT beside its verdict: the frames the
// build itself drew while a check drove it, kept as evidence a reviewer can scrub
// and compare against the reference implementation's. `captureReplay` is how a
// check produces one, and under an engine what it keeps is the ENGINE's own
// draw-command recording, which is the preferred moving evidence.
//
// Four properties are what make it usable, and each is deliberate:
//
// 1. IT RECORDS THE SECTION, NOT THE RUN. The recorder is armed around the
//    caller's scenario and disarmed the moment that scenario returns, so what is
//    kept is the part the check is ABOUT and never the setup that got there.
// 2. IT IS EVIDENCE, NEVER A VERDICT. The scenario's own value comes straight
//    back, and a scenario that THROWS still writes what it had recorded before the
//    failure travels on — a failing check is the one whose replay a reviewer most
//    wants. A recording that cannot be written is reported as an output that never
//    turned up, which is a fact about the host rather than about the build.
// 3. IT WRITES ONLY WHAT THERE IS TO LOOK AT. A capture that closed no frames
//    leaves no file, so the run reports the output absent instead of offering the
//    reviewer a replay of nothing.
// 4. IT COSTS NOTHING WHEN NOBODY IS COLLECTING. Outside a run the media directory
//    is unset and the whole thing is a no-op that still runs the scenario, so a
//    check cannot pass in one place and fail in the other.

/** The environment variable the runner names the media directory in. */
const MEDIA_DIR_ENV = "TCAB_VALIDATION_MEDIA_DIR";

/**
 * The directory this harness sits in, which is the validator project's root.
 *
 * Taken from this module's own URL rather than from the working directory, because
 * it has to name the same directory in both layouts this file lives in: the case's
 * own `validation/<engine>/`, and the `validation/` the runner stages that
 * directory to inside the build's tree.
 */
const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * The directory the runner stages this project to inside the build's tree.
 *
 * A recording is addressed by the STAGED path of the suite that produced it —
 * `validation/firing/in-range.test.ts` — because that is the path the review item's
 * declared script resolves to, and so the only name the case's manifest and the
 * runner both already agree on.
 */
const STAGED_PROJECT_DIR = "validation";

/**
 * The most frames a written recording holds.
 *
 * A recording is one operation log per frame, and a frame of this game is
 * hundreds of operations, so a section a check drives for half a minute of game
 * time runs to tens of megabytes — a file nobody can serve to a reviewer. The cap
 * is what makes `captureReplay` safe to wrap ANY section in: an author arms the
 * recorder around what the check is about and never has to reason about how long
 * that turns out to be.
 */
const MAX_REPLAY_FRAMES = 300;

/**
 * Where the running suite's `outputId` output belongs, or `null` when nothing is
 * collecting media.
 *
 * The suite is the one vitest is currently running rather than one the caller
 * names, because the two must not be able to disagree: a check that named its own
 * path would be free to write its evidence under some other point's address.
 */
function mediaDestination(outputId: string, extension: string): string | null {
  const mediaDir = process.env[MEDIA_DIR_ENV];
  if (mediaDir === undefined || mediaDir === "") return null;
  const testPath = expect.getState().testPath;
  if (testPath === undefined) return null;
  const suite = relative(PROJECT_ROOT, testPath).split(sep).join("/");
  return join(mediaDir, STAGED_PROJECT_DIR, suite, `${outputId}.${extension}`);
}

/**
 * A value's JSON with object keys in a fixed order, as the key a table
 * deduplicates on.
 */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(",")}}`;
}

/** Add `entry` to a table if it is new, and answer where it lives. */
function intern<T>(table: T[], at: Map<string, number>, entry: T): number {
  const key = canonical(entry);
  const found = at.get(key);
  if (found !== undefined) return found;
  const index = table.length;
  table.push(entry);
  at.set(key, index);
  return index;
}

/**
 * `frames` re-expressed against tables holding only what those frames name.
 *
 * DROPPING A FRAME DROPS THE LAST REFERENCE TO WHATEVER ONLY THAT FRAME DREW WITH.
 * The four tables in front of a recording are shared by every frame in it, so
 * carrying them over whole would put operations, states, gradients and images in
 * the file that no surviving frame asks for — dead weight in a document whose whole
 * point is to say each thing once, and the bulk of it in a game that draws
 * procedurally and so repeats almost nothing between frames.
 *
 * Every entry here is reached from a kept frame, and every reference inside one is
 * rewritten as it is reached, transitively. What is deduplicated is the rewritten
 * entry, so an operation two hundred frames issue identically is written once and
 * named two hundred times, and every index a frame carries addresses the table it
 * was interned into.
 *
 * Exported for the suite beside this file: a recording carrying an own field named
 * `__proto__` is one the engine's recorder writes for a build that passes one, and
 * this one has to rewrite it as a field rather than as a prototype.
 */
export function retable(
  recording: Recording,
  frames: readonly RecordedFrame[],
): Recording {
  const images: CapturedImage[] = [];
  const imageAt = new Map<number, number>();
  const resources: Resource[] = [];
  const resourceAt = new Map<number, number>();
  const ops: DrawOp[] = [];
  const opAt = new Map<string, number>();
  const states: DrawState[] = [];
  const stateAt = new Map<string, number>();

  const takeImage = (source: number): number => {
    const found = imageAt.get(source);
    if (found !== undefined) return found;
    const index = images.length;
    images.push(recording.images[source]);
    imageAt.set(source, index);
    return index;
  };

  const takeResource = (source: number): number => {
    const found = resourceAt.get(source);
    if (found !== undefined) return found;
    const recipe = recording.resources[source];
    // A recipe's own arguments were encoded when the value was used, so they can
    // only name entries interned before it: rewriting one terminates and cannot
    // re-enter this resource.
    const rebuilt: Resource = {
      make: { method: recipe.make.method, args: recipe.make.args.map(value) },
      then: recipe.then.map(operation),
    };
    const index = resources.length;
    resources.push(rebuilt);
    resourceAt.set(source, index);
    return index;
  };

  const value = (entry: DrawValue): DrawValue => {
    if (Array.isArray(entry)) return entry.map(value);
    if (entry === null || typeof entry !== "object") return entry;
    const record = entry as Record<string, DrawValue>;
    if (typeof record.$img === "number")
      return { $img: takeImage(record.$img) };
    if (typeof record.$res === "number") {
      return { $res: takeResource(record.$res) };
    }
    const rewritten: Record<string, DrawValue> = {};
    for (const [key, held] of Object.entries(record)) {
      // Defined rather than assigned: a build's own object may carry a field named
      // `__proto__`, and assigning that name reaches the prototype setter instead
      // of writing a field the document carries.
      Object.defineProperty(rewritten, key, {
        value: value(held),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return rewritten;
  };

  const operation = (op: DrawOp): DrawOp =>
    op.op === "call"
      ? { op: "call", method: op.method, args: op.args.map(value) }
      : { op: "set", property: op.property, value: value(op.value) };

  const segments = (list: readonly PathSegment[]): PathSegment[] =>
    list.map((segment) => ({
      transform: segment.transform,
      ops: segment.ops.map(operation),
    }));

  const stateOf = (source: number): number => {
    const state = recording.states[source];
    const properties: Record<string, DrawValue> = {};
    for (const [name, held] of Object.entries(state.properties)) {
      Object.defineProperty(properties, name, {
        value: value(held),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return intern(states, stateAt, {
      properties,
      transform: state.transform,
      lineDash: state.lineDash,
      clip: segments(state.clip),
      // A frame inherits the current path along with the clip: a canvas keeps its
      // path across a frame boundary, and applying a clip leaves the clip outline
      // current, so a state that stopped at the clip would leave a bare `fill`
      // among the frame's operations filling that outline.
      path: segments(state.path),
    });
  };

  return {
    ...recording,
    images,
    resources,
    ops,
    states,
    frames: frames.map((frame) => ({
      ...frame,
      state: stateOf(frame.state),
      stack: frame.stack.map(stateOf),
      ops: frame.ops.map((op) =>
        intern(ops, opAt, operation(recording.ops[op])),
      ),
    })),
  };
}

/**
 * A recording of at most {@link MAX_REPLAY_FRAMES} frames, covering the whole of
 * what was captured.
 *
 * An over-long section is THINNED rather than cut short: every nth frame is kept,
 * so the reviewer sees the entire section at a lower frame rate instead of its
 * first — or last — few seconds at the full one. A wave is evidence that the Load
 * walked the maze and died along it, and the deaths are spread across the whole of
 * it.
 *
 * Thinning is legitimate because every frame in a recording is drawable on its own:
 * a frame names the whole of the state it opened with and reaches everything it
 * draws with through tables the recording shares. Each kept frame's `deltaMs` is
 * restated as the time since the frame kept before it, so the deltas still sum to
 * the section's elapsed time and a player pacing itself off them runs at the speed
 * the game really ran at. The frame `count` is left as the host reported it, so a
 * reader can see that frames were skipped rather than being told a smooth lie.
 *
 * The last frame is always kept, whatever the stride lands on: it is the frame the
 * check's sweep stopped at, and the one a reviewer looks at first. Keeping it costs
 * a frame rather than the cap. The stride rounds up, so a section whose length is an
 * exact multiple of the cap strides over exactly that many frames and stops one
 * stride short of the end; the last frame then takes the place of the final strided
 * frame and is measured from where that frame was measured from, which is what keeps
 * the kept deltas summing to the elapsed time.
 */
function thinReplay(recording: Recording): Recording {
  const { frames } = recording;
  if (frames.length <= MAX_REPLAY_FRAMES) return recording;

  const stride = Math.ceil(frames.length / MAX_REPLAY_FRAMES);
  const kept: RecordedFrame[] = [];
  // The moment the section started, so the first kept frame's delta is its own
  // rather than a step measured from nothing.
  let previousMs = frames[0].timeMs - frames[0].deltaMs;
  const keep = (frame: RecordedFrame): void => {
    kept.push({ ...frame, deltaMs: frame.timeMs - previousMs });
    previousMs = frame.timeMs;
  };

  for (let i = 0; i < frames.length; i += stride) keep(frames[i]);
  const last = frames[frames.length - 1];
  if (kept[kept.length - 1].count !== last.count) {
    if (kept.length >= MAX_REPLAY_FRAMES) {
      // The stride spent the whole budget on the way to a frame short of the end.
      // Drop the frame it stopped on, and put the moment back to the one before it:
      // a kept frame's restated delta is measured from exactly that moment, so
      // subtracting it recovers it, and the last frame's own delta then spans the
      // gap the two of them leave.
      const displaced = kept[kept.length - 1];
      kept.length -= 1;
      previousMs = displaced.timeMs - displaced.deltaMs;
    }
    keep(last);
  }

  return retable(recording, kept);
}

/**
 * Write a recording out, reporting rather than raising anything that goes wrong.
 *
 * A capture that closed no frames writes nothing. There is no picture in it to
 * draw, and a file holding an empty frame list would be collected as an output that
 * turned up — the run would tell the reviewer there is a replay to watch and the
 * player would open on nothing.
 *
 * What lands on disk is gzip rather than raw JSON. A recording is text made almost
 * entirely of numbers, index lists and field names repeated once per frame, which
 * is close to the shape gzip is best at. Every host that serves one declares the
 * encoding, so the browser inflates it before the player sees it.
 *
 * Never throws. A directory that cannot be made or a file that cannot be written
 * says something about the machine the validators ran on, and failing the point
 * over it would blame the build for the host's problem.
 */
function writeReplay(destination: string, recording: Recording): void {
  if (recording.frames.length === 0) return;
  try {
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, gzipSync(JSON.stringify(thinReplay(recording))));
  } catch (error) {
    console.warn(
      `arc foundry: could not write ${destination}: ${String(error)}`,
    );
  }
}

/**
 * Record the frames `scenario` draws and keep them as the review item's `outputId`
 * output, handing back whatever the scenario returned.
 *
 * Wrap the drive, not the arrangement:
 *
 * ```ts
 * const cleared = await captureReplay(h, "wave", () => clearWave(h));
 * assertEqual(cleared.hit, true);
 * ```
 *
 * The assertions stay exactly where they were and read exactly what they did.
 * Capture sits BESIDE them rather than in place of them.
 */
export async function captureReplay<T>(
  h: Harness,
  outputId: string,
  scenario: () => T | Promise<T>,
): Promise<T> {
  const destination = mediaDestination(outputId, "json.gz");
  if (destination === null) return scenario();

  h.engine.startRecording();
  try {
    return await scenario();
  } finally {
    // In a `finally`, so a scenario that failed still leaves its evidence behind.
    writeReplay(destination, h.engine.stopRecording());
  }
}

/**
 * Keep the frame currently on the canvas as the review item's `outputId` output.
 *
 * The companion to {@link captureReplay}, for a point whose evidence is one PICTURE
 * rather than a stretch of motion: which screen the game opened on, what the
 * inspector drew for a selected structure, how the recipe book laid its twelve out.
 *
 * What is written is whatever the last frame that RAN left behind, so call it after
 * the frame that poses the thing under test — an `advance(1)` following the
 * arrangement — and before the assertions, so a check that fails still leaves the
 * picture that shows why.
 */
export function captureStill(h: Harness, outputId: string): void {
  const destination = mediaDestination(outputId, "png");
  if (destination === null) return;
  try {
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, h.canvas.toBuffer("image/png"));
  } catch (error) {
    console.warn(
      `arc foundry: could not write ${destination}: ${String(error)}`,
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Cues                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Record every cue the build plays from now on, stamped with its frame.
 *
 * The engine publishes `cue:played` synchronously from inside `audio.play`, so the
 * handler runs while the frame that played it is still running and
 * `engine.frame().count` is that frame's own number. That is what lets a check
 * assert not merely that a cue sounded but that it sounded on the frame of the kill
 * — which is what tells a build that plays its cue on the right event apart from
 * one that plays it on every frame, or a frame late.
 *
 * The cue's NAME is the engine's to report, so a check names the cue it expects:
 * a build that plays its leak blip on every kill is caught here.
 */
export function watchCues(h: Harness): TimedCue[] {
  const played: TimedCue[] = [];
  h.engine.events.on("cue:played", ({ cue, t, gain }) => {
    played.push({ cue, t, gain, frame: h.engine.frame().count });
  });
  return played;
}

/* -------------------------------------------------------------------------- */
/* Reading a snapshot                                                         */
/* -------------------------------------------------------------------------- */
//
// A snapshot is a plain document, so these are pure functions over one. They exist
// so that a check reads what it is about by name and fails by assertion when the
// thing it named is not there, rather than dereferencing `undefined` a few lines
// later and reporting a `TypeError` where a verdict belonged.

/** The live unit of that id, or a failure naming the id and what was on the yard. */
export function unitById(snapshot: FoundrySnapshot, id: number): UnitView {
  const found = snapshot.units.find((u) => u.id === id);
  assertTruthy(
    found,
    `snapshot().units to carry the unit #${id}; it carries ${
      snapshot.units.length === 0
        ? "none"
        : snapshot.units.map((u) => `#${u.id}`).join(", ")
    }`,
  );
  return found as UnitView;
}

/** The structure of that id, or a failure naming the id and what was on the yard. */
export function structureById(
  snapshot: FoundrySnapshot,
  id: number,
): StructureView {
  const found = snapshot.structures.find((s) => s.id === id);
  assertTruthy(
    found,
    `snapshot().structures to carry the structure #${id}; it carries ${
      snapshot.structures.length === 0
        ? "none"
        : snapshot.structures.map((s) => `#${s.id}`).join(", ")
    }`,
  );
  return found as StructureView;
}

/**
 * The last unit the snapshot reports, which `specs/instrumentation.md` fixes as the
 * one `spawnUnit` just released.
 */
export function lastUnit(snapshot: FoundrySnapshot): UnitView {
  const found = snapshot.units[snapshot.units.length - 1];
  assertTruthy(
    found,
    "snapshot().units to carry the unit spawnUnit just released, as its last " +
      "entry (specs/instrumentation.md); it is empty",
  );
  return found as UnitView;
}

/**
 * The last structure the snapshot reports, which `specs/instrumentation.md` fixes
 * as the one the `place` operation just stood up.
 */
export function lastStructure(snapshot: FoundrySnapshot): StructureView {
  const found = snapshot.structures[snapshot.structures.length - 1];
  assertTruthy(
    found,
    "snapshot().structures to carry the structure just placed, as its last " +
      "entry (specs/instrumentation.md); it is empty",
  );
  return found as StructureView;
}

/** The structure anchored at that tile, or `undefined`. */
export function structureAt(
  snapshot: FoundrySnapshot,
  col: number,
  row: number,
): StructureView | undefined {
  return snapshot.structures.find((s) => s.col === col && s.row === row);
}

/** Every structure that fires: the seven firing base types and the towers. */
export function firingStructures(snapshot: FoundrySnapshot): StructureView[] {
  return snapshot.structures.filter((s) => s.targeting !== null);
}

/**
 * The progress ordering of `specs/pathing.md`, furthest along the chain first.
 *
 * Compared first by the checkpoint the unit is heading for, and then, among units
 * heading for the same one, by the REMAINING route length to it — so a shorter
 * `progress` is further along. This is the ordering `first` and `last` select on,
 * and the tie-break every targeting priority resolves toward.
 */
export function compareAlongChain(a: UnitView, b: UnitView): number {
  if (a.waypointIndex !== b.waypointIndex) {
    return b.waypointIndex - a.waypointIndex;
  }
  return a.progress - b.progress;
}

/** The units of a snapshot, ordered furthest along the chain first. */
export function alongChain(snapshot: FoundrySnapshot): UnitView[] {
  return [...snapshot.units].sort(compareAlongChain);
}

/** The priority `steps` activations of the targeting control past `current`. */
export function targetingAfter(current: Targeting, steps: number): Targeting {
  const at = TARGETING_PRIORITIES.indexOf(current);
  assertTruthy(at >= 0, `a targeting priority; received ${String(current)}`);
  const n = TARGETING_PRIORITIES.length;
  return TARGETING_PRIORITIES[(at + (steps % n) + n) % n]!;
}

/* -------------------------------------------------------------------------- */
/* Compound sequences                                                         */
/* -------------------------------------------------------------------------- */
//
// The surface is atomic by design, so opening a run, emptying the yard, standing
// one structure up and releasing one held unit are each several operations in a
// fixed order. Every one of them lives here, so a suite says what its scenario is
// about in one line and every suite says it the same way. A check that needs only
// part of a sequence calls the operations it needs.
//
// Nothing here poses an outcome. Each of these arranges a precondition through the
// same systems play uses — a placed rock rolls through the real press, a released
// unit walks the real pathfinder — and what happens next comes from advancing the
// real simulation.

/** What a run opens as, and what the yard holds when it opens. */
export interface YardOptions {
  /** The map the run opens on. Defaults to the reset value, `substation`. */
  map?: MapId;
  /** The difficulty. Defaults to the reset value, `medium`. */
  difficulty?: DifficultyId;
  /** The seed every random draw runs off. Defaults to `DEFAULT_SEED`. */
  seed?: number;
  /** The wave units released from now on scale to. */
  wave?: number;
  /** Charge in the bank. */
  charge?: number;
  /** Grid Integrity remaining. */
  integrity?: number;
  /** The refinement level, and with it the roll odds. */
  refinement?: number;
  /** The stamps left in the level's allowance. */
  stamps?: number;
  /** The speed multiplier. Defaults to the reset value, `1`. */
  speed?: number;
}

/**
 * A run at its first build phase, entered the way choosing a difficulty enters
 * one: reset to the title, choose the map and the difficulty, start the run.
 *
 * What it arranges is exactly the opening allocation `specs/campaign.md` states,
 * because `startRun` takes the path confirming the difficulty select takes.
 */
export function openRun(h: Harness, options: YardOptions = {}): void {
  h.debug.reset(
    options.seed === undefined ? undefined : { seed: options.seed },
  );
  if (options.map !== undefined) h.debug.setMap(options.map);
  if (options.difficulty !== undefined)
    h.debug.setDifficulty(options.difficulty);
  h.debug.startRun();
}

/**
 * Everything off the yard: every structure, every live unit, every projectile.
 *
 * The isolation the validator guide asks for, in one line. `clearStructures` also
 * clears the selection and the combine set and recomputes the route, and
 * `clearUnits` kills nothing and leaks nothing, so no bounty is paid and no Grid
 * Integrity is lost by emptying the yard.
 */
export function emptyYard(h: Harness): void {
  h.debug.clearStructures();
  h.debug.clearUnits();
  h.debug.clearProjectiles();
}

/**
 * THE OPENING LINE OF ALMOST EVERY CHECK: a run on an empty yard, posed to the
 * resources and the progress the scenario needs.
 *
 * The order matters and is fixed here so no suite has to think about it: the run
 * opens first, because `startRun` installs the opening allocation over anything
 * posed before it, and the resources are posed after, because a check that wants
 * `500` Charge wants it whatever the run opened with.
 */
export function openYard(h: Harness, options: YardOptions = {}): void {
  openRun(h, options);
  emptyYard(h);
  if (options.wave !== undefined) h.debug.setWave(options.wave);
  if (options.charge !== undefined) h.debug.setCharge(options.charge);
  if (options.integrity !== undefined) h.debug.setIntegrity(options.integrity);
  if (options.refinement !== undefined) {
    h.debug.setRefinement(options.refinement);
  }
  if (options.stamps !== undefined) h.debug.setStamps(options.stamps);
  if (options.speed !== undefined) h.debug.setSpeed(options.speed);
}

/**
 * Put away whatever is held on the cursor, through the pose that does only that.
 *
 * `placeRock` goes through the real continuous-placement path, so it re-arms the
 * press the moment the rock lands (`specs/scrap-press.md`), and the panel then shows
 * the held-rock read rather than the inspector — `panelButtons` comes back EMPTY. So
 * almost every scenario that stands a candidate up has a rock on the cursor it never
 * asked for, and has to put it away before it can read anything else.
 *
 * `clearHeld` is the operation `specs/instrumentation.md` gives for exactly that: it
 * empties the cursor, spends no stamp, refunds none, and changes nothing else. It is
 * a pose rather than a key, so it costs no frame and it drives nothing outside the
 * requirement a check is about. {@link cancelHeldWithBack} is the other route, and it
 * belongs to the two checks that are about the `back` control itself.
 */
export function clearHand(h: Harness): void {
  h.debug.clearHeld();
}

/**
 * Put a held rock away the way a PLAYER does, with the `back` action.
 *
 * `specs/controls.md` resolves `back` against the first of several things that
 * applies, and a held rock is the first of them. This is the real key event, so it
 * costs the one frame that delivers the edge — and it belongs only to a check whose
 * requirement IS that control. Every other check uses {@link clearHand}, which
 * reaches the same state without pressing anything.
 */
export function cancelHeldWithBack(h: Harness): Promise<void> {
  return pressAction(h, "back");
}

/** Refill the level's stamp allowance, for a scenario that needs a sixth rock. */
export function refillStamps(h: Harness): void {
  h.debug.setStamps(STAMPS_PER_LEVEL);
}

/* ---- Standing one structure up -------------------------------------------- */
//
// Each of these stands exactly one thing on the yard and hands back its id, read
// off the snapshot's last entry as `specs/instrumentation.md` fixes it. Each
// asserts the placement landed, so a scenario that asked for an anchor the
// never-seal rule refuses fails where it asked rather than several frames later
// with a structure it never got.

/** The id the structure a `place` operation just appended carries. */
function placed(
  snapshot: FoundrySnapshot,
  before: number,
  what: string,
): number {
  assertTruthy(
    snapshot.structures.length === before + 1,
    `${what} to stand one structure up and append it to snapshot().structures ` +
      `(specs/instrumentation.md); the yard went from ${before} structures to ` +
      `${snapshot.structures.length}`,
  );
  return lastStructure(snapshot).id;
}

/** A permanent firing component of that type and quality, at that anchor. */
export function standComponent(
  h: Harness,
  type: ComponentType,
  quality: Tier,
  col: number,
  row: number,
): number {
  const before = h.snapshot().structures.length;
  h.debug.placeComponent(type, quality, col, row);
  return placed(
    h.snapshot(),
    before,
    `placeComponent(${type}, ${quality}, ${col}, ${row})`,
  );
}

/** A combination tower at that anchor, landed at level `0` and raised to `level`. */
export function standCombo(
  h: Harness,
  combo: ComboId,
  col: number,
  row: number,
  level = 0,
): number {
  const before = h.snapshot().structures.length;
  h.debug.placeCombo(combo, col, row);
  const id = placed(
    h.snapshot(),
    before,
    `placeCombo(${combo}, ${col}, ${row})`,
  );
  if (level !== 0) h.debug.setComboLevel(id, level);
  return id;
}

/** An inert blocker at that anchor: a wall with no head and no glow. */
export function standBlocker(h: Harness, col: number, row: number): number {
  const before = h.snapshot().structures.length;
  h.debug.placeBlocker(col, row);
  return placed(h.snapshot(), before, `placeBlocker(${col}, ${row})`);
}

/**
 * A candidate of a chosen type and quality, dropped through the real press.
 *
 * The roll is armed first, so the rock that lands rolls exactly what the scenario
 * asked for; the drop itself still goes through the placement path, so it spends a
 * stamp and is refused exactly where a pointer press would be.
 *
 * THE HAND IS LEFT EMPTY, AND NOTHING IS PRESSED TO EMPTY IT. Placement is
 * continuous (`specs/scrap-press.md`), so a drop that leaves stamps in the allowance
 * arms the next rock immediately and the panel draws the held-rock read instead of
 * the inspector. `clearHeld` puts that rock away and does nothing else
 * (`specs/instrumentation.md`): no stamp is spent, none is refunded, no frame runs,
 * and the yard the check reads is the one the drop left. Nothing here touches the
 * allowance, so a check that cares what the drop cost reads the real figure.
 */
export function standCandidate(
  h: Harness,
  type: ComponentType,
  quality: Tier,
  col: number,
  row: number,
): number {
  const opening = h.snapshot();
  const before = opening.structures.length;
  assertTruthy(
    opening.stampsLeft > 0,
    `the level's stamp allowance to have a stamp left for a rock at ` +
      `(${col}, ${row}); stampsLeft is ${opening.stampsLeft}`,
  );
  h.debug.setNextRoll(type, quality);
  h.debug.placeRock(col, row);
  h.debug.clearNextRoll();
  h.debug.clearHeld();
  return placed(
    h.snapshot(),
    before,
    `placeRock(${col}, ${row}) armed to roll ${type} at quality ${quality}`,
  );
}

/** Select a structure, as a pointer press on it would. */
export function selectStructure(h: Harness, id: number): void {
  h.debug.select(id);
}

/* ---- Releasing one unit --------------------------------------------------- */

/**
 * How a released unit is posed, one faculty at a time.
 *
 * Isolation reaches inside the entity: a check about a burn's damage wants a unit
 * that burns and does not walk, and a check about a slow's expiry wants one that
 * walks and carries a slow. So each faculty a scenario must hold is its own field
 * here, and every one it leaves out is left exactly as the spawner set it.
 */
export interface UnitPose {
  /** A logical position to stand it at. */
  at?: Point;
  /** Or the center of a tile to stand it at. */
  tile?: { col: number; row: number };
  /** The checkpoint it heads for, `1`–`7`, where `7` is the collector. */
  waypoint?: number;
  /** Its current health, at least `1` and at most its maximum. */
  hp?: number;
  /** A slow, applied through the rule `specs/enemies.md` fixes. */
  slow?: { amount: number; seconds: number };
  /** A burn, applied through the same rule, credited to no structure. */
  burn?: { dps: number; seconds: number };
  /** Travel held, and nothing else held with it. */
  frozen?: boolean;
}

/**
 * One unit of that type at the map's entry, scaled to the current wave, posed.
 *
 * `spawnUnit` releases through the real spawner and so puts the run into a live
 * wave whose spawn schedule is empty: the units on the yard are exactly the ones
 * released here and nothing else arrives. That wave clears the ordinary way, when
 * every one of them has died or leaked, and clearing it pays the ordinary wave-clear
 * bonus — so a check reading `charge` after a kill either holds that resolution with
 * {@link holdWave} or expects the bounty and the bonus.
 *
 * The poses are applied in the order `specs/instrumentation.md` leaves them
 * independent in: the checkpoint first, because setting it moves the unit nowhere,
 * then the position, then the health, then the statuses, and the travel hold last so
 * nothing after it has to think about whether the unit moved.
 */
export function releaseUnit(
  h: Harness,
  type: SpawnType,
  pose: UnitPose = {},
): number {
  const before = h.snapshot().units.length;
  h.debug.spawnUnit(type);
  const after = h.snapshot();
  assertTruthy(
    after.units.length === before + 1,
    `spawnUnit(${type}) to release one unit and append it to snapshot().units ` +
      `(specs/instrumentation.md); the yard went from ${before} units to ` +
      `${after.units.length}`,
  );
  const id = lastUnit(after).id;

  if (pose.waypoint !== undefined) h.debug.setUnitWaypoint(id, pose.waypoint);
  const at =
    pose.at ??
    (pose.tile === undefined
      ? undefined
      : tileCenter(pose.tile.col, pose.tile.row));
  if (at !== undefined) h.debug.setUnitPosition(id, at.x, at.y);
  if (pose.hp !== undefined) h.debug.setUnitHp(id, pose.hp);
  if (pose.slow !== undefined) {
    h.debug.setUnitSlow(id, pose.slow.amount, pose.slow.seconds);
  }
  if (pose.burn !== undefined) {
    h.debug.setUnitBurn(id, pose.burn.dps, pose.burn.seconds);
  }
  if (pose.frozen !== undefined) h.debug.setUnitFrozen(id, pose.frozen);
  return id;
}

/**
 * One unit standing still at a chosen point, keeping every faculty but travel.
 *
 * The workhorse of this project. A held unit is targetable, it takes damage, its
 * burn ticks, its slow runs down and expires, and its body holds the position it
 * was posed at however long the scenario runs — so a check about damage, about a
 * status effect, or about which unit a priority picks reads a number that moved for
 * exactly one reason.
 */
export function parkUnit(
  h: Harness,
  type: SpawnType,
  at: Point,
  pose: Omit<UnitPose, "at" | "tile" | "frozen"> = {},
): number {
  return releaseUnit(h, type, { ...pose, at, frozen: true });
}

/**
 * Put the run into a live wave without releasing anything into it.
 *
 * `setPhase` moves the run between its phases and does nothing else
 * (`specs/instrumentation.md`): the wave it opens has an empty spawn schedule, so
 * nothing arrives, and the yard holds whatever it already held. A check whose
 * requirement is about what the wave phase changes — which controls go inert, what
 * the bar reads, whether a combine is still offered — poses the phase and stops
 * there, instead of releasing a unit it then has to keep quiet.
 *
 * A wave with nothing on the yard resolves its clear on the next advance, so a check
 * that advances frames pairs this with {@link holdWave}.
 */
export function enterWave(h: Harness): void {
  h.debug.setPhase("wave");
}

/** Put the run back into a build phase, paying no bonus and spending no wave. */
export function enterBuild(h: Harness): void {
  h.debug.setPhase("build");
}

/**
 * Hold the wave's own clear-and-pay resolution, so the wave cannot end under a check
 * that is reading across a kill or a leak.
 *
 * Clearing a wave pays the wave-clear bonus, and a bonus landing in the middle of a
 * check reading `charge` would be indistinguishable from the bounty it was measuring.
 * `setWaveHold` holds exactly that resolution and nothing else
 * (`specs/instrumentation.md`): the bounty is still paid, the leak still costs Grid
 * Integrity, structures still fire, and defeat still resolves at zero.
 *
 * IT REPLACES A BYSTANDER. The world stays holding only what the requirement is
 * about, rather than a spare Mote parked at the entry to keep the wave running —
 * which would lean on the build's own freeze and on nothing shooting that far, and
 * would report a defect belonging to another check the moment either gave way.
 */
export function holdWave(h: Harness): void {
  h.debug.setWaveHold(true);
}

/** Release the wave-clear hold, so the wave resolves the ordinary way again. */
export function releaseWaveHold(h: Harness): void {
  h.debug.setWaveHold(false);
}

/**
 * A live wave over the yard exactly as it stands, and one that stays open.
 *
 * The two gates together: {@link holdWave} so the wave's resolution cannot end it,
 * then {@link enterWave} so the run is in it. A wave with nothing left to release and
 * nothing on the yard clears on the next advance (`specs/instrumentation.md`), so a
 * check that poses the phase and then runs frames needs both.
 *
 * Nothing is released and nothing is parked, so the yard holds only what the check's
 * own requirement put there.
 */
export function openHeldWave(h: Harness): void {
  holdWave(h);
  enterWave(h);
}

/**
 * Commit the level's harvest, which is what starts the wave.
 *
 * There is no send control (`specs/campaign.md`): a wave begins when a candidate is
 * kept, downgraded, or folded into a combine. So this stands one candidate at the
 * anchor given and keeps it, and the wave the level composed starts on the next
 * advance. The component it leaves standing is the one the harvest produced, and its
 * id comes back.
 */
export function startWave(
  h: Harness,
  type: ComponentType,
  quality: Tier,
  col: number,
  row: number,
): number {
  const candidate = standCandidate(h, type, quality, col, row);
  h.debug.keep(candidate);
  return candidate;
}

/* -------------------------------------------------------------------------- */
/* Controls                                                                   */
/* -------------------------------------------------------------------------- */
//
// A control is found by the action it carries rather than by where it was drawn,
// because `specs/hud.md` fixes each menu's content and navigation and leaves its
// layout to the build. The rectangle a reading reports is the control's real hit
// region, so pressing the center of a reported, non-disabled rectangle activates it
// — which is how a check operates the game the way a player does without knowing
// anything about the build's layout.

/** A rectangle a reading reports. */
export interface ControlRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The center of a reported control rectangle. */
export function controlCenter(rect: ControlRect): Point {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/**
 * A point on the stage inside none of `rects`.
 *
 * `specs/ui.md` gives an edge "outside every region" an outcome of its own, and
 * where a menu draws its entries is the build's, so a point outside every one of
 * them is SEARCHED FOR over the stage rather than named here: a build that draws
 * its menu somewhere else still has the point decided against its own layout. The
 * stage is walked on a coarse lattice, inset from the edges so the point is one a
 * player could really put a finger on, and the first square inside no reported
 * rectangle is taken.
 */
export function pointOutside(rects: readonly ControlRect[]): Point {
  const STEP = 20;
  const INSET = 10;
  for (let y = INSET; y <= STAGE_H - INSET; y += STEP) {
    for (let x = INSET; x <= STAGE_W - INSET; x += STEP) {
      const covered = rects.some(
        (r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h,
      );
      if (!covered) return { x, y };
    }
  }
  return fail(
    "somewhere on the stage outside every reported menu rectangle",
    "every point covered by one",
  );
}

/**
 * A press and a release at a logical point: one click, and the frame that delivers
 * it.
 *
 * The pointer is moved onto the point before the press, because that is what a real
 * pointer does and because a build is entitled to hover before it commits. Both
 * edges are delivered before the frame runs, because `specs/ui.md` takes a menu
 * entry "only when both edges of the gesture fall inside one entry's region": a
 * click whose release never reached the game would take no entry at all.
 */
export async function clickAt(h: Harness, x: number, y: number): Promise<void> {
  h.pointerMove(x, y);
  h.pointerDown(x, y);
  h.pointerUp(x, y);
  await h.advance(1);
}

/**
 * Move the pointer onto a logical point, without pressing.
 *
 * `specs/controls.md` gives a bare move effects of its own — the menu highlight
 * follows it, the held footprint snaps under it — so a check about a hover delivers
 * the move alone and nothing else.
 */
export async function hoverAt(h: Harness, x: number, y: number): Promise<void> {
  h.pointerMove(x, y);
  await h.advance(1);
}

/** Move the pointer onto the center of a reported control rectangle. */
export function hoverControl(h: Harness, rect: ControlRect): Promise<void> {
  const point = controlCenter(rect);
  return hoverAt(h, point.x, point.y);
}

/**
 * Press at one logical point and release at another.
 *
 * The gesture `specs/ui.md` takes no entry for: "Two edges in different regions take
 * no entry, and an edge outside every region takes none."
 */
export async function pointerDrag(
  h: Harness,
  from: Point,
  to: Point,
): Promise<void> {
  h.pointerMove(from.x, from.y);
  h.pointerDown(from.x, from.y);
  h.pointerMove(to.x, to.y);
  h.pointerUp(to.x, to.y);
  await h.advance(1);
}

/** A touch contact landing and lifting at one logical point: a tap. */
export async function tapAt(h: Harness, x: number, y: number): Promise<void> {
  h.touchStart(x, y);
  h.touchEnd();
  await h.advance(1);
}

/** Tap the center of a reported control rectangle. */
export function tapControl(h: Harness, rect: ControlRect): Promise<void> {
  const point = controlCenter(rect);
  return tapAt(h, point.x, point.y);
}

/**
 * Land a touch contact at one logical point and travel it to another, leaving it
 * down, so what the travel alone changes can be read before the lift.
 */
export async function touchOnto(
  h: Harness,
  from: Point,
  to: Point,
): Promise<void> {
  h.touchStart(from.x, from.y);
  h.touchMove(to.x, to.y);
  await h.advance(1);
}

/** Land a contact at one logical point, travel it to another, and lift it there. */
export async function touchDrag(
  h: Harness,
  from: Point,
  to: Point,
): Promise<void> {
  h.touchStart(from.x, from.y);
  h.touchMove(to.x, to.y);
  h.touchEnd();
  await h.advance(1);
}

/** A click at the center of a tile. */
export function clickTile(h: Harness, col: number, row: number): Promise<void> {
  const point = tileCenter(col, row);
  return clickAt(h, point.x, point.y);
}

/** A click at the center of a structure anchored at that tile. */
export function clickStructure(
  h: Harness,
  col: number,
  row: number,
): Promise<void> {
  const point = structureCenter(col, row);
  return clickAt(h, point.x, point.y);
}

/** A click at the center of a reported control rectangle. */
export function clickControl(h: Harness, rect: ControlRect): Promise<void> {
  const point = controlCenter(rect);
  return clickAt(h, point.x, point.y);
}

function describeControls(drawn: readonly { action: string }[]): string {
  return drawn.length === 0
    ? "none"
    : drawn.map((c) => `\`${c.action}\``).join(", ");
}

/** The inspector's control carrying that action, or a failure naming what was drawn. */
export function panelControl(
  h: Harness,
  action: PanelAction,
  label?: string,
): PanelButton {
  const drawn = h.debug.panelButtons();
  const found = drawn.find(
    (b) => b.action === action && (label === undefined || b.label === label),
  );
  assertTruthy(
    found,
    `panelButtons() to carry a \`${action}\` control${
      label === undefined ? "" : ` labelled ${label}`
    } (specs/instrumentation.md); it carries ${describeControls(drawn)}`,
  );
  return found as PanelButton;
}

/** The panel's own control carrying that action, or a failure naming what was drawn. */
export function pressControl(h: Harness, action: PressAction): PressButton {
  const drawn = h.debug.pressControls();
  const found = drawn.find((c) => c.action === action);
  assertTruthy(
    found,
    `pressControls() to carry a \`${action}\` control ` +
      `(specs/instrumentation.md); it carries ${describeControls(drawn)}`,
  );
  return found as PressButton;
}

/** The menu choice carrying that action, or a failure naming what was drawn. */
export function menuControl(h: Harness, action: MenuAction): MenuButton {
  const drawn = h.debug.menuButtons();
  const found = drawn.find((b) => b.action === action);
  assertTruthy(
    found,
    `menuButtons() to carry a \`${action}\` choice (specs/instrumentation.md); ` +
      `it carries ${describeControls(drawn)}`,
  );
  return found as MenuButton;
}

/** The status-bar control carrying that action, or a failure naming what was drawn. */
export function statusControl(h: Harness, action: StatusAction): StatusControl {
  const drawn = h.debug.statusControls();
  const found = drawn.find((c) => c.action === action);
  assertTruthy(
    found,
    `statusControls() to carry a \`${action}\` control ` +
      `(specs/instrumentation.md); it carries ${describeControls(drawn)}`,
  );
  return found as StatusControl;
}

/**
 * The status bar's reported rectangle for one of its READS.
 *
 * `specs/hud.md` fixes what the bar shows and the order it shows it in and leaves
 * every rectangle to the build, so a check that has to stand the pointer on a read —
 * the maze-length hover of `specs/controls.md` is the one that does — asks the build
 * where it drew it rather than searching the bar for it.
 */
export function statusReadout(
  h: Harness,
  readout: StatusReadoutName,
): StatusReadout {
  const drawn = h.debug.statusReadouts();
  const found = drawn.find((r) => r.readout === readout);
  assertTruthy(
    found,
    `statusReadouts() to carry a \`${readout}\` read ` +
      `(specs/instrumentation.md); it carries ` +
      `${drawn.length === 0 ? "nothing" : drawn.map((r) => r.readout).join(", ")}`,
  );
  return found as StatusReadout;
}

/**
 * Every ingredient cell the recipe book is drawing, as the build reports them.
 *
 * `specs/hud.md` requires every ingredient of every recipe to be drawn in one of
 * three states and leaves the book's layout to the build, so
 * `specs/instrumentation.md` has the build report each cell's rectangle and the state
 * it drew it in. A check reads the state here and samples the reported rectangle for
 * the "told apart at a glance" half.
 */
export function recipeEntries(h: Harness): RecipeEntry[] {
  return h.debug.recipeEntries();
}

/** The book's cells for one recipe, in the order that recipe lists its ingredients. */
export function recipeCells(h: Harness, combo: ComboId): RecipeEntry[] {
  const all = recipeEntries(h);
  const mine = all
    .filter((e) => e.combo === combo)
    .sort((a, b) => a.ingredient - b.ingredient);
  assertTruthy(
    mine.length > 0,
    `recipeEntries() to carry the ${combo}'s ingredient cells while the recipe ` +
      `book is open (specs/instrumentation.md); it carries ` +
      `${all.length} cell(s) across ` +
      `${new Set(all.map((e) => e.combo)).size} recipe(s)`,
  );
  return mine;
}

/** One recipe's cell states, in recipe order. */
export function recipeStateOf(h: Harness, combo: ComboId): IngredientState[] {
  return recipeCells(h, combo).map((e) => e.state);
}

/** Find the inspector's control by action and press its center. */
export function pressPanel(
  h: Harness,
  action: PanelAction,
  label?: string,
): Promise<void> {
  return clickControl(h, panelControl(h, action, label));
}

/** Find the panel's own control by action and press its center. */
export function pressPressControl(
  h: Harness,
  action: PressAction,
): Promise<void> {
  return clickControl(h, pressControl(h, action));
}

/** Find the menu choice by action and press its center. */
export function pressMenu(h: Harness, action: MenuAction): Promise<void> {
  return clickControl(h, menuControl(h, action));
}

/** Find the status-bar control by action and press its center. */
export function pressStatus(h: Harness, action: StatusAction): Promise<void> {
  return clickControl(h, statusControl(h, action));
}

/**
 * Fire one action from the keyboard, through the engine's own input path.
 *
 * A real press and release of the key `specs/controls.md` binds the action to,
 * dispatched at the engine's surface, and the one frame that delivers the edge. The
 * engine discards an edge nothing consumed by the end of the frame it was armed in,
 * so the frame is what makes the press reach the game.
 *
 * Every action but `modify` is read as a press edge, so this fires it exactly once.
 * `modify` is read as a level and is held with {@link withModify} instead.
 */
export function pressAction(h: Harness, action: ActionName): Promise<void> {
  return h.tap(keyFor(action));
}

/**
 * Run `body` with the `modify` action held, as a player holding Shift does.
 *
 * `modify` is read as a level rather than as an edge: what the game reads is whether
 * its key is down at the moment it reads it, so it modifies whatever act it is held
 * across — which means `body` must run the frame that resolves the press. The
 * release is in a `finally`, so a failing body cannot leave the key down under the
 * check that runs next.
 */
export async function withModify<T>(
  h: Harness,
  body: () => T | Promise<T>,
): Promise<T> {
  const key = keyFor("modify");
  h.hold(key);
  try {
    return await body();
  } finally {
    h.release(key);
  }
}

/**
 * Show a menu screen and hand back the choices it presents, in order.
 *
 * `setScreen` moves to the screen exactly as reaching it in play does, and
 * `menuButtons` is a pure reading of the state, so the choices come back without the
 * check advancing anything.
 */
export function openMenu(h: Harness, screen: Screen): MenuButton[] {
  h.debug.setScreen(screen);
  return h.debug.menuButtons();
}

/**
 * Open or close a read-only overlay, and confirm the snapshot agrees.
 *
 * Both overlays are inert (`specs/hud.md`): opening one changes what is drawn and
 * nothing else, so this is an arrangement rather than an act.
 */
export function setOverlay(
  h: Harness,
  overlay: OverlayName,
  open: boolean,
): void {
  h.debug.setOverlay(overlay, open);
}

/* -------------------------------------------------------------------------- */
/* Colour, read off the rendered canvas                                       */
/* -------------------------------------------------------------------------- */
//
// The palette is the build's own (`specs/overview.md`), so nothing here knows a
// colour: the samplers compare what was painted against what else was painted, or
// against the background the build declared.

/** A sampled colour, each channel 0–255. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * The rendered colour at a logical point, averaged over a small cluster.
 *
 * The centre pixel plus four neighbours `spread` units out, so one stray
 * anti-aliased pixel cannot swing the reading. Sample at least two logical pixels
 * inside an edge: an edge is anti-aliased and blends toward whatever is behind it,
 * and only an interior pixel is the fill.
 */
export function sampleColor(h: Harness, x: number, y: number, spread = 2): Rgb {
  const points: Point[] = [
    { x, y },
    { x: x + spread, y },
    { x: x - spread, y },
    { x, y: y + spread },
    { x, y: y - spread },
  ];
  let r = 0;
  let g = 0;
  let b = 0;
  for (const [pr, pg, pb] of h.pixels(points)) {
    r += pr;
    g += pg;
    b += pb;
  }
  return { r: r / points.length, g: g / points.length, b: b / points.length };
}

/** Euclidean distance between two colours, 0 to about 441. */
export function colorDistance(a: Rgb, b: Rgb): number {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

/** A colour's luminance. */
export function luminance(c: Rgb): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/**
 * The build's exported `BACKGROUND`, rasterized: the colour the engine clears the
 * whole canvas to each frame, read back through the same canvas implementation the
 * harness samples with, so a pixel the game never drew over compares against it
 * exactly.
 *
 * The fill is repeated rather than applied once so a translucent colour reads as the
 * engine leaves it: the engine composites its clear over the previous frame every
 * frame, which converges on the colour's own channels, and a single fill over a
 * transparent canvas would not.
 */
export function clearColor(): Rgb {
  const probe = createCanvas(1, 1);
  const ctx = probe.getContext("2d");
  ctx.fillStyle = BACKGROUND;
  for (let i = 0; i < 255; i += 1) ctx.fillRect(0, 0, 1, 1);
  const { data } = ctx.getImageData(0, 0, 1, 1);
  return { r: data[0]!, g: data[1]!, b: data[2]! };
}

/* -------------------------------------------------------------------------- */
/* What a check reads off one drawn frame                                     */
/* -------------------------------------------------------------------------- */
//
// Everything below is a pure function over one frame's recorded operations or
// over a grid of sampled pixels, and every category that decides a point from
// what the build DREW reads it from here.
//
// WHY A FRAME'S TEXT IS NOT SIMPLY `callsTo(calls, "fillText")`. Two reasons, and
// a suite that ignored either would grade a build's layout choices rather than
// its reads.
//
//  1. A BUILD DRAWS UNDER ITS OWN TRANSFORM. `specs/overview.md` fixes the three
//     regions in the stage's logical units and says nothing about how a build
//     gets its pen there, so a bar drawn at a translated origin has to read the
//     same as one drawn in stage coordinates. Every anchor below is therefore
//     mapped through the transform in force at the call, and a check asks for the
//     text of a REGION rather than for the arguments of a call.
//  2. A BUILD IS FREE TO LETTER-SPACE. A label drawn one character at a time is
//     six `fillText` calls and the word `PAUSED` appears in none of them. So the
//     draws of a baseline are joined back into the line they read as: two single
//     characters close together are one word, and anything else is separated —
//     which is also what stops two neighbouring FIGURES from reading as one long
//     number.

/* -------------------------------------------------------------------------- */
/* Regions                                                                    */
/* -------------------------------------------------------------------------- */

/** A rectangle on the `1280 x 720` stage, as a half-open extent. */
export interface Region {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The status bar (`specs/overview.md`). */
export const BAR: Region = { x0: 0, y0: 0, x1: STAGE_W, y1: BAR_H };

/** The build panel (`specs/overview.md`). */
export const PANEL: Region = {
  x0: PANEL_X,
  y0: BAR_H,
  x1: PANEL_X + PANEL_W,
  y1: STAGE_H,
};

/** The yard (`specs/overview.md`). */
export const YARD: Region = {
  x0: BOARD_X,
  y0: BOARD_Y,
  x1: BOARD_X + BOARD_W,
  y1: BOARD_Y + BOARD_H,
};

/** A point falls inside a region. */
export function inRegion(region: Region, x: number, y: number): boolean {
  return x >= region.x0 && x <= region.x1 && y >= region.y0 && y <= region.y1;
}

/* -------------------------------------------------------------------------- */
/* The transform in force                                                     */
/* -------------------------------------------------------------------------- */

type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function at(m: Matrix, x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

/** `count` numbers from `args`, starting at `from`, or `null`. */
function numbers(
  args: readonly unknown[],
  from: number,
  count: number,
): number[] | null {
  const taken: number[] = [];
  for (let i = from; i < from + count; i += 1) {
    const value = args[i];
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    taken.push(value);
  }
  return taken;
}

/* -------------------------------------------------------------------------- */
/* Text                                                                       */
/* -------------------------------------------------------------------------- */

/** One `fillText` or `strokeText`, with its anchor mapped onto the stage. */
export interface TextDraw {
  text: string;
  x: number;
  y: number;
  /** Where it sat in the frame's operations, so two draws can be ordered. */
  index: number;
}

/** One operation of a frame, with the transform that was in force at it. */
interface Placed {
  call: { method: string; args: unknown[] };
  matrix: Matrix;
  index: number;
}

/**
 * Every call of a frame, each paired with the transform in force when it ran.
 *
 * The transform is tracked rather than assumed, because a build is free to draw
 * its yard, its bar, and its panel from any origin it likes and the
 * specification fixes only where the result lands.
 */
function placedCalls(calls: readonly DrawCall[]): Placed[] {
  const placed: Placed[] = [];
  const stack: Matrix[] = [];
  let m: Matrix = IDENTITY;
  calls.forEach((call, index) => {
    if (call.kind !== "call") return;
    const { method, args } = call;
    if (method === "save") {
      stack.push(m);
    } else if (method === "restore") {
      m = stack.pop() ?? IDENTITY;
    } else if (method === "translate") {
      const v = numbers(args, 0, 2);
      if (v) m = multiply(m, [1, 0, 0, 1, v[0]!, v[1]!]);
    } else if (method === "scale") {
      const v = numbers(args, 0, 2);
      if (v) m = multiply(m, [v[0]!, 0, 0, v[1]!, 0, 0]);
    } else if (method === "rotate") {
      const v = numbers(args, 0, 1);
      if (v) {
        const c = Math.cos(v[0]!);
        const s = Math.sin(v[0]!);
        m = multiply(m, [c, s, -s, c, 0, 0]);
      }
    } else if (method === "transform") {
      const v = numbers(args, 0, 6);
      if (v) m = multiply(m, v as Matrix);
    } else if (method === "setTransform") {
      const v = numbers(args, 0, 6);
      m = v ? (v as Matrix) : IDENTITY;
    } else if (method === "resetTransform") {
      m = IDENTITY;
    }
    placed.push({ call: { method, args }, matrix: m, index });
  });
  return placed;
}

/** Every text draw of a frame, each anchored where it actually landed. */
export function textDraws(calls: readonly DrawCall[]): TextDraw[] {
  const draws: TextDraw[] = [];
  for (const { call, matrix, index } of placedCalls(calls)) {
    if (call.method !== "fillText" && call.method !== "strokeText") continue;
    const text = call.args[0];
    const v = numbers(call.args, 1, 2);
    if (typeof text !== "string" || !v) continue;
    const point = at(matrix, v[0]!, v[1]!);
    draws.push({ text, x: point.x, y: point.y, index });
  }
  return draws;
}

/** One `drawImage`, with the destination it blitted to mapped onto the stage. */
export interface ImageDraw {
  /** The destination rectangle's bounding box on the stage. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Its center, which is where a rotated head lands whatever it was rotated by. */
  cx: number;
  cy: number;
  /** Where it sat in the frame's operations, so two draws can be ordered. */
  index: number;
}

/**
 * Every image a frame blitted, mapped onto the stage.
 *
 * A `drawImage` carries its destination in the last two or four of its
 * arguments; the three-argument form leaves the size to the image itself, which
 * the recorder cannot see, so that form reports a point rather than a rectangle.
 */
export function imageDraws(calls: readonly DrawCall[]): ImageDraw[] {
  const draws: ImageDraw[] = [];
  for (const { call, matrix, index } of placedCalls(calls)) {
    if (call.method !== "drawImage") continue;
    const args = call.args;
    const box =
      args.length >= 9
        ? numbers(args, 5, 4)
        : args.length >= 5
          ? numbers(args, 1, 4)
          : (() => {
              const point = numbers(args, 1, 2);
              return point === null ? null : [point[0]!, point[1]!, 0, 0];
            })();
    if (box === null) continue;
    const [dx, dy, dw, dh] = box as [number, number, number, number];
    const corners = [
      at(matrix, dx, dy),
      at(matrix, dx + dw, dy),
      at(matrix, dx, dy + dh),
      at(matrix, dx + dw, dy + dh),
    ];
    const xs = corners.map((c) => c.x);
    const ys = corners.map((c) => c.y);
    const center = at(matrix, dx + dw / 2, dy + dh / 2);
    draws.push({
      x: Math.min(...xs),
      y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys),
      cx: center.x,
      cy: center.y,
      index,
    });
  }
  return draws;
}

/** How far apart two draws may sit and still read as one letter-spaced word. */
const LETTER_GAP = 24;

/** How far apart two baselines may sit and still read as one line. */
const LINE_GAP = 3;

/**
 * The lines a region's text reads as, top to bottom.
 *
 * Draws sharing a baseline are one line, ordered left to right, and two of them
 * are run together only when both are single characters set close enough to be
 * letter spacing. Everything else is separated by a space, so `473` beside `17`
 * never reads as `47317`.
 */
export function textLines(
  calls: readonly DrawCall[],
  region: Region,
): string[] {
  const draws = textDraws(calls)
    .filter((d) => inRegion(region, d.x, d.y))
    .sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y));
  const lines: string[] = [];
  let baseline: number | null = null;
  let row: TextDraw[] = [];
  const close = (): void => {
    if (row.length === 0) return;
    const ordered = [...row].sort((a, b) => a.x - b.x);
    let line = "";
    let previous: TextDraw | null = null;
    for (const draw of ordered) {
      if (previous !== null) {
        const spaced =
          previous.text.length <= 1 &&
          draw.text.length <= 1 &&
          draw.x - previous.x < LETTER_GAP;
        if (!spaced) line += " ";
      }
      line += draw.text;
      previous = draw;
    }
    lines.push(line);
    row = [];
  };
  for (const draw of draws) {
    if (baseline === null || Math.abs(draw.y - baseline) > LINE_GAP) {
      close();
      baseline = draw.y;
    }
    row.push(draw);
  }
  close();
  return lines;
}

/** Every line of a region, joined, as one reading. */
export function textIn(calls: readonly DrawCall[], region: Region): string {
  return textLines(calls, region).join("\n");
}

/**
 * One reading of a piece of text: its letters and its digits, and nothing else.
 *
 * Case, spacing, and punctuation all come off, on both sides of a comparison,
 * because a build is free to letter-space a label, to wrap a long line, and to
 * set `Arc-Node` as `ARC NODE`. What the specification fixes is the words.
 */
function normalize(text: string): string {
  return text.toUpperCase().replace(/[^A-Z0-9]+/g, "");
}

/** A region's text carries `needle`, read that way. */
export function drew(
  calls: readonly DrawCall[],
  region: Region,
  needle: string,
): boolean {
  return normalize(textLines(calls, region).join(" ")).includes(
    normalize(needle),
  );
}

/** `1,234` reads as one figure rather than as `1` beside `234`. */
function stripGrouping(line: string): string {
  let out = line;
  for (;;) {
    const next = out.replace(/(\d),(\d{3})(?!\d)/g, "$1$2");
    if (next === out) return out;
    out = next;
  }
}

/** Every number a region's text draws, in reading order. */
export function figures(calls: readonly DrawCall[], region: Region): number[] {
  const found: number[] = [];
  for (const line of textLines(calls, region)) {
    for (const match of stripGrouping(line).matchAll(/\d+(?:\.\d+)?/g)) {
      found.push(Number(match[0]));
    }
  }
  return found;
}

/**
 * The figure a region draws for `value`, or a failure naming what it drew.
 *
 * `tolerance` is the room a build has to round: `specs/pathing.md` reports a
 * route length in tiles as a real number, so a bar that draws `168` for `168.4`
 * has drawn the figure.
 */
export function drawnFigure(
  calls: readonly DrawCall[],
  region: Region,
  value: number,
  what: string,
  tolerance = 0.5,
): number {
  const drawn = figures(calls, region);
  const near = drawn
    .filter((f) => Math.abs(f - value) <= tolerance)
    .sort((a, b) => Math.abs(a - value) - Math.abs(b - value));
  if (near.length === 0) {
    fail(
      `${what} drawn as ${value}${tolerance === 0 ? "" : ` (± ${tolerance})`}`,
      drawn,
    );
  }
  return near[0]!;
}

/* -------------------------------------------------------------------------- */
/* Pixels                                                                     */
/* -------------------------------------------------------------------------- */

/** A rectangle a reading reports, as `specs/instrumentation.md` gives it. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The distance two pixels are told apart by, of the 441 the cube spans. */
export const DISTINCT = 50;

/** A lattice of logical points inside a rectangle, `step` units apart. */
export function lattice(rect: Rect, step = 2): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  for (let y = rect.y + step / 2; y < rect.y + rect.h; y += step) {
    for (let x = rect.x + step / 2; x < rect.x + rect.w; x += step) {
      points.push({ x, y });
    }
  }
  return points;
}

type Pixel = [number, number, number, number];

/** The straight-line distance between two colours, ignoring alpha. */
export function rgbDistance(a: Pixel, b: Pixel): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** The furthest apart any one of two samplings of the same points reads. */
export function maxDistance(
  before: readonly Pixel[],
  after: readonly Pixel[],
): number {
  let worst = 0;
  for (let i = 0; i < Math.min(before.length, after.length); i += 1) {
    worst = Math.max(worst, rgbDistance(before[i]!, after[i]!));
  }
  return worst;
}

/** How many of two samplings of the same points read as told apart. */
export function changedPoints(
  before: readonly Pixel[],
  after: readonly Pixel[],
  threshold = DISTINCT,
): number {
  let changed = 0;
  for (let i = 0; i < Math.min(before.length, after.length); i += 1) {
    if (rgbDistance(before[i]!, after[i]!) > threshold) changed += 1;
  }
  return changed;
}

/**
 * Draw one frame and sample it at every point given.
 *
 * The frame is what makes the reading a reading: the engine clears the canvas and
 * runs the build's own `render` each frame, so what is sampled is the picture the
 * build drew for the state it is in right now. The sampling itself is synchronous
 * under this engine, because the canvas is the harness's own.
 */
export async function sample(
  h: Harness,
  points: readonly { x: number; y: number }[],
): Promise<Pixel[]> {
  await h.advance(1);
  return h.pixels(points);
}

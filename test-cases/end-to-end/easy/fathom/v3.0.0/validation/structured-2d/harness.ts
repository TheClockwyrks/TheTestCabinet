// Fathom — the shared validator harness. CASE-PROVIDED.
//
// Every check in this suite is an ordinary vitest test that runs IN THE SAME
// PROCESS as the build. It imports the engine and the build's own modules,
// creates an engine over a canvas it owns and a clock it chose, and steps the
// game with `engine.advance`. Nothing drives a browser, nothing polls, and no
// wall-clock time passes: a check asks for a number of ticks and gets exactly
// that number, at exactly the deltas its clock supplied.
//
// WHAT A CHECK READS. The game's own state (through the debug surface's
// `snapshot`), the engine's object model — the open world, its game state, its
// tagged actors — the engine's frame counter, the events the engine broadcast,
// and — for the rendering checks — the pixels on the canvas or the calls the 2D
// context received. Nothing here fabricates an outcome: the scenario helpers
// below and the fixtures in `fixtures.ts` only ARRANGE the game through the debug
// surface, and the real ticks the build wrote are what run from there.
//
// WHY THE DEBUG SURFACE RATHER THAN RAW ASSIGNMENT. specs/instrumentation.md
// fixes its operations, so they mean the same thing in every build: `setMaze`
// sets the layout and nothing else, `clearPredators` empties the roster,
// `setPredatorMind(index, false)` holds one hunter exactly where it stands.
// Posing through it is how a scenario is reproducible, and it is
// the seam the case's specification documents. `surface.ts` is that specification
// as types, and it is the only description of the surface this harness reads: the
// build's own module for it is never imported.
//
// WHERE THE SURFACE COMES FROM. Off `engine.debug`, never built here. The game
// instance's `initialize` returns it, the engine holds that same object, and
// reading it back off the engine is the only way a surface reaches a check — so a
// build that returned no surface, or a surface missing an operation, fails the
// checks that reach the game through it. See `readDebugSurface`.
//
// HOW THE SURFACE IS DRIVEN. Directly. Each operation is a method that acts on
// the live game at the moment of the call, so a pose is `h.debug.setScreen(s)` and
// a reading is `h.debug.snapshot()`, with nothing in between. Fathom runs in ONE
// world for the whole session and every screen is a value of `screen`, so no pose
// rides a level transition and a reading taken straight after a pose sees it.
//
// THE CLOCK. `ConstantClock(TICK_MS)` is the default, so one advanced frame is
// exactly one `TICK_DT` tick of the fixed-step core specs/movement.md fixes, and
// every duration below is a whole number of them. That is the unit a tolerance is
// stated in. A check that is specifically about the step size
// (`controls/advances-in-real-time`) builds harnesses with clocks of its own.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { createCanvas, type Canvas, type SKRSContext2D } from "@napi-rs/canvas";
import { expect } from "vitest";
import {
  ConstantClock,
  createEngine,
  type CapturedImage,
  type Clock,
  type DrawOp,
  type DrawState,
  type DrawValue,
  type PathSegment,
  type Engine,
  type GameDefinition,
  type GameInstance,
  type GameState,
  type RecordedFrame,
  type Recording,
  type Resource,
  type SurfaceMetrics,
  type Viewport,
  type World,
} from "@clockwyrks/structured-2d";
import { BACKGROUND, game as build } from "../src/game";
import { assertTruthy, fail } from "./assert";
import { BINDINGS, LAYOUT, STAGE_H, STAGE_W, TICK_HZ } from "./constants";
import type { FixtureHost } from "./fixtures";
import { tileCenter, type Dir, type GridFrame, type Tile } from "./maze";
import type { SceneHost } from "./scene";
import type {
  FathomDebugApi,
  FathomSnapshot,
  MenuRect,
  PredatorSnapshot,
} from "./surface";

export type { Dir, Tile, GridFrame };

/** The case's surface, exactly as `surface.ts` specifies it. */
export type FathomSurface = FathomDebugApi;

/**
 * The surface as every check drives it.
 *
 * Under this engine the raw surface IS imperative — a pose takes only its own
 * arguments and returns nothing, a reading takes nothing and returns plain data —
 * so no wrapper stands between a check and the object the build returned, and the
 * driver type is the surface type itself. The alias is kept so a check reads the
 * same way it does under an engine whose surface needs driving.
 */
export type FathomDriver = FathomSurface;

/**
 * The build's game, typed against the surface the CASE specifies.
 *
 * The build declares its own type for the surface its instance's `initialize`
 * returns — the `D` of its `GameInstance<D>` — and that type is the build's: what
 * a check holds it to is `surface.ts`, so the definition is cast to the case's
 * `GameDefinition<FathomSurface>` here and the engine is parameterized with it. A
 * surface that departs from the specification is caught where a check reaches for
 * the missing member, not by the build's own compiler.
 */
const game = build as unknown as GameDefinition<FathomSurface>;

/* -------------------------------------------------------------------------- */
/* The tick                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * One frame of the default clock, in milliseconds.
 *
 * `TICK_HZ` is the case's own, from `./constants` and never off the build:
 * unlike a case that leaves its timestep to the frame, specs/movement.md fixes
 * Fathom's core at `120` steps a second and integrates every rate in whole ticks
 * of it. Running the clock at exactly that rate makes one advanced frame one
 * simulation tick, so a duration is a whole number of frames and a tolerance
 * stated in ticks means the same thing on every machine.
 */
export const TICK_MS = 1000 / TICK_HZ;

export { TICK_HZ };

/** Seconds of simulated time in `ticks` ticks of the default clock. */
export function seconds(ticks: number): number {
  return ticks / TICK_HZ;
}

/**
 * The exact number of ticks in `seconds` of game time, for turning one of the
 * seconds-valued figures the specs fix into something `advance` can take:
 * `ticksFor(SONAR_COOLDOWN)` is `180`, `ticksFor(INK_COOLDOWN)` is `960`.
 *
 * It THROWS rather than rounding when the duration is not a whole number of
 * ticks. A rounded step silently moves the simulation a different distance than
 * the caller asked for, so a duration that does not land on a tick boundary is a
 * decision for the check to make deliberately: pick the whole tick count that
 * preserves what the check is probing and pass it directly, saying why.
 */
export function ticksFor(duration: number): number {
  const ticks = duration * TICK_HZ;
  if (!Number.isInteger(ticks) || ticks < 0) {
    throw new Error(
      `ticksFor(${duration}): ${duration}s is ${ticks} ticks, not a whole ` +
        `non-negative number of simulation ticks — choose the tick count ` +
        `deliberately and pass it directly`,
    );
  }
  return ticks;
}

/* -------------------------------------------------------------------------- */
/* The keyboard                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The first key each movement action is bound to, from the case's own
 * `BINDINGS` in `./constants`.
 *
 * A check about ONE binding names that binding itself (`"KeyW"`,
 * `"ArrowLeft"`); this is for the scenarios that need the forager traveling in a
 * direction and do not care which of the two keys does it.
 */
export const DIR_KEY: Readonly<Record<Dir, string>> = {
  up: BINDINGS.up[0],
  down: BINDINGS.down[0],
  left: BINDINGS.left[0],
  right: BINDINGS.right[0],
};

/* -------------------------------------------------------------------------- */
/* What a check reads off the canvas                                          */
/* -------------------------------------------------------------------------- */

/**
 * Where a `fillText`/`strokeText` call put its text, read off the real context at
 * the moment of the call: the current transform, so the anchor can be mapped to
 * logical units whatever transform the pipeline applied, the measured width under
 * the current font, and the alignment that places the run about its anchor.
 */
export interface TextGeometry {
  transform: {
    a: number;
    b: number;
    c: number;
    d: number;
    e: number;
    f: number;
  };
  width: number;
  textAlign: string;
}

/** One recorded operation on the 2D context, in the order the render made it. */
export type DrawCall =
  | { kind: "call"; method: string; args: unknown[]; text?: TextGeometry }
  | { kind: "set"; property: string; value: unknown };

/** One cue the build played, as the engine announced it. */
export interface PlayedCue {
  cue: string;
  t: number;
  gain: number;
}

/** One asset the build asked for and did not get. */
export interface AssetFailure {
  path: string;
  reason: string;
}

/** A color read off the canvas, as a check compares them. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface HarnessOptions {
  /** The clock each frame takes its delta from. Defaults to one tick a frame. */
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
  /** Ticks advanced before the sample that ended the sweep. */
  frames: number;
  snapshot: FathomSnapshot;
}

export interface Harness extends FixtureHost, SceneHost {
  readonly engine: Engine<FathomSurface>;
  /**
   * The world currently open, read fresh on every access. Fathom opens one world
   * for the whole session, so this is the same world throughout a check; it is a
   * getter so a build that does open another is still read correctly.
   */
  readonly world: World;
  /**
   * The open world's game state, read fresh on every access. Its arrangement is
   * the build's (specs/state.md), which is why every figure a check reads comes
   * through `snapshot()` instead.
   */
  readonly state: GameState;
  /** The game instance, the one framework object that outlives every level. */
  readonly instance: GameInstance<FathomSurface>;
  /**
   * The debug surface the BUILD's instance returned from `initialize`, read off
   * `engine.debug` — see {@link readDebugSurface} — and driven directly: each
   * operation acts on the live game at the moment of the call.
   */
  readonly debug: FathomDriver;
  /** The real 2D context, for `getImageData`. Draw calls also reach it. */
  readonly ctx: SKRSContext2D;
  /**
   * The surface the engine drew into, holding the last frame that ran.
   *
   * Exposed for {@link captureStill}, which encodes it: a still output is the
   * picture the build actually put on the canvas, and the only place that picture
   * exists is here.
   */
  readonly canvas: Canvas;
  /** Every call and property set the render made, oldest first. */
  readonly calls: DrawCall[];
  /** Every cue the build played, oldest first. */
  readonly cues: PlayedCue[];
  /** Every asset the build failed to load, oldest first. */
  readonly assetFailures: AssetFailure[];
  /** The event target a dispatched key reaches, which is the player's own. */
  readonly events: EventTarget;

  /** A fresh read of the game's state through the case's `snapshot`. */
  snapshot(): FathomSnapshot;
  /** Run `frames` ticks back to back. */
  advance(frames: number): Promise<void>;
  /**
   * Run `ticks` that cost a captured section nothing, for setup rather than for
   * measurement.
   *
   * This harness's recorder is the draw-call log a `captureReplay` opens and
   * closes around a scenario, so ticks outside one are already free and this is
   * an ordinary {@link Harness.advance}. The engineless harness records per tick
   * and has a march of its own, which is why the operation exists at all.
   */
  skip(ticks: number): Promise<void>;
  /** Advance until `predicate` holds, sampling every `poll` ticks. */
  until(
    predicate: (snapshot: FathomSnapshot) => boolean,
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
   * The engine closes the input frame after the frame renders and an edge is
   * consumed once, so a tap between frames arms the edge for exactly the next
   * frame — which this runs.
   */
  tap(code: string): Promise<void>;

  /**
   * Move the pointer to a logical stage point, and run the frame that reads it.
   *
   * `device` is what separates a finger from a mouse: specs/ui.md gives a touch
   * contact a rule of its own — a landing selects, because a finger does not
   * hover — so a check about touch drives `"touch"` and the engine reports the
   * contact to the game as one.
   */
  movePointer(x: number, y: number, device?: PointerDeviceName): Promise<void>;
  /** Press the pointer at a logical stage point, and run the frame that reads it. */
  pressPointer(x: number, y: number, device?: PointerDeviceName): Promise<void>;
  /** Release the pointer at a logical stage point, and run the frame that reads it. */
  releasePointer(
    x: number,
    y: number,
    device?: PointerDeviceName,
  ): Promise<void>;

  /** Where a logical point lands in the canvas's backing store. */
  device(x: number, y: number): { x: number; y: number };
  /** The device pixel under a logical point, as `[r, g, b, a]`. */
  pixel(x: number, y: number): [number, number, number, number];

  /** Close the world, halt the loop, and drop the engine's listeners. */
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

/** The devices a menu gesture is driven by (specs/ui.md). */
export type PointerDeviceName = "mouse" | "touch";

/** The bit `PointerEvent.buttons` gives the primary button. */
const PRIMARY_BUTTON_BIT = 1;

/** The index `PointerEvent.button` gives the primary button. */
const PRIMARY_BUTTON = 0;

/** What `PointerEvent.button` carries on an event about position alone. */
const NO_BUTTON = -1;

/** The pointer id each device drives under: one mouse, one finger. */
const POINTER_ID: Readonly<Record<PointerDeviceName, number>> = {
  mouse: 1,
  touch: 2,
};

/** Exactly the fields the engine's pointer listeners read off an event. */
interface PointerEventFields {
  clientX: number;
  clientY: number;
  pointerId: number;
  pointerType: PointerDeviceName;
  isPrimary: boolean;
  /** The button the event is ABOUT, as `PointerEvent.button` numbers them. */
  button: number;
  /** Every button held once the event has been applied, as a bit mask. */
  buttons: number;
}

/**
 * A `PointerEvent`-shaped event, carrying the seven fields the engine reads and
 * nothing else.
 *
 * A shim rather than a real `PointerEvent`, for the same reason {@link KeyEvent}
 * is one: this suite runs over a canvas with no document behind it, so there is
 * no `PointerEvent` constructor to call and no element to dispatch from. The
 * engine narrows structurally — it reads `clientX`, `clientY`, `pointerId`,
 * `pointerType`, `isPrimary`, `button` and `buttons` off whatever arrives — so an
 * event carrying those drives the pointer exactly as a player's does.
 */
class PointerEventShim extends Event {
  readonly clientX: number;
  readonly clientY: number;
  readonly pointerId: number;
  readonly pointerType: PointerDeviceName;
  readonly isPrimary: boolean;
  readonly button: number;
  readonly buttons: number;

  constructor(
    type: "pointermove" | "pointerdown" | "pointerup",
    fields: PointerEventFields,
  ) {
    super(type);
    this.clientX = fields.clientX;
    this.clientY = fields.clientY;
    this.pointerId = fields.pointerId;
    this.pointerType = fields.pointerType;
    this.isPrimary = fields.isPrimary;
    this.button = fields.button;
    this.buttons = fields.buttons;
  }
}

/**
 * Where a logical stage point lands in the CSS pixels a pointer event reports.
 *
 * The inverse of the engine's own placement: it takes `clientX`/`clientY`
 * through the device pixel ratio and the letterboxed fit to reach a logical
 * point, so a check aiming a gesture at a logical point goes the other way.
 */
function toClient(
  view: Viewport,
  dpr: number,
  x: number,
  y: number,
): { x: number; y: number } {
  return {
    x: (view.offsetX + x * view.scale) / dpr,
    y: (view.offsetY + y * view.scale) / dpr,
  };
}

/**
 * A logical point's device pixel, through the world's camera and the engine's
 * fit. The camera opens at the defaults — world and logical coordinates coincide,
 * which is the space every figure in `./constants` is stated in — so the
 * projection is the identity unless the build moved it, and mapping through it
 * keeps the reading honest either way.
 */
function toDevice(
  world: World,
  view: Viewport,
  x: number,
  y: number,
): { x: number; y: number } {
  const logical = world.camera.worldToLogical({ x, y });
  return {
    x: Math.round(view.offsetX + logical.x * view.scale),
    y: Math.round(view.offsetY + logical.y * view.scale),
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
        const method = String(property);
        const call: DrawCall = { kind: "call", method, args };
        if (
          (method === "fillText" || method === "strokeText") &&
          typeof args[0] === "string"
        ) {
          const m = object.getTransform();
          call.text = {
            transform: { a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f },
            width: object.measureText(args[0]).width,
            textAlign: object.textAlign,
          };
        }
        calls.push(call);
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

/**
 * The debug surface the BUILD's instance returned from `initialize`, read off the
 * engine that holds it.
 *
 * This is deliberately a READ and never a construction. The surface is the
 * build's deliverable: its instance's `initialize` returns it
 * (specs/instrumentation.md), the engine keeps that same object, and
 * `engine.debug` is the only way it reaches a check. Nothing here could stand in
 * for it, because the build's own module for the surface is never imported.
 *
 * By the time this runs `engine.initialize()` has resolved, which is the one
 * precondition `engine.debug` has: it holds whatever the instance returned. A
 * build whose `initialize` returned `undefined` never gets this far, because the
 * engine rejects `initialize` itself, naming the missing surface, and the
 * rejection fails the suite's `beforeEach` with the engine's own message. Such a
 * build does not run on the engine under any entry point, so it is not this
 * harness's fault to report — which is why every suite's `afterEach` disposes its
 * harness with `?.`: the hook then has nothing to add to that message.
 *
 * What IS decided here is a return that is no surface — a build whose
 * `initialize` returned `null`, or something other than an object. That is a
 * fault in the build and not in this harness, so it must not present as one:
 *
 * - It is NOT thrown from here. Every suite builds its harness in a `beforeEach`,
 *   so a throw at this point would fail the hook and bury the real verdict under
 *   the harness's own stack in the case's own file.
 * - It is NOT swallowed either. {@link missingSurface} stands in for the missing
 *   surface and fails, by assertion, at the moment a check first reaches for an
 *   operation on it — naming the return the build owes.
 *
 * So the harness is built, teardown runs, and the fault lands exactly where
 * specs/instrumentation.md says it should: on the points whose checks reach the
 * game through the surface. A check that needs no surface is decided on its own
 * merits, and `instrumentation/surface-present` names the missing surface
 * outright.
 */
function readDebugSurface(engine: Engine<FathomSurface>): FathomSurface {
  const surface: unknown = engine.debug;
  if (typeof surface !== "object" || surface === null) {
    return missingSurface(
      `engine.debug holds ${surface === null ? "null" : typeof surface}, not an object`,
    );
  }
  return surface as FathomSurface;
}

/**
 * A stand-in for the surface a build never returned: every operation on it fails
 * the check that reached for it, with the missing return named.
 *
 * A proxy rather than a hand-written stub, because a stub written against the
 * common surface would report a member a check reaches for as merely absent
 * rather than as the consequence of the build's missing surface.
 *
 * Keys that belong to the MACHINERY rather than to a check are answered with
 * `undefined` instead: awaiting the harness probes `then`, and vitest's own error
 * formatting probes symbols and `constructor`. Failing those would replace the
 * verdict below with noise from the machinery that was trying to report it.
 */
function missingSurface(reason: string): FathomSurface {
  return new Proxy({} as FathomSurface, {
    get: (_target, property): unknown => {
      if (typeof property === "symbol") return undefined;
      if (property === "then" || property === "constructor") return undefined;
      return fail(SURFACE_REQUIREMENT, reason);
    },
  });
}

/**
 * What the build owes when its surface is missing: the `Expected:` line of the
 * failure every check that reaches for the surface lands on, beside what
 * `engine.debug` was found holding instead.
 */
const SURFACE_REQUIREMENT =
  "the debug surface src/game.ts's instance returns from initialize, which the " +
  "engine hands back from engine.debug (specs/instrumentation.md)";

/**
 * Build an engine over a canvas of the harness's own, initialize the build's
 * game, and hand back everything a check reads.
 *
 * The options passed to the factory are the ones the seeded `src/main.ts` passes
 * — the logical design size, the build's exported `BACKGROUND`, and the touch
 * layout — so one harness serves every build of this case. Everything else the
 * build decided lives inside `src/game.ts`.
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

  const keys = new EventTarget();
  const surface: SurfaceMetrics = {
    cssWidth: () => cssWidth,
    cssHeight: () => cssHeight,
    dpr: () => dpr,
    events: () => keys,
  };

  const engine = createEngine<FathomSurface>({
    canvas: element,
    width: STAGE_W,
    height: STAGE_H,
    game,
    // The build's own stage background, handed to the engine exactly as the
    // seeded `src/main.ts` hands it (specs/overview.md).
    background: BACKGROUND,
    layout: LAYOUT,
    clock: options.clock ?? new ConstantClock(TICK_MS),
    surface,
  });

  // Subscribed BEFORE `initialize`, which is what makes the game's own loading
  // observable: construction runs no game code, so nothing has happened yet.
  const assetFailures: AssetFailure[] = [];
  const cues: PlayedCue[] = [];
  engine.events.on("asset:failed", ({ path, reason }) => {
    assetFailures.push({ path, reason });
  });
  engine.events.on("cue:played", ({ cue, t, gain }) => {
    cues.push({ cue, t, gain });
  });

  const instance = await engine.initialize();
  const debug = readDebugSurface(engine);

  const dispatch = (type: "keydown" | "keyup", code: string): void => {
    keys.dispatchEvent(new KeyEvent(type, code));
  };

  /**
   * The buttons the driven pointer holds, kept as a browser keeps them: a press
   * adds one, a release drops one, and every event reports the set as it stands
   * once the event has been applied. Without it a move issued in the middle of a
   * drag would report no button held and the engine would read the contact as
   * lifted.
   */
  const heldButtons = new Set<PointerDeviceName>();

  const dispatchPointer = (
    type: "pointermove" | "pointerdown" | "pointerup",
    x: number,
    y: number,
    button: number,
    device: PointerDeviceName,
  ): void => {
    const at = toClient(engine.viewport(), dpr, x, y);
    keys.dispatchEvent(
      new PointerEventShim(type, {
        clientX: at.x,
        clientY: at.y,
        pointerId: POINTER_ID[device],
        pointerType: device,
        isPrimary: true,
        button,
        buttons: heldButtons.has(device) ? PRIMARY_BUTTON_BIT : 0,
      }),
    );
  };
  const harness: Harness = {
    engine,
    get world() {
      return engine.world;
    },
    get state() {
      return engine.world.state;
    },
    instance,
    debug,
    ctx,
    canvas,
    calls,
    cues,
    assetFailures,
    events: keys,

    snapshot: () => debug.snapshot(),

    skip: (ticks) => harness.advance(ticks),

    advance: (frames) => engine.advance(frames),

    async until(predicate, untilOptions = {}) {
      const maxFrames = untilOptions.maxFrames ?? 600;
      const poll = Math.max(1, untilOptions.poll ?? 1);

      let snapshot = debug.snapshot();
      if (predicate(snapshot)) return { hit: true, frames: 0, snapshot };

      let frames = 0;
      while (frames < maxFrames) {
        const step = Math.min(poll, maxFrames - frames);
        await engine.advance(step);
        frames += step;
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

    hold: (code) => dispatch("keydown", code),
    release: (code) => dispatch("keyup", code),
    async tap(code) {
      dispatch("keydown", code);
      dispatch("keyup", code);
      await engine.advance(1);
    },

    async movePointer(x, y, device = "mouse") {
      dispatchPointer("pointermove", x, y, NO_BUTTON, device);
      await engine.advance(1);
    },
    async pressPointer(x, y, device = "mouse") {
      heldButtons.add(device);
      dispatchPointer("pointerdown", x, y, PRIMARY_BUTTON, device);
      await engine.advance(1);
    },
    async releasePointer(x, y, device = "mouse") {
      heldButtons.delete(device);
      dispatchPointer("pointerup", x, y, PRIMARY_BUTTON, device);
      await engine.advance(1);
    },
    device: (x, y) => toDevice(engine.world, engine.viewport(), x, y),
    pixel: (x, y) => {
      const point = toDevice(engine.world, engine.viewport(), x, y);
      const { data } = ctx.getImageData(point.x, point.y, 1, 1);
      return [data[0], data[1], data[2], data[3]];
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
// check produces one, over the engine's own draw-command recorder.
//
// Four properties are what make it usable, and each is deliberate:
//
// 1. IT RECORDS THE SECTION, NOT THE RUN. The recorder is armed around the
//    caller's scenario and disarmed the moment that scenario returns, so what is
//    kept is the part the check is ABOUT and never the setup that got there. A
//    check that poses a corridor and then swims the forager down it records the
//    swim; the pose costs nothing, and the reviewer is not asked to scrub past a
//    minute of arrangement to reach the two seconds that decide the point.
// 2. IT IS EVIDENCE, NEVER A VERDICT. The scenario's own value comes straight
//    back, so a check reads it exactly as it did before capture existed, and a
//    scenario that THROWS still writes what it had recorded before the failure
//    travels on — a failing check is the one whose replay a reviewer most wants.
//    Nothing here can turn a passing check into a failing one: a recording that
//    cannot be written is reported as an output that never turned up, which is a
//    fact about the host rather than about the build.
// 3. IT WRITES ONLY WHAT THERE IS TO LOOK AT. A capture that closed no frames
//    leaves no file, so the run reports the output absent instead of offering the
//    reviewer a replay of nothing.
// 4. IT COSTS NOTHING WHEN NOBODY IS COLLECTING. Outside a run — a developer
//    running this suite from a shell — the media directory is unset, and the whole
//    thing is a no-op that still runs the scenario. The suite behaves identically
//    either way, so a check cannot pass in one place and fail in the other.

/**
 * The environment variable the runner names the media directory in.
 *
 * Unset is not an error: it is the normal state of a suite nobody is collecting
 * media from.
 */
const MEDIA_DIR_ENV = "TCAB_VALIDATION_MEDIA_DIR";

/**
 * The directory this harness sits in, which is the validator project's root.
 *
 * Taken from this module's own URL rather than from the working directory,
 * because it has to name the same directory in both layouts this file lives in:
 * the case's own `validation/<engine>/`, and the `validation/` the runner stages
 * that directory to inside the build's tree.
 */
const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * The directory the runner stages this project to inside the build's tree.
 *
 * A recording is addressed by the STAGED path of the suite that produced it —
 * `validation/controls/move-right.test.ts` — because that is the path the review
 * item's declared script resolves to, and so the only name the case's manifest and
 * the runner both already agree on. Stating the prefix here is what keeps that
 * address the same when this suite is run in place against a reference
 * implementation, where the project root is `validation/<engine>/` instead.
 */
const STAGED_PROJECT_DIR = "validation";

/**
 * The most frames a written recording holds.
 *
 * A recording is one JSON operation log per frame, and a frame of this game — a
 * tile grid, a fog overlay, a light pocket — is many hundreds of operations, so a
 * section a check drives for half a minute of game time runs to tens of
 * megabytes: a file nobody can serve to a reviewer and nobody wants in a run's
 * artifacts. The cap is what makes `captureReplay` safe to wrap ANY section in: an
 * author arms the recorder around what the check is about and never has to reason
 * about how long that turns out to be.
 *
 * The cap is generous enough that the great majority of this suite's sections — a
 * swim down a corridor, a hunter closing, a bloom — are written whole.
 */
const MAX_REPLAY_FRAMES = 300;

/**
 * Where the running suite's `outputId` output belongs, or `null` when nothing is
 * collecting media.
 *
 * The suite is the one vitest is currently running rather than one the caller
 * names, because the two must not be able to disagree: a check that named its own
 * path would be free to write its evidence under some other point's address.
 *
 * `extension` is the one the runner collects that OUTPUT KIND under — `json.gz`
 * for a recording (a JSON document stored gzipped: `.json` is what the bytes are
 * and `.gz` is how they are framed), `png` for a still. The suite and the runner
 * agree by both stating the same thing about what the kind is.
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
 *
 * Two entries that mean the same thing have to serialize identically for a table
 * to hold one copy of each, and the key order inside an argument the build passed
 * is the build's own business rather than ours.
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
 * DROPPING A FRAME DROPS THE LAST REFERENCE TO WHATEVER ONLY THAT FRAME DREW
 * WITH. The four tables in front of a recording are shared by every frame in it,
 * so carrying them over whole would put operations, states, gradients and images
 * in the file that no surviving frame asks for — dead weight in a document whose
 * whole point is to say each thing once, and the bulk of it in a game that draws
 * a fog of war procedurally and so repeats almost nothing between frames.
 *
 * Every entry here is reached from a kept frame, and every reference inside one is
 * rewritten as it is reached, transitively: a frame names its own state and the
 * states saved under it, whose clip and path segments and inherited fill name
 * operations and resources, whose own creating calls may name images. What is
 * deduplicated is the rewritten entry, so an operation two hundred frames issue
 * identically is written once and named two hundred times, and every index a frame
 * carries addresses the table it was interned into.
 *
 * Exported for the suite beside this file: a recording carrying an own field named
 * `__proto__` is one the engine's recorder writes and this one has to rewrite as a
 * field rather than as a prototype, and no drawing the reference implementation
 * makes produces one.
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
 * first — or last — few seconds at the full one. That is the reading that matches
 * what these outputs are named for. A dive is evidence that the light opened up as
 * the forager grazed, and the eats are spread across the whole of it.
 *
 * Thinning is legitimate because every frame in a recording is drawable on its
 * own: a frame names the whole of the state it opened with and reaches everything
 * it draws with through tables the recording shares, so dropping the frames between
 * two kept ones cannot leave a frame undrawable. Each kept frame's `deltaMs` is
 * restated as the time since the frame kept before it, so the deltas still sum to
 * the section's elapsed time and a player pacing itself off them runs at the speed
 * the game really ran at. The frame `count` is left as the host reported it, so a
 * reader can see that frames were skipped rather than being told a smooth lie.
 *
 * The last frame is always kept, whatever the stride lands on: it is the frame the
 * check's sweep stopped at — the eat, the contact, the bloom — and it is the one a
 * reviewer looks at first.
 *
 * Keeping it costs a frame rather than the cap. The stride rounds up, so a section
 * whose length is an exact multiple of the cap strides over exactly that many
 * frames and stops one stride short of the end: the last frame still has to come
 * in, and the cap is a ceiling rather than a target. It takes the place of the
 * final strided frame — the frame nearest it, so the swap opens the smallest gap
 * available anywhere in the section — and is measured from where that frame was
 * measured from, which is what keeps the kept deltas summing to the elapsed time.
 *
 * What survives is then re-expressed against tables of its own, because those
 * tables are shared by every frame the recorder kept and a dropped frame takes the
 * last reference to whatever only it drew with.
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
      // Drop the frame it stopped on, and put the moment back to the one before
      // it: a kept frame's restated delta is measured from exactly that moment, so
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
 * draw, and a file holding an empty frame list would be collected as an output
 * that turned up — the run would tell the reviewer there is a replay to watch and
 * the player would open on nothing. A declared output that never turned up is
 * already reported as absent, and that is the truthful reading of a section that
 * drew no frames.
 *
 * What lands on disk is gzip rather than raw JSON. A recording is text made almost
 * entirely of numbers, index lists and field names repeated once per frame, which
 * is close to the shape gzip is best at. That is what keeps a run's whole set of
 * recordings to a few megabytes. Every host that serves one declares the encoding,
 * so the browser inflates it before the player sees it, and the document inside is
 * the same one.
 *
 * Never throws. A directory that cannot be made or a file that cannot be written
 * says something about the machine the validators ran on, and failing the point
 * over it would blame the build for the host's problem. The runner already reads a
 * declared output that never turned up as exactly that.
 */
function writeReplay(destination: string, recording: Recording): void {
  if (recording.frames.length === 0) return;
  try {
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, gzipSync(JSON.stringify(thinReplay(recording))));
  } catch (error) {
    console.warn(`fathom: could not write ${destination}: ${String(error)}`);
  }
}

/**
 * Record the frames `scenario` draws and keep them as the review item's
 * `outputId` output, handing back whatever the scenario returned.
 *
 * Wrap the drive, not the arrangement:
 *
 * ```ts
 * const swim = await captureReplay(h, "move", () => holdFor(h, "ArrowRight", 60));
 * assertTrue(swim.after.x > swim.before.x);
 * ```
 *
 * The assertions stay exactly where they were and read exactly what they did.
 * Capture sits BESIDE them rather than in place of them: a check still fails for
 * the reasons it failed before, and the recording is what a reviewer looks at
 * afterwards to see what the build actually drew while it did.
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
 * The companion to {@link captureReplay}, for a point whose evidence is one
 * PICTURE rather than a stretch of motion: what the unrevealed fog looks like,
 * which screen the game opened on, where the den sits. A recording of a still
 * screen would be the same frame three hundred times over, and a reviewer looking
 * at the fog wants to look at the fog.
 *
 * What is written is whatever the last frame that RAN left behind, so call it
 * after the frame that poses the thing under test — an `advance(1)` following the
 * arrangement — and before the assertions, so a check that fails still leaves the
 * picture that shows why. Nothing here can change a verdict: outside a run the
 * media directory is unset and this is a no-op, and a still that cannot be written
 * is reported as an output that never turned up, which is a fact about the host
 * rather than about the build.
 */
export function captureStill(h: Harness, outputId: string): void {
  const destination = mediaDestination(outputId, "png");
  if (destination === null) return;
  try {
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, h.canvas.toBuffer("image/png"));
  } catch (error) {
    console.warn(`fathom: could not write ${destination}: ${String(error)}`);
  }
}

/* -------------------------------------------------------------------------- */
/* Scenario helpers                                                           */
/* -------------------------------------------------------------------------- */
//
// These pose a situation through the debug surface and then let the real
// simulation run. The GEOMETRY a scenario stands on comes from `fixtures.ts`, and
// its integrity from `scene.ts`; what is here is what needs the engine itself.
// Every threshold a check asserts is stated in the check, derived from the figure
// or rule the specs give for it.

/**
 * Open a dive and reach live play, through the surface alone.
 *
 * `reset` seeds the generator and returns the game to the title on a freshly laid
 * out maze, and `setScreen("playing")` opens live play — which is where "the
 * staggered release schedule specs/predators.md fixes takes its origin"
 * (specs/instrumentation.md). No menu key is pressed on the way and no countdown
 * is waited out: a build with a broken title menu and working play must fail the
 * menu points and pass the play ones.
 *
 * The two calls are the whole of it, because each poses ONE thing: a scenario
 * that wants a score, a life count or a depth of its own poses that itself.
 *
 * Nothing is advanced here, so the caller's first tick is the game's first tick of
 * live play — which is what lets a scenario pose its board before anything moves.
 */
export function startPlaying(h: Harness, seed?: number): FathomSnapshot {
  h.debug.reset(seed);
  h.debug.setScreen("playing");
  return h.snapshot();
}

/* -------------------------------------------------------------------------- */
/* Menus, driven by a real pointer and a real finger                          */
/* -------------------------------------------------------------------------- */
//
// The menus take a pointer and a touch contact as well as the keyboard
// (specs/ui.md), and WHERE a build lays the items out is the build's own — so a
// check asks the build where it put an item, through `menuItemRect`
// (specs/instrumentation.md), and drives a real pointer event at that region.
// Nothing here poses a pointer through the surface: a pose would tell the build
// where the pointer is without making the engine's own input layer deliver a
// press, a travel and a release the way a hand does, and what those checks are
// about is precisely that the game reads them.
//
// Each part of a gesture runs exactly ONE frame, so a caller counting frames can
// add them up.

/** Return the game to its title screen: `reset`, and nothing else. */
export function openTitle(h: Harness, seed?: number): void {
  h.debug.reset(seed);
}

/**
 * Where the build put item `index` of the menu the current screen shows.
 *
 * Fails by assertion when the build reports no region for an item its own menu
 * shows, so the point names that fault rather than dividing by a `null` several
 * lines later. A check that is ABOUT the reading returning `null` — on the four
 * screens that show no menu, or past the end of a menu — calls
 * `h.debug.menuItemRect` directly.
 */
export function menuRect(h: Harness, index: number): MenuRect {
  const rect = h.debug.menuItemRect(index);
  assertTruthy(
    rect,
    `menuItemRect(${index}) to report the hit region of item ${index} on the ` +
      "menu the current screen shows (specs/instrumentation.md)",
  );
  return rect as MenuRect;
}

/** The middle of a hit region: where a gesture aimed at that item lands. */
export function rectCenter(rect: MenuRect): { x: number; y: number } {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/** Move the pointer onto item `index`, and run the frame that reads it. */
export async function pointerOntoItem(
  h: Harness,
  index: number,
): Promise<void> {
  const at = rectCenter(menuRect(h, index));
  await h.movePointer(at.x, at.y);
}

/** Press and release the pointer inside item `index`'s region: two frames. */
export async function clickItem(h: Harness, index: number): Promise<void> {
  const at = rectCenter(menuRect(h, index));
  await h.pressPointer(at.x, at.y);
  await h.releasePointer(at.x, at.y);
}

/**
 * Press on one item, travel to another, and release there: three frames.
 *
 * The two edges fall in different regions, so this confirms nothing — the
 * affordance that lets a player slide off a control to cancel, which
 * specs/ui.md states and a check reads back as a screen that did not change.
 */
export async function dragBetweenItems(
  h: Harness,
  from: number,
  to: number,
): Promise<void> {
  const start = rectCenter(menuRect(h, from));
  const end = rectCenter(menuRect(h, to));
  await h.pressPointer(start.x, start.y);
  await h.movePointer(end.x, end.y);
  await h.releasePointer(end.x, end.y);
}

/**
 * Land a touch contact inside item `index`'s region and LEAVE IT DOWN.
 *
 * A confirm takes both of its edges inside one region and the lift is the second
 * of them (specs/ui.md), so a gesture that stops at the landing is the one
 * gesture that isolates what the landing alone did.
 */
export async function touchOntoItem(h: Harness, index: number): Promise<void> {
  const at = rectCenter(menuRect(h, index));
  await h.pressPointer(at.x, at.y, "touch");
}

/**
 * Land a touch contact inside item `index`'s region and lift it there.
 *
 * The landing selects the item as well as confirming it, because a finger does
 * not hover (specs/ui.md) — which is the difference between this and
 * {@link clickItem}, and the reason both exist.
 */
export async function tapItem(h: Harness, index: number): Promise<void> {
  const at = rectCenter(menuRect(h, index));
  await h.pressPointer(at.x, at.y, "touch");
  await h.releasePointer(at.x, at.y, "touch");
}

/**
 * Press and release the pointer at one point of the stage: two frames.
 *
 * For a screen that carries no item regions. specs/ui.md gives a gesture
 * completed on `"howto"` its effect anywhere on the screen rather than over a
 * region the build laid out, so there is nothing to ask `menuItemRect` for.
 */
export async function clickScreenAt(
  h: Harness,
  at: { x: number; y: number },
): Promise<void> {
  await h.pressPointer(at.x, at.y);
  await h.releasePointer(at.x, at.y);
}

/**
 * Land and lift a touch contact at one point of the stage: two frames.
 *
 * The counterpart of {@link clickScreenAt} for a finger, and for the same reason.
 */
export async function tapScreenAt(
  h: Harness,
  at: { x: number; y: number },
): Promise<void> {
  await h.pressPointer(at.x, at.y, "touch");
  await h.releasePointer(at.x, at.y, "touch");
}

/** Land a contact on one item, travel to another, and lift there: confirms nothing. */
export async function touchBetweenItems(
  h: Harness,
  from: number,
  to: number,
): Promise<void> {
  const start = rectCenter(menuRect(h, from));
  const end = rectCenter(menuRect(h, to));
  await h.pressPointer(start.x, start.y, "touch");
  await h.movePointer(end.x, end.y, "touch");
  await h.releasePointer(end.x, end.y, "touch");
}

/** The forager, the way most checks name it. */
export function forager(snapshot: FathomSnapshot): FathomSnapshot["forager"] {
  return snapshot.forager;
}

/**
 * The predator at `index` of the roster, asserted present.
 *
 * specs/state.md lists the roster in release order and fixes one stable index per
 * predator, which is the index every predator operation selects by. A check that
 * poses predator `n` and then reads it back comes through here, so a roster too
 * short to hold it fails on the roster rather than on a `TypeError` several ticks
 * later.
 */
export function predator(
  snapshot: FathomSnapshot,
  index: number,
): PredatorSnapshot {
  const one = snapshot.predators[index];
  assertTruthy(
    one,
    `snapshot() must list the roster in release order, so index ${index} is a ` +
      `predator at this depth; see specs/state.md and specs/predators.md`,
  );
  return one as PredatorSnapshot;
}

/** The result of holding one key for a span of ticks. */
export interface HeldResult {
  before: FathomSnapshot;
  after: FathomSnapshot;
  /** The key that was held. */
  code: string;
  /** How many ticks it was held for. */
  ticks: number;
}

/**
 * Hold `code` for `ticks` ticks of the real simulation, then release it, and
 * report the state either side.
 *
 * Nothing here calls a pose, so the game stays under normal player control and the
 * forager responds to the held action exactly as it does for a player. The key is
 * released before the snapshot is taken, so a scenario that continues afterwards
 * starts from rest.
 */
export async function holdFor(
  h: Harness,
  code: string,
  ticks: number,
): Promise<HeldResult> {
  const before = h.snapshot();
  h.hold(code);
  await h.advance(ticks);
  const after = h.snapshot();
  h.release(code);
  return { before, after, code, ticks };
}

/**
 * Hold `code` until `predicate` holds or the budget runs out, then release it.
 *
 * The budget is a HARD window rather than an open-ended wait, so a build that is
 * merely too slow FAILS on the bound the check states rather than running until
 * the suite times out.
 */
export async function holdUntil(
  h: Harness,
  code: string,
  predicate: (snapshot: FathomSnapshot) => boolean,
  options: UntilOptions = {},
): Promise<UntilResult> {
  h.hold(code);
  try {
    return await h.until(predicate, options);
  } finally {
    h.release(code);
  }
}

/* ---- Reading the board ---------------------------------------------------- */

/** The logical center of tile `(tx, ty)`, from the snapshot's own grid frame. */
export function centerOf(
  snapshot: FathomSnapshot,
  tile: Tile,
): { x: number; y: number } {
  return tileCenter(snapshot.grid, tile);
}

/** The visibility character reported for tile `(tx, ty)`. */
export function visibilityAt(
  snapshot: FathomSnapshot,
  tile: Tile,
): string | undefined {
  return snapshot.visibility[tile.ty]?.[tile.tx];
}

/* ---- Reading the pixels --------------------------------------------------- */
//
// These read the pixels the build actually PAINTS, so a build cannot pass by
// reporting a color it does not draw. A sample needs a frame to have been drawn
// since the scene was posed, so every one of them follows an `advance`.

/** The color at a logical point, as the frame on the canvas holds it. */
export function colorAt(h: Harness, x: number, y: number): Rgb {
  const [r, g, b] = h.pixel(x, y);
  return { r, g, b };
}

/** The color at the center of a tile. */
export function colorAtTile(
  h: Harness,
  snapshot: FathomSnapshot,
  tile: Tile,
): Rgb {
  const at = centerOf(snapshot, tile);
  return colorAt(h, at.x, at.y);
}

/**
 * The mean color at the center of a tile, over the cluster {@link sampleColor}
 * reads.
 *
 * The cluster is what keeps a single anti-aliased pixel from deciding a verdict,
 * and it stays well inside the tile.
 */
export function sampleColorAtTile(
  h: Harness,
  snapshot: FathomSnapshot,
  tile: Tile,
): Rgb {
  const at = centerOf(snapshot, tile);
  return sampleColor(h, at.x, at.y);
}

/** The mean color over a five-point cluster about a logical point. */
export function sampleColor(h: Harness, x: number, y: number): Rgb {
  const offsets: readonly [number, number][] = [
    [0, 0],
    [3, 0],
    [-3, 0],
    [0, 3],
    [0, -3],
  ];
  let r = 0;
  let g = 0;
  let b = 0;
  for (const [dx, dy] of offsets) {
    const sample = colorAt(h, x + dx, y + dy);
    r += sample.r;
    g += sample.g;
    b += sample.b;
  }
  return {
    r: r / offsets.length,
    g: g / offsets.length,
    b: b / offsets.length,
  };
}

/**
 * How far apart two colors are, as the euclidean distance in RGB.
 *
 * The review items that bound this state their tolerance out of `441`, which is
 * the largest distance this can return.
 */
export function colorDistance(a: Rgb, b: Rgb): number {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

/** A color's mean channel, as the brightness the fog points bound. */
export function luminance(color: Rgb): number {
  return (color.r + color.g + color.b) / 3;
}

/**
 * The mean color over a ring of `radius` units about a logical point.
 *
 * An amber mote's core blows out toward white by design, so the amber hue reads in
 * the halo around it rather than at the center.
 */
export function sampleRing(
  h: Harness,
  x: number,
  y: number,
  radius: number,
): Rgb {
  if (radius === 0) return colorAt(h, x, y);
  const points = 6;
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < points; i += 1) {
    const angle = (i / points) * Math.PI * 2;
    const sample = colorAt(
      h,
      x + radius * Math.cos(angle),
      y + radius * Math.sin(angle),
    );
    r += sample.r;
    g += sample.g;
    b += sample.b;
  }
  return { r: r / points, g: g / points, b: b / points };
}

/**
 * A warm amber light: the bonus drifter's mote and the Lanternjaw's bulb.
 *
 * specs/gameplay.md fixes the mote's color and that it is drawn at all times and
 * at any distance, and specs/assets.md gives the amber palette color; neither
 * fixes the glow's size or its falloff. So this is a HUE test rather than a
 * color match: red-leaning, green above blue, clearly warm, and lit rather than
 * fog.
 */
export function isAmber(color: Rgb): boolean {
  return (
    color.r > 110 &&
    color.r >= color.g &&
    color.g > color.b &&
    color.r - color.b > 40 &&
    luminance(color) > 40
  );
}

/**
 * The radii, in units out from a mote's center, that {@link sampleMoteProfile}
 * reads it at.
 *
 * WHY A PROFILE AND NOT ONE RING. The specs fix the mote's color and, in words,
 * its shape, and nothing else: not the orb's radius, not how bright its core is,
 * not how fast the glow falls off. A build that draws the same light tighter
 * paints an unmistakable amber mote that a single five-unit ring reads as dark
 * fog, and a build that draws it wider blows that ring out to white. Both are the
 * mote the specs ask for, so "is it amber" is asked of the profile rather than of
 * one arbitrary ring. That still fails a build that draws no amber light at all,
 * because nothing in the fog reads amber at ANY radius.
 */
export const MOTE_RADII: readonly number[] = [0, 2, 4, 6, 8, 10];

/**
 * How far from the reported position a mote's drawn light may sit, in units, and
 * how finely that neighborhood is searched for it.
 *
 * WHY THE PROFILE IS RE-CENTRED BEFORE IT IS READ. A mote is drawn on a body, and
 * where on that body the light sits is the build's own art: one draws the glow on
 * the entity's center, another puts it at the top of the sprite as a bulb on a
 * bell would be. Reading the rings about the reported pixel therefore measures art
 * rather than conformance. A run drew its bulb six units up — plainly, visibly
 * amber, and amber at every radius about its own center — and was failed for a
 * ring centered six units below it that averaged out dim.
 *
 * The search stays well inside one tile: it is looking for the light on this
 * creature, not for some other light nearby.
 */
export const MOTE_SEARCH = 12;
const MOTE_SEARCH_STEP = 6;

/**
 * The brightest not-cool point within {@link MOTE_SEARCH} of `(x, y)`: the mote's
 * drawn center, wherever the build chose to put it on the body.
 *
 * Not COOLER than neutral, and as bright as possible. An amber mote's core blows
 * out to near-white by design, so requiring the core itself to read warm would
 * skip the very pixel being searched for and settle for the dim halo — or, out in
 * the fog where there is no halo, for nothing at all. The cool trench and the
 * forager's own glow are still rejected, both being blue-leaning. Where the
 * neighborhood holds nothing warm at all it answers `(x, y)`, so a build that
 * draws no mote is read exactly where it should have drawn one.
 */
export function findMoteCenter(
  h: Harness,
  x: number,
  y: number,
): { x: number; y: number } {
  let best = { x, y };
  let bestScore = -1;
  for (let dy = -MOTE_SEARCH; dy <= MOTE_SEARCH; dy += MOTE_SEARCH_STEP) {
    for (let dx = -MOTE_SEARCH; dx <= MOTE_SEARCH; dx += MOTE_SEARCH_STEP) {
      const sample = colorAt(h, x + dx, y + dy);
      if (sample.r < sample.b) continue;
      const score = luminance(sample);
      if (score > bestScore) {
        bestScore = score;
        best = { x: x + dx, y: y + dy };
      }
    }
  }
  return best;
}

/**
 * How finely {@link near} walks the neighborhood, in units.
 *
 * Finer than {@link findMoteCenter}'s own step, because these read the brightest
 * SAMPLE rather than choose a lattice point to read a profile about: a mote a few
 * units across has to be landed on, not merely bracketed.
 */
const NEAR_STEP = 3;

/** One sample of the neighborhood a creature's mote would be drawn in. */
export interface NearSample {
  color: Rgb;
  x: number;
  y: number;
}

/**
 * Every pixel within {@link MOTE_SEARCH} of `(x, y)`, on a fixed grid.
 *
 * Read one point at a time rather than averaged, because a mote is small: a
 * cluster average over the whole neighborhood would wash an unmistakable light
 * out to the fog around it.
 */
function near(h: Harness, x: number, y: number): NearSample[] {
  const samples: NearSample[] = [];
  for (let dy = -MOTE_SEARCH; dy <= MOTE_SEARCH; dy += NEAR_STEP) {
    for (let dx = -MOTE_SEARCH; dx <= MOTE_SEARCH; dx += NEAR_STEP) {
      const [r, g, b] = h.pixel(x + dx, y + dy);
      samples.push({ color: { r, g, b }, x: x + dx, y: y + dy });
    }
  }
  return samples;
}

/** The brightest pixel within {@link MOTE_SEARCH} of `(x, y)`, whatever its hue. */
export function brightestNear(h: Harness, x: number, y: number): NearSample {
  return near(h, x, y).reduce((best, sample) =>
    luminance(sample.color) > luminance(best.color) ? sample : best,
  );
}

/**
 * The brightest RED-LEANING pixel within {@link MOTE_SEARCH} of `(x, y)`, or
 * `null` where the neighborhood holds none.
 *
 * "Red-leaning" is the whole of the hue test, and it is the wording the review
 * items that read a mote this way use: "has its red channel above its blue". No
 * figure anywhere fixes how bright an amber mote is or how fast its glow falls
 * off, so a brightness threshold baked in here would fail a build that draws a
 * dimmer light and satisfies every stated requirement. HOW FAR above the fog a
 * mote must read is stated by the check, against a fog sample it took itself.
 */
export function brightestWarmNear(
  h: Harness,
  x: number,
  y: number,
): NearSample | null {
  let best: NearSample | null = null;
  for (const sample of near(h, x, y)) {
    if (sample.color.r <= sample.color.b) continue;
    if (best === null || luminance(sample.color) > luminance(best.color)) {
      best = sample;
    }
  }
  return best;
}

/** One sample of a mote's profile. */
export interface MoteSample {
  radius: number;
  color: Rgb;
}

/**
 * A mote's rendered color profile at each of {@link MOTE_RADII}, innermost first,
 * read about the mote's own drawn center.
 */
export function sampleMoteProfile(
  h: Harness,
  x: number,
  y: number,
): MoteSample[] {
  const center = findMoteCenter(h, x, y);
  return MOTE_RADII.map((radius) => ({
    radius,
    color: sampleRing(h, center.x, center.y, radius),
  }));
}

/** The innermost sample of `profile` that reads as a warm amber light, or `null`. */
export function amberInProfile(
  profile: readonly MoteSample[],
): MoteSample | null {
  return profile.find((sample) => isAmber(sample.color)) ?? null;
}

/**
 * How far apart two motes are drawn, as the LARGEST color distance between their
 * samples at the same radius.
 *
 * Comparing like radius with like keeps the reading honest: two motes drawn
 * identically match at every radius, and one drawn differently — a wider halo, a
 * colder core — separates somewhere in the profile even where it happens to agree
 * on one ring.
 */
export function profileDistance(
  a: readonly MoteSample[],
  b: readonly MoteSample[],
): number {
  let worst = 0;
  for (let i = 0; i < a.length && i < b.length; i += 1) {
    worst = Math.max(worst, colorDistance(a[i].color, b[i].color));
  }
  return worst;
}

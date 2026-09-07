// Wireworm — the case's half of the validator harness. CASE-PROVIDED.
//
// Every check in this suite is an ordinary vitest test that runs IN THE SAME
// PROCESS as the build. It imports the runtime and the build's own modules,
// creates a runtime over a canvas it owns and a clock it chose, and steps the
// game with `engine.advance`. Nothing drives a browser, nothing polls, and no
// wall-clock time passes: a check asks for a number of frames and gets exactly
// that number, at exactly the deltas its clock supplied.
//
//
// A HELPER THAT POSES ANYTHING A READING DERIVES FROM RECONCILES BEFORE IT
// RETURNS. `specs/instrumentation.md` lets a build work a derived reading out at
// the read or keep it as a stored copy, and `reconcile()` is what brings a
// stored copy back into agreement — so `startPlaying`, which poses the level the
// step interval and the worm length follow, ends with the call. A check that
// poses only through the helpers therefore never calls `reconcile` itself; a
// check that poses with `h.debug.set…` directly calls it once before its first
// read or sweep.
//
// THE MACHINERY THAT DOES THAT IS NOT WIREWORM'S. The canvas and its
// draw-command recorder, the debug surface and the stand-in for a missing one,
// the driver that threads a PURE surface through `engine.apply`, the driven
// frame and the `until` sweep, the key events, the cue stamping, the host that
// serves the seeded art to the runtime's loader, and the evidence a review
// item's output is written from — every engine-backed case needs exactly that,
// and it lives once, in `@clockwyrks/case-harness`, staged beside this file as
// `./case-harness/`. What is left HERE is what is genuinely Wireworm's: its
// snapshot and surface types, its tick vocabulary, the pointer event this game's
// menus are driven by, the seeded-sprite comparison its `specs/assets.md`
// requires, and every scenario helper that poses this board.
//
// WHAT A CHECK READS. The game's own state (through the debug surface's
// `snapshot`), the runtime's frame counter, the cues the runtime broadcast, and —
// for the rendering checks — the pixels on the canvas or the calls the 2D context
// received. Nothing here fabricates an outcome: the scenario helpers below only
// ARRANGE the world through the debug surface, and the real `update` the build
// wrote is what runs from there.
//
// WHY THE DEBUG SURFACE RATHER THAN RAW ASSIGNMENT. specs/instrumentation.md fixes
// its operations, so they mean the same thing in every build: `setNode` creates
// the node if the tile was empty, `addWorm` appends a one-segment worm heading
// right, a world gate stays off until something turns it back on, and `reset`
// gives everything back. Posing through it is how a scenario is reproducible, and
// it is the seam the case's specification documents. `surface.ts` is that
// specification as types, and it is the only description of the surface this
// harness reads: the build's own module for it is never imported.
//
// WHERE THE SURFACE COMES FROM. Off `engine.debug`, never built here. The build's
// `initialize` returns it beside the state, as `[state, debug]`, and the runtime
// holds the second element and returns it from `engine.debug`. Reading it back off
// the runtime is the only way a surface reaches a check, so a build that returned
// no surface, or a surface missing an operation, fails the checks that reach the
// game through it — at the moment a check first reaches for an operation, and
// never in the `beforeEach` that built the harness.
//
// HOW THE SURFACE IS DRIVEN. The runtime holds the state by value and hands it out
// read-only, so the surface is pure: a pose takes the current state and returns
// the next, a reading takes the current state and returns what it read
// (`surface.ts`). A check still writes `h.debug.setNode(4, 4, 3)` and
// `h.debug.menuItemRect(1)`, because `h.debug` is the package's `applyDriver` over
// the raw surface: it runs each pose through `engine.apply`, and hands each
// READING `engine.state` followed by whatever the check passed — which is what
// `menuItemRect(index)` needs, since a reading whose index was dropped would
// answer about item zero. Nothing a check does holds a writable state — `h.state`
// is the runtime's current value, read fresh on every access, and the only way to
// change it is a pose.
//
// THE HARNESS SUPPLIES THE CLOCK, NOT THE GAME. `ConstantClock(TICK_MS)` is the
// default, so one frame is one 120 Hz tick and every duration below is a whole
// number of them. That is why `[instrumentation]` carries no `tick_hz`: Wireworm
// mandates no fixed timestep, every rate is per second and integrated against the
// delta the frame hands the game, and the SUITE is what fixes a step so a
// tolerance can be stated in ticks and mean the same thing on every machine. A
// check that is specifically about the step size builds its own harness with a
// clock of its own.
//
// THE SEEDED ART IS SERVED HEADLESS. specs/assets.md has the build load every
// frame through the engine, which resolves each path under `assets/` relative to
// the page and fetches it. This project runs in a Node process with no page, so
// the package's asset host stands `fetch` and `createImageBitmap` up over the
// workspace's own `assets/` tree for the life of each harness and puts them back
// on `dispose`. That is the same kind of thing the canvas, the surface metrics and
// the clock are — the host the engine runs on — and without it every scenario
// would draw a board the build was never given the art for.

import { createCanvas, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ConstantClock,
  createEngine,
  type Clock,
  type Engine,
  type Game,
  type PointerButton,
  type PointerDevice,
  type SurfaceMetrics,
} from "@clockwyrks/simple-2d";
import type { DeepReadonly } from "ts-essentials";
import {
  applyDriver,
  boundDrawLog,
  createEngineCaseHarness,
  installAssetHost,
  type AssetFailure,
  type AssetHost,
  type EngineHarness,
  type EngineHarnessOptions,
  type EngineViewport,
  type PureDriver,
  type TimedCue,
  type UntilOptions,
  type UntilResult as BaseUntilResult,
} from "./case-harness/engine/index";
import {
  allInLogical,
  makeReplayCapture,
  sampleColor as clusterSample,
} from "./case-harness/engine/2d";
import {
  callsTo,
  setsOf,
  type DrawCall as RecordedCall,
  type TextGeometry,
} from "./case-harness/draw-calls";
import {
  drawnText,
  drawnTextLines,
  drawnTextRuns,
  textDraws,
  type TextDraw,
} from "./case-harness/text";
import { colorDistance, type Rgb } from "./case-harness/color";
import {
  BOARD_Y,
  CORRUPTOR_FRAMES,
  CURSOR_FRAMES,
  CURSOR_X_MAX,
  CURSOR_X_MIN,
  CURSOR_Y_MAX,
  CURSOR_Y_MIN,
  DROPPER_FRAMES,
  GLITCH_FRAMES,
  LAYOUT,
  NODE_FRAMES,
  STAGE_H,
  STAGE_W,
  TILE,
  WORM_FRAMES,
  tileCX,
  tileCY,
} from "./constants";
import { BACKGROUND, game as build, type WirewormState } from "../src/game";
import { assertTruthy } from "./assert";
import {
  READINGS,
  type ArcSnapshot,
  type BoltSnapshot,
  type FoeKind,
  type FoeSnapshot,
  type NodeSnapshot,
  type Phase,
  type Screen,
  type MenuRect,
  type TileSnapshot,
  type WirewormDebugApi,
  type WirewormSnapshot,
  type WormSnapshot,
} from "./surface";

export type {
  ArcSnapshot,
  BoltSnapshot,
  FoeKind,
  FoeSnapshot,
  MenuRect,
  NodeSnapshot,
  Phase,
  Screen,
  TileSnapshot,
  WirewormSnapshot,
  WormSnapshot,
};

/* The readings the package already carries, under the names this suite says. */
export { colorDistance, drawnText };
export type { AssetFailure, Rgb, TimedCue, UntilOptions };

/** What a sweep found: whether the predicate ever held, and where it stopped. */
export type UntilResult = BaseUntilResult<WirewormSnapshot>;

/** The case's surface, bound to the state type the build declared. */
export type WirewormSurface = WirewormDebugApi<WirewormState>;

/** The runtime this project's checks run the build on. */
export type WirewormEngine = Engine<WirewormState, WirewormSurface>;

/**
 * The imperative reading of the pure surface: every member of the case's
 * surface, minus its state argument, over the runtime that holds the state.
 */
export type WirewormDriver = PureDriver<
  DeepReadonly<WirewormState>,
  WirewormState,
  WirewormSurface
>;

/**
 * The build's game, typed against the surface the CASE specifies.
 *
 * The build declares its own type for the surface its `initialize` returns, and
 * that type is the build's: what a check holds it to is `surface.ts`, so the game
 * is cast to the case's `Game<WirewormState, WirewormSurface>` here and the
 * runtime is parameterized with it. A surface that departs from the specification
 * is caught where a check reaches for the missing member, not by the build's own
 * compiler.
 */
const game = build as unknown as Game<WirewormState, WirewormSurface>;

/* -------------------------------------------------------------------------- */
/* The clock                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The frame the suite steps in, in milliseconds.
 *
 * This is the SUITE's choice, not the game's: the specification deliberately
 * fixes no timestep, because the runtime hands the game whatever elapsed time a
 * frame really took. Fixing it here makes a duration a whole number of frames, so
 * a tolerance can be stated in ticks and mean the same thing on every machine.
 *
 * 120 Hz divides every figure this case is timed against finely enough to read a
 * threshold rather than a rounding: the level-1 step interval (`0.14` s) is
 * 16.8 ticks, the fire interval (`0.15` s) is 18, an arc's life (`0.32` s) and the
 * glitch's dart interval (`0.32` s) are 38.4.
 */
export const TICK_HZ = 120;
export const TICK_MS = 1000 / TICK_HZ;

/* -------------------------------------------------------------------------- */
/* What a frame drew                                                          */
/* -------------------------------------------------------------------------- */

/**
 * A 2D affine transform, as the context held it at the moment of a call.
 *
 * WIREWORM'S OWN SHAPE, and deliberately not the package's. `./case-harness/
 * matrix`'s `Matrix` is the canvas's `[a, b, c, d, e, f]` TUPLE; this suite's
 * checks read `m.a`, `m.b`, `m.c` and `m.d` off a named record, and the two are
 * the same six numbers under two spellings. Folding them would have rewritten
 * every rendering check's arithmetic for nothing, so the case keeps its own name
 * and {@link matrixOf} is the one place the two meet.
 */
export interface Matrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

/** The context's own live transform, as this suite reads one. */
function matrixOf(m: Matrix): Matrix {
  return { a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f };
}

/**
 * One recorded operation on the 2D context, in the order the render made it.
 *
 * The package's recorded call, plus the one field this case adds to it:
 * {@link Matrix} `transform`, the transform the CONTEXT held at the moment of
 * the call. A build draws a sprite by translating to the tile's centre and
 * drawing the frame about the origin (`ctx.translate(cx, cy);
 * ctx.drawImage(f, -16, -16)`), so the destination arguments alone say nothing
 * about where the sprite landed; {@link drawnImages} is what maps one back to
 * logical units, and `presentation/cursor-from-sprite` reads the matrix itself
 * for the way up.
 */
export type DrawCall =
  | {
      kind: "call";
      method: string;
      args: unknown[];
      text?: TextGeometry;
      transform?: Matrix;
    }
  | { kind: "set"; property: string; value: unknown };

/** The methods whose transform is stamped beside the call. */
const TRANSFORMED = new Set(["drawImage", "fillText", "strokeText"]);

/**
 * Stamp the transform in force onto every {@link TRANSFORMED} call as the
 * recorder records it.
 *
 * TAKEN FROM THE CONTEXT, NEVER RECONSTRUCTED. The package's recorder keeps the
 * transform at a TEXT call (that is what `recorder: { measureText: true }` buys)
 * and leaves a `drawImage` carrying its arguments alone, on the reading that a
 * walk of the operation list recovers the transform — which it does, right up
 * until a build issues something the walk cannot see through, such as a `reset`
 * or a `canvas.width` assignment. Wireworm's rendering points turn on exactly
 * that matrix: `specs/assets.md` requires the cursor's frame drawn UPRIGHT and a
 * leftward worm drawn MIRRORED, and both readings are the matrix the draw was
 * made under. So it is read off the real context, which is what this harness has
 * always done and what a walk can only approximate.
 *
 * The recorder appends through the log's own `push` and does so BEFORE it applies
 * the call to the context, so a stamp taken here is taken at the moment of the
 * call, before anything the call itself could change. Wrapping `push` is the same
 * seam the package's own `boundDrawLog` uses, and this wraps whatever is
 * installed at the moment it runs, so the two compose in either order.
 */
function stampTransforms(calls: RecordedCall[], ctx: SKRSContext2D): void {
  const append = calls.push.bind(calls) as (...items: RecordedCall[]) => number;
  Object.defineProperty(calls, "push", {
    value: (...items: RecordedCall[]): number => {
      for (const item of items) {
        if (item.kind === "call" && TRANSFORMED.has(item.method)) {
          (item as { transform?: Matrix }).transform = matrixOf(
            ctx.getTransform(),
          );
        }
      }
      return append(...items);
    },
    writable: true,
    configurable: true,
    enumerable: false,
  });
}

/**
 * The most calls {@link Harness.calls} holds before the oldest are dropped.
 *
 * The list is what a rendering check reads, and a rendering check reads ONE
 * frame: the idiom is `h.calls.length = 0`, one `advance(1)`, then the reading —
 * which is what {@link drawFrame} does. But the list is recorded whether a check
 * reads it or not, and this case's longest sweeps run thousands of frames of a
 * board drawing hundreds of operations each, so an uncapped list would be hundreds
 * of megabytes in a check that never looks at it. Past the cap the oldest half is
 * dropped, which is far beyond any single frame and so cannot cost a reading
 * anything.
 */
const MAX_RECORDED_CALLS = 200_000;

/** Every argument list `method` was called with, and every value `property` took. */
export { callsTo, setsOf };

/* -------------------------------------------------------------------------- */
/* What the build owes                                                        */
/* -------------------------------------------------------------------------- */

/**
 * What the build owes when its surface is missing: the `Expected:` line of the
 * failure every check that reaches for the surface lands on, beside what
 * `engine.debug` was found holding instead.
 *
 * The case's own sentence rather than the package's, because how the surface
 * reaches the runtime is phrased differently by the two state models, and a fault
 * that misdescribed the return would send a reviewer to the wrong line of the
 * build.
 */
const SURFACE_REQUIREMENT =
  "the debug surface src/game.ts's initialize returns beside its state, as " +
  "[state, debug], which the engine hands back from engine.debug " +
  "(specs/instrumentation.md)";

/* -------------------------------------------------------------------------- */
/* Serving the seeded art to a headless engine                                */
/* -------------------------------------------------------------------------- */
//
// specs/assets.md has the build load every frame through the engine's loader,
// which resolves a path under the fixed `assets/` root, relative to the page, and
// fetches it. There is no page here, so the two globals the loader reaches for are
// stood up over the workspace's own `assets/` tree while a harness is alive and
// put back when it is disposed. Two harnesses may be alive at once — a check that
// compares two clocks builds a second — and the package's host counts references
// for exactly that reason: the globals go back when the last holder lets go.

/**
 * The directory this harness sits in, which is the validator project's root.
 *
 * Taken from this module's own URL rather than from the working directory,
 * because it has to name the same directory in both layouts this file lives in:
 * the case's own `validation/<engine>/`, and the `validation/` the runner stages
 * that directory to inside the build's tree. It must never come from the
 * package's own module, which is staged one directory deeper.
 */
const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * The workspace this project is staged into, which is where `assets/` sits.
 *
 * The tree the build was handed, so the seeded art a check reads is exactly the
 * art the case seeded and the engine's loader resolves `assets/node/0.png` to the
 * file the run was given.
 */
const WORKSPACE = resolve(PROJECT_ROOT, "..");

/**
 * The transport the engine's loader reaches for, over the workspace on disk.
 *
 * `roots` is the repository root and nothing else, because specs/assets.md seeds
 * every frame under `assets/` at that root and the loader asks for
 * `assets/<folder>/<n>.png`: a build has no say in where the art lives, so there
 * is no second place to look and adding one could only ever answer a staged copy
 * for the committed file.
 *
 * `onMissing: "upstream"` hands a relative URL no root carries to the platform's
 * own `fetch`, which then rejects the relative URL — a REJECTION, which is what
 * this harness has always answered a missing frame with and what the engine
 * reports on `asset:failed`. `images` shims `createImageBitmap` over the same
 * decoder; `nameImageBitmap` is off, because nothing in this process has ever
 * carried a global `ImageBitmap` and naming one would change what the engine's own
 * recorder writes into a replay.
 */
const ASSET_HOST = {
  workspaceRoot: WORKSPACE,
  roots: ["."],
  onMissing: "upstream",
  images: true,
  nameImageBitmap: false,
  label: "wireworm",
} as const;

/**
 * The asset host each harness holds, by the runtime it was installed for.
 *
 * Installed in {@link EngineCaseConfig.createEngine} rather than around
 * `createHarness`, because the build loads its art inside `initialize` and the kit
 * awaits that before a harness exists to hold anything; given up again from
 * `dispose`. A harness whose `initialize` REJECTED never reaches `dispose` and so
 * never gives its hold back, which leaves the shims standing in that worker — the
 * same state a worker that simply exits leaves them in, and harmless either way.
 */
const assetHosts = new WeakMap<object, AssetHost>();

/* -------------------------------------------------------------------------- */
/* The pointer, as the runtime is delivered one                               */
/* -------------------------------------------------------------------------- */
//
// The menus take a mouse and a finger as well as the keyboard (`specs/ui.md`),
// and the runtime reads both off the same pointer-event stream on the target the
// `surface` option supplies. This suite runs over a canvas with no document
// behind it, so there is no `PointerEvent` constructor to call and no element to
// dispatch from: the runtime narrows structurally, reading `clientX`, `clientY`,
// `pointerId`, `pointerType`, `isPrimary`, `button` and `buttons` off whatever
// arrives, so an event carrying those drives the pointer exactly as a hand does.
//
// NEITHER OF THE PACKAGE'S TWO EVENTS IS THIS ONE, and the whole pointer layer
// stays with the case because of it. `PointerPositionEvent` carries a position
// alone, so a check could not tell a finger from a mouse — and `specs/ui.md`
// gives a touch contact a rule of its own, because a finger does not hover.
// `DevicePointerEvent` names a device but fixes its own buttons: the primary
// button on every press and move and none on a release. Wireworm's menus are
// driven with a NAMED button and a held-button mask kept exactly as a browser
// keeps one, so a drag reports the button still down and a check may press a
// secondary button and read that the build ignored it. The event below is that
// third shape, and the gestures around it are this case's.

/** The three pointer events the runtime listens for. */
type PointerEventName = "pointerdown" | "pointermove" | "pointerup";

/**
 * How one dispatched pointer event is shaped, and how long the build is given to
 * see it.
 *
 * `device` is what separates a finger from a mouse: `specs/ui.md` gives a touch
 * contact a rule of its own (a landing selects, because a finger does not
 * hover), so a check about touch passes `device: "touch"` and the runtime
 * reports the contact to the build as one.
 */
export interface PointerOptions {
  /** Which device drove the event. Defaults to a mouse. */
  device?: PointerDevice;
  /** Which button the event names. Defaults to the primary one. */
  button?: PointerButton;
  /** The pointer's id, so a second contact can be driven beside the first. */
  id?: number;
  /** Whether this is the primary pointer. Defaults to true. */
  primary?: boolean;
  /**
   * Frames advanced after the event, so the frame loop delivers it. Defaults to
   * one; `0` leaves the event undelivered so a second can join it on one frame.
   */
  frames?: number;
}

/** Exactly the fields the runtime's pointer listeners read. */
interface PointerEventFields {
  clientX: number;
  clientY: number;
  pointerId: number;
  pointerType: PointerDevice;
  isPrimary: boolean;
  /** The button the event is ABOUT, as `PointerEvent.button` numbers them. */
  button: number;
  /** Every button held once the event has been applied, as a bit mask. */
  buttons: number;
}

/** A `PointerEvent`-shaped event carrying the seven fields the runtime reads. */
class PointerEventShim extends Event {
  readonly clientX: number;
  readonly clientY: number;
  readonly pointerId: number;
  readonly pointerType: PointerDevice;
  readonly isPrimary: boolean;
  readonly button: number;
  readonly buttons: number;

  constructor(type: PointerEventName, fields: PointerEventFields) {
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
 * The bit each button occupies in `PointerEvent.buttons`, and the order
 * `PointerEvent.button` indexes them in.
 *
 * The two use different numbering, which is why each is written out rather than
 * derived from the other. Both are the browser's.
 */
const BUTTON_BITS: Readonly<Record<PointerButton, number>> = {
  primary: 1,
  secondary: 2,
  auxiliary: 4,
  back: 8,
  forward: 16,
};

const BUTTON_INDEX: readonly PointerButton[] = [
  "primary",
  "auxiliary",
  "secondary",
  "back",
  "forward",
];

/** The value `PointerEvent.button` carries for a named button. */
function buttonIndexOf(button: PointerButton): number {
  return BUTTON_INDEX.indexOf(button);
}

/** The mask `PointerEvent.buttons` carries for a set of held buttons. */
function buttonMask(held: ReadonlySet<PointerButton>): number {
  let bits = 0;
  for (const button of held) bits |= BUTTON_BITS[button];
  return bits;
}

/**
 * Where a logical point lands in the client coordinates a pointer event carries.
 *
 * The runtime maps a pointer position by `((client - origin) * dpr - offset) /
 * scale`, and this harness's surface supplies no origin, so this is that map run
 * backwards. Unrounded, deliberately: a device pixel rounded on the way out
 * lands a fraction of a unit off the point that was asked for, and a menu item's
 * edge is exactly where that fraction decides the reading.
 */
function toClient(
  view: EngineViewport,
  dpr: number,
  x: number,
  y: number,
): { x: number; y: number } {
  return {
    x: (view.offsetX + x * view.scale) / dpr,
    y: (view.offsetY + y * view.scale) / dpr,
  };
}

/* -------------------------------------------------------------------------- */
/* The harness                                                                */
/* -------------------------------------------------------------------------- */

/** How a window is asked for. The clock is what a step-size check varies. */
export type HarnessOptions = EngineHarnessOptions;

/** Everything this case's harness carries past the package's neutral contract. */
export interface WirewormExtras {
  /**
   * The runtime's current state, read fresh on every access. Read it, or pose it
   * through `debug`; nothing here can write to it.
   */
  readonly state: DeepReadonly<WirewormState>;

  /** Drive the runtime's own frame loop for `ms` of real time, then halt it. */
  runFor(ms: number): Promise<void>;

  /**
   * Move the pointer to a logical point with nothing pressed, then run the frame
   * that delivers it. The hover `specs/ui.md` selects a menu item on.
   */
  movePointer(x: number, y: number, options?: PointerOptions): Promise<void>;
  /** Press the pointer at a logical point and leave it down. */
  pressPointer(x: number, y: number, options?: PointerOptions): Promise<void>;
  /** Release a pointer pressed by `pressPointer`, at a logical point. */
  releasePointer(x: number, y: number, options?: PointerOptions): Promise<void>;
  /**
   * Press and release at one logical point, both edges on ONE frame.
   *
   * `specs/ui.md` says a press and the release that follows it may arrive on one
   * frame and that the frame confirms, so this is the ordinary click and the
   * ordinary tap of a finger.
   */
  tapPointer(x: number, y: number, options?: PointerOptions): Promise<void>;

  /**
   * Halt the loop, drop the runtime's listeners, and give the asset host back.
   *
   * The package's own teardown with one line after it: this project stands the
   * loader's two globals up for the life of each harness, so the hold it took
   * when the runtime was built is given up here.
   */
  dispose(): void;
}

/**
 * Everything a check reads off one runtime running one build.
 *
 * The package's engine harness — the driven frame, the sweep, the canvas and its
 * recorder, the cues, the keys, the pixel readings — bound to Wireworm's snapshot,
 * Wireworm's driver and Wireworm's runtime, with the members that are genuinely
 * this case's laid over it.
 */
export type Harness = EngineHarness<
  WirewormSnapshot,
  WirewormDriver,
  WirewormEngine
> &
  WirewormExtras;

/**
 * The package's engine machinery, bound to Wireworm on this runtime.
 *
 * The recorder is asked to MEASURE TEXT and never to INTERN IMAGES. The
 * measurement is what gives a text draw the extent `board/hud-above-board` and
 * `screens/title-highlight` read it through; interning would replace the bitmap
 * in the record with a reference naming it, and every sprite point in this
 * project identifies a frame by rasterizing the SOURCE ITSELF against the seeded
 * PNGs ({@link identifySprite}), so the source has to arrive as the source.
 *
 * `pointerPrecision` and `pointerEvent` are left alone: this case drives its own
 * pointer, for the reasons stated where {@link PointerEventShim} is declared, and
 * the kit's `h.pointer` is not what any check here calls.
 */
const kit = createEngineCaseHarness<
  WirewormSnapshot,
  WirewormDriver,
  WirewormEngine,
  WirewormExtras
>({
  slug: "wireworm",
  projectRoot: PROJECT_ROOT,
  stage: { width: STAGE_W, height: STAGE_H },
  tickHz: TICK_HZ,
  surfaceRequirement: SURFACE_REQUIREMENT,
  recorder: { measureText: true },
  defaultClock: () => new ConstantClock(TICK_MS),
  createEngine: ({ canvas, clock, surface }) => {
    // Before the runtime is built, because the build loads its sprite art inside
    // `initialize` and the kit awaits that.
    const host = installAssetHost(ASSET_HOST);
    const engine = createEngine<WirewormState, WirewormSurface>({
      canvas,
      width: STAGE_W,
      height: STAGE_H,
      game,
      // The build's own stage background, handed to the engine exactly as the
      // seeded `src/main.ts` hands it (specs/overview.md).
      background: BACKGROUND,
      layout: LAYOUT,
      clock: clock as Clock,
      surface: surface as SurfaceMetrics,
    });
    assetHosts.set(engine as object, host);
    return engine;
  },
  driver: (engine, raw) =>
    applyDriver<DeepReadonly<WirewormState>, WirewormState, WirewormDriver>(
      engine,
      raw,
      { readings: READINGS },
    ),
  snapshot: (debug) => debug.snapshot(),
  extend: (base, engine) => {
    // The kit's own teardown, taken before this object is laid over `base`:
    // what `dispose` below overrides IS `base.dispose`, so calling it through
    // `base` after the fact would call itself.
    const destroy = base.dispose.bind(base);

    /**
     * The buttons each pointer id currently holds, kept exactly as a browser
     * keeps them: a press adds one, a release drops one, and every event reports
     * the set as it stands once the event has been applied. Without it a move
     * issued in the middle of a drag would report no button held, and the runtime
     * would read the contact as no longer down.
     */
    const heldButtons = new Map<number, Set<PointerButton>>();
    const buttonsOf = (id: number): Set<PointerButton> => {
      const found = heldButtons.get(id);
      if (found !== undefined) return found;
      const created = new Set<PointerButton>();
      heldButtons.set(id, created);
      return created;
    };

    const dispatchPointer = (
      type: PointerEventName,
      x: number,
      y: number,
      button: number,
      options: PointerOptions,
    ): void => {
      const id = options.id ?? 1;
      const point = toClient(base.viewport(), base.shape.dpr, x, y);
      base.events.dispatchEvent(
        new PointerEventShim(type, {
          clientX: point.x,
          clientY: point.y,
          pointerId: id,
          pointerType: options.device ?? "mouse",
          isPrimary: options.primary ?? true,
          button,
          buttons: buttonMask(buttonsOf(id)),
        }),
      );
    };

    /** The frames a pointer helper runs so the build sees what it dispatched. */
    const deliver = (options: PointerOptions): Promise<void> =>
      base.advance(options.frames ?? 1);

    return {
      get state() {
        return engine.state;
      },

      async runFor(ms: number) {
        const controller = new AbortController();
        const running = engine.run({ signal: controller.signal });
        await new Promise((wake) => setTimeout(wake, ms));
        controller.abort();
        await running;
      },

      async movePointer(x, y, options = {}) {
        // `-1` is what a browser puts in `button` for an event about position.
        dispatchPointer("pointermove", x, y, -1, options);
        await deliver(options);
      },
      async pressPointer(x, y, options = {}) {
        const button = options.button ?? "primary";
        buttonsOf(options.id ?? 1).add(button);
        dispatchPointer("pointerdown", x, y, buttonIndexOf(button), options);
        await deliver(options);
      },
      async releasePointer(x, y, options = {}) {
        const button = options.button ?? "primary";
        buttonsOf(options.id ?? 1).delete(button);
        dispatchPointer("pointerup", x, y, buttonIndexOf(button), options);
        await deliver(options);
      },
      async tapPointer(x, y, options = {}) {
        const button = options.button ?? "primary";
        const id = options.id ?? 1;
        buttonsOf(id).add(button);
        dispatchPointer("pointerdown", x, y, buttonIndexOf(button), options);
        buttonsOf(id).delete(button);
        dispatchPointer("pointerup", x, y, buttonIndexOf(button), options);
        await deliver(options);
      },

      dispose() {
        destroy();
        assetHosts.get(engine as object)?.uninstall();
      },
    };
  },
});

/** Seconds of simulated time in `ticks` frames of the default clock. */
export const seconds = kit.seconds;

/**
 * Whole frames of the default clock covering at least `duration` seconds.
 *
 * Rounded UP, so a hold stated in seconds always covers the whole of it; a check
 * that needs the exact elapsed time asserts against `seconds(ticksFor(d))` rather
 * than against `d`. The package's reading rounds up too, so this is the kit's.
 */
export const ticksFor = kit.ticksFor;

/** A rate in units per second from a displacement measured over `ticks` frames. */
export const speedOverTicks = kit.speedOverTicks;

/**
 * Record the frames `scenario` draws and keep them as the review item's
 * `outputId` output, handing back whatever the scenario returned.
 *
 * Wrap the drive, not the arrangement:
 *
 * ```ts
 * const swept = await captureReplay(h, "propagation", () =>
 *   h.until((s) => s.arcs.length > 0, { maxFrames: 120 }),
 * );
 * assertGreaterThan(swept.snapshot.arcs.length, 0);
 * ```
 *
 * The assertions stay exactly where they were and read exactly what they did.
 * Capture sits BESIDE them rather than in place of them: a check still fails for
 * the reasons it failed before, and the recording is what a reviewer looks at
 * afterwards to see what the build actually drew while it did.
 *
 * ARM IT NARROWLY. A discharge redraws a lightning polyline over every arc for
 * `ARC_LIFE`, and a board redraws its grid every frame, so a recording armed
 * around a whole scenario buys a reviewer nothing and can cost the frames the
 * check was about.
 */
export const captureReplay = makeReplayCapture("wireworm", PROJECT_ROOT);

/**
 * Keep the frame currently on the canvas as the review item's `outputId` output.
 *
 * The companion to {@link captureReplay}, for a point whose evidence is one
 * PICTURE rather than a stretch of motion: the board a discharge left behind,
 * which screen the game opened on, what the HUD read. A recording of a still board
 * would be the same frame three hundred times over.
 *
 * What is written is whatever the last frame that RAN left behind, so call it
 * after the frame that poses the thing under test — an `advance(1)` following the
 * arrangement — and before the assertions, so a check that fails still leaves the
 * picture that shows why. Nothing here can change a verdict: outside a run the
 * media directory is unset and this is a no-op.
 */
export const captureStill = kit.captureStill;

/**
 * Record every cue the build plays from now on, stamped with its frame.
 *
 * The runtime publishes `cue:played` synchronously from inside `audio.play`, so
 * the handler runs while the frame that played it is still running and the
 * runtime's frame counter is that frame's own number. That is what lets a check
 * assert not merely that a cue sounded but that it sounded on the frame of the
 * event — which is what tells a build that plays a cue on the right event apart
 * from one that plays it on every frame, or a frame late.
 *
 * The cue NAMES are `CUES` in `./constants`; specs/ui.md fixes each name and
 * says which event it belongs to.
 */
export const watchCues = kit.watchCues;

/**
 * Build a runtime over a canvas of the harness's own, initialize the build's game,
 * and hand back everything a check reads.
 *
 * The options passed to the factory are the ones the seeded `src/main.ts` passes —
 * the design size, the build's exported `BACKGROUND`, and the touch layout — so
 * one harness serves every build of this case. Everything else the build decided
 * lives inside `src/game.ts`.
 *
 * Dispose it in an `afterEach`, with `?.`, so a build whose `initialize` rejected
 * fails with the runtime's own message rather than with a teardown error on top
 * of it.
 */
export async function createHarness(
  options: HarnessOptions = {},
): Promise<Harness> {
  const h = await kit.createHarness(options);
  // Bounded first and stamped second, so the stamp wraps the bound rather than
  // the bare array and every recorded call passes through both.
  boundDrawLog(h.calls, MAX_RECORDED_CALLS);
  stampTransforms(h.calls, h.ctx);
  return h;
}

/* -------------------------------------------------------------------------- */
/* Reading a snapshot                                                         */
/* -------------------------------------------------------------------------- */
//
// The snapshot is plain data, so most readings are a field access and belong in
// the check that makes them. What is here is the handful a check would otherwise
// write out every time: the tile a reported center stands on, the charge on a
// tile, and finding an entity by the id a pose handed back.
//
// EVERY LOOK-UP BY ID FAILS RATHER THAN RETURNING NOTHING. A check holds an id
// because a pose put an entity on the board and the snapshot reported it; an id
// that is no longer there is the build having lost the entity, which is a verdict
// and not an absent value for the check to reason about. So these fail by
// assertion, naming what the surface promised, and the check reads the entity on
// the next line.

/** The tile a reported center stands on (specs/board.md). */
export function tileOf(x: number, y: number): TileSnapshot {
  return { c: Math.floor(x / TILE), r: Math.floor((y - BOARD_Y) / TILE) };
}

/** Whether two tiles are the same tile. */
export function sameTile(a: TileSnapshot, b: TileSnapshot): boolean {
  return a.c === b.c && a.r === b.r;
}

/** A tile as `"c,r"`, for a set comparison or a failure message. */
export function tileKey(tile: TileSnapshot): string {
  return `${tile.c},${tile.r}`;
}

/**
 * The charge on tile `(c, r)`, or `null` where the tile holds no node.
 *
 * `null` rather than `0`, because the two are different states: an inert node is a
 * node a bolt can clear and a worm can bump, and an empty tile is not
 * (specs/nodes.md).
 */
export function chargeAt(
  snapshot: WirewormSnapshot,
  c: number,
  r: number,
): number | null {
  const node = snapshot.nodes.find((held) => held.c === c && held.r === r);
  return node === undefined ? null : node.charge;
}

/** Every node on the board as `"c,r"`, for a set comparison. */
export function nodeKeys(snapshot: WirewormSnapshot): string[] {
  return snapshot.nodes.map((node) => tileKey(node));
}

/** The worm with that id. Fails the check if the roster no longer holds it. */
export function wormOf(snapshot: WirewormSnapshot, id: number): WormSnapshot {
  const found = snapshot.worms.find((worm) => worm.id === id);
  assertTruthy(
    found,
    `snapshot() must report the worm with id ${id}: an entity added through ` +
      "the surface keeps its id until something removes it " +
      "(specs/instrumentation.md)",
  );
  return found as WormSnapshot;
}

/** The last worm in the roster, which is the one an `addWorm` appended. */
export function lastWorm(snapshot: WirewormSnapshot): WormSnapshot {
  const found = snapshot.worms[snapshot.worms.length - 1];
  assertTruthy(
    found,
    "snapshot() must report the worm addWorm appended to the roster " +
      "(specs/instrumentation.md)",
  );
  return found;
}

/** A worm's head tile, which is `segments[0]`. */
export function headOf(worm: WormSnapshot): TileSnapshot {
  const head = worm.segments[0];
  assertTruthy(
    head,
    `worm ${worm.id} must report at least its head as segments[0] ` +
      "(specs/instrumentation.md)",
  );
  return head;
}

/** A worm's tail tile, which is the last of its segments. */
export function tailOf(worm: WormSnapshot): TileSnapshot {
  const tail = worm.segments[worm.segments.length - 1];
  assertTruthy(
    tail,
    `worm ${worm.id} must report at least its head as segments[0] ` +
      "(specs/instrumentation.md)",
  );
  return tail;
}

/** Whether any worm on the board stands on `(c, r)`. */
export function segmentAt(
  snapshot: WirewormSnapshot,
  c: number,
  r: number,
): boolean {
  return snapshot.worms.some((worm) =>
    worm.segments.some((tile) => tile.c === c && tile.r === r),
  );
}

/** The foe with that id. Fails the check if the roster no longer holds it. */
export function foeOf(snapshot: WirewormSnapshot, id: number): FoeSnapshot {
  const found = snapshot.foes.find((foe) => foe.id === id);
  assertTruthy(
    found,
    `snapshot() must report the foe with id ${id}: an entity added through ` +
      "the surface keeps its id until something removes it " +
      "(specs/instrumentation.md)",
  );
  return found as FoeSnapshot;
}

/** The last foe in the roster, which is the one an `addFoe` appended. */
export function lastFoe(snapshot: WirewormSnapshot): FoeSnapshot {
  const found = snapshot.foes[snapshot.foes.length - 1];
  assertTruthy(
    found,
    "snapshot() must report the foe addFoe appended to the roster " +
      "(specs/instrumentation.md)",
  );
  return found;
}

/** The bolt with that id, or `null` once it has resolved or left the board. */
export function boltOf(
  snapshot: WirewormSnapshot,
  id: number,
): BoltSnapshot | null {
  return snapshot.bolts.find((bolt) => bolt.id === id) ?? null;
}

/** The last bolt in the roster, which is the one an `addBolt` appended. */
export function lastBolt(snapshot: WirewormSnapshot): BoltSnapshot {
  const found = snapshot.bolts[snapshot.bolts.length - 1];
  assertTruthy(
    found,
    "snapshot() must report the bolt addBolt appended to the roster " +
      "(specs/instrumentation.md)",
  );
  return found;
}

/**
 * One arc as `"c,r>c,r"`, in the direction the snapshot reported it.
 *
 * Ordered, because that is what `discharge.detonated-once` reads: a node detonated
 * a second time re-emits its links, so the same ordered pair appearing twice is
 * the witness of a double detonation.
 */
export function arcKey(arc: ArcSnapshot): string {
  return `${tileKey(arc.from)}>${tileKey(arc.to)}`;
}

/** Every live arc as `"c,r>c,r"`, in roster order. */
export function arcKeys(snapshot: WirewormSnapshot): string[] {
  return snapshot.arcs.map(arcKey);
}

/* -------------------------------------------------------------------------- */
/* Scenario helpers                                                           */
/* -------------------------------------------------------------------------- */
//
// Each of these poses a situation through the debug surface and then lets the real
// simulation run. THEY FIX ONLY GEOMETRY: which tile a worm's head is on, which
// tile a node stands on, where the cursor is parked. Every threshold a check
// asserts is stated in the check itself, derived from the figure specs/ fixes for
// it, because a helper that carried the tolerance would hide what the check is
// really asserting.
//
// The debug surface is atomic by design (specs/instrumentation.md), so every
// compound sequence lives here. A check that needs all of a sequence calls the
// helper; a check that needs only part of it calls the operations it needs.
// Nothing a check does not ask for happens.

/**
 * The center of the player band, where a run and every respawn place the cursor
 * (specs/board.md).
 *
 * Derived from the clamp bounds rather than restated, so the two cannot drift.
 */
export const BAND_CX = (CURSOR_X_MIN + CURSOR_X_MAX) / 2;
export const BAND_CY = (CURSOR_Y_MIN + CURSOR_Y_MAX) / 2;

/**
 * Open live play on an EMPTY, QUIET board at level 1, with the cursor parked in
 * the middle of its band.
 *
 * This is the ground almost every check in this suite stands on, and both halves
 * of it are load-bearing.
 *
 * EMPTY is safe because of the level-clear rule: a level clears on the step in
 * which the last of its worm segments is REMOVED, so a board that never held one
 * never clears (specs/progression.md). A check therefore poses exactly the
 * entities its requirement concerns and nothing else, rather than keeping a
 * bystander worm alive to hold the level open.
 *
 * QUIET is the three world gates. With `foeSpawning`, `wormEntry` and the cursor's
 * `contact` all off, nothing the scenario did not ask for arrives, enters, or
 * costs a life — and each of the three would otherwise reach in. An empty board is
 * maximally sparse, so from level 3 a dropper is drawn in on the first
 * `DROPPER_CHECK_INTERVAL` check and from level 2 glitches arrive every
 * `GLITCH_MIN_INTERVAL`–`GLITCH_MAX_INTERVAL`; the level's worm enters as the
 * banner gives way to `active`; and the cursor is the one entity no scenario can
 * remove, so its contact test reaches into any scenario run near the band or
 * advanced far enough for a foe to descend, where a life lost empties both
 * rosters mid-scenario.
 *
 * TURNING A GATE BACK ON IS THE EXCEPTION, AND THE CHECK THAT DOES IT IS THE CHECK
 * WHOSE REQUIREMENT THE GATE IS — the foes' arrival items for `setFoeSpawning`,
 * the worm-entry and respawn items for `setWormEntry`, the contact, life-loss and
 * respawn items for `setCursorContact`. Any other check that finds itself needing
 * one has been mis-posed; re-pose it.
 *
 * It poses and returns; it runs no frame. A check advances the frames its own
 * reading needs.
 *
 * It is written for a FRESH harness, whose state is the opening one, so it does
 * not reset: the score, the lives and the seed are already at their title values.
 * A check that reuses a harness across scenarios calls `h.debug.reset()` first.
 */
export function startPlaying(h: Harness): void {
  h.debug.clearNodes();
  h.debug.clearWorms();
  h.debug.clearFoes();
  h.debug.clearBolts();

  h.debug.setFoeSpawning(false);
  h.debug.setWormEntry(false);
  h.debug.setCursorContact(false);

  h.debug.setScreen("playing");
  h.debug.setPhase("active");
  h.debug.setPhaseTimer(0);
  h.debug.setLevel(1);

  h.debug.setCursor(BAND_CX, BAND_CY);
  h.debug.setCursorInvulnerable(0);
  h.debug.setFireCooldown(0);

  // The level is posed above and the step interval and the worm length follow
  // it, so the readings are brought into agreement before the caller reads them.
  h.debug.reconcile();
}

/**
 * Pose one worm, head on `(c, r)`, `length` segments long, and report its id.
 *
 * The body is laid along the head's row BEHIND the head — the tile the head came
 * from, and the one behind that — so a worm heading right at `(c, r)` occupies
 * `(c, r)`, `(c - 1, r)`, and so on. Pose the head at least `length - 1` tiles
 * from the edge it came from, or a trailing segment lands off the board.
 *
 * The headings are posed after the segments, so `dh` and `dv` are what the worm
 * holds when the first frame runs, whatever `addWorm` opened with. Both faculties
 * are left ON, which is what `addWorm` gives: a check that wants the head to move
 * one tile and nothing else turns `body` off, and a check that wants the worm as
 * an obstacle turns `stepping` off.
 */
export function poseWorm(
  h: Harness,
  c: number,
  r: number,
  length = 1,
  dh = 1,
  dv = 1,
): number {
  h.debug.addWorm(c, r);
  const id = lastWorm(h.snapshot()).id;
  for (let i = 1; i < length; i += 1) {
    h.debug.appendSegment(id, c - dh * i, r);
  }
  h.debug.setWormHeading(id, dh);
  h.debug.setWormDescent(id, dv);
  return id;
}

/**
 * Pose one foe of `kind` centered on tile `(c, r)`, and report its id.
 *
 * It arrives at that kind's own resting velocity with both faculties on, which is
 * what `addFoe` gives. A check about what a foe DOES to the field turns `travel`
 * off, so the effect happens with no motion at all; a check about how it TRAVELS
 * leaves both on and reads distances.
 */
export function poseFoe(
  h: Harness,
  kind: FoeKind,
  c: number,
  r: number,
): number {
  h.debug.addFoe(kind, tileCX(c), tileCY(r));
  return lastFoe(h.snapshot()).id;
}

/**
 * Pose one bolt in flight, centered on tile `(c, r)`, and report its id.
 *
 * The bolt travels up and resolves through the game's own shot rules from there;
 * pose it below the thing the check is about, far enough to leave a frame or two
 * of flight.
 */
export function poseBolt(h: Harness, c: number, r: number): number {
  h.debug.addBolt(tileCX(c), tileCY(r));
  return lastBolt(h.snapshot()).id;
}

/**
 * Pose a patch of node field from a picture of it, its top-left tile at
 * `(c0, r0)`.
 *
 * A digit `0`–`3` sets the node on that tile to that charge; any other character
 * leaves the tile exactly as it was. On the empty board {@link startPlaying}
 * poses, "leaves it as it was" is "leaves it empty", which is what makes a cluster
 * read as the picture of it:
 *
 * ```ts
 * poseField(h, ["...", ".3.", "..."], 10, 5); // one critical node at (11, 6)
 * ```
 */
export function poseField(
  h: Harness,
  rows: readonly string[],
  c0: number,
  r0: number,
): void {
  rows.forEach((row, dr) => {
    [...row].forEach((cell, dc) => {
      if (cell >= "0" && cell <= "3") {
        h.debug.setNode(c0 + dc, r0 + dr, Number(cell));
      }
    });
  });
}

/**
 * Hold every key in `codes` for `ticks` frames, then release them.
 *
 * Nothing here poses anything: the keys go to the engine's own input, so the game
 * answers them exactly as it answers a player. Which key drives which action is
 * `BINDINGS`, as specs/controls.md fixes it and `./constants` restates it.
 */
export async function holdFor(
  h: Harness,
  codes: string | readonly string[],
  ticks: number,
): Promise<void> {
  const held = typeof codes === "string" ? [codes] : codes;
  for (const code of held) h.hold(code);
  try {
    await h.advance(ticks);
  } finally {
    for (const code of held) h.release(code);
  }
}

/**
 * Run exactly one frame and hand back the calls THAT frame made.
 *
 * The reading every rendering check opens with. {@link Harness.calls} accumulates
 * across frames, so what a check about the picture wants is the frame it just
 * drove and not the setup before it.
 */
export async function drawFrame(h: Harness): Promise<DrawCall[]> {
  h.calls.length = 0;
  await h.advance(1);
  return [...h.calls];
}

/* ========================================================================== */
/* What the build drew, and what it played                                    */
/* ========================================================================== */
//
// The presentation and audio halves of this suite need three things the scenario
// helpers above do not provide: a cue record stamped with the frame each cue fired
// on, a colour sampler over the rendered canvas, and a way to ask what a single
// frame's render put where. THE PALETTE IS THE BUILD'S — specs/overview.md fixes
// no colour and no typeface, only what a player must be able to tell apart — so
// nothing here knows a colour: the samplers compare what was painted against what
// else was painted.

/* ---- Text ----------------------------------------------------------------- */
//
// Copy is read through the shared harness's `drewText` (`case-harness/text`),
// which the screen suites import directly: a substring of the logical runs a
// frame spells, ignoring case, so a letter-spaced heading and a menu entry drawn
// beside its marker both read as the words they show. The text readers below
// are the readings this case needs beyond it.

/**
 * Every string the frame drew, BOTH as the calls split it and as the logical
 * runs those calls spell.
 *
 * For the readers that hold a word or a figure to a boundary on both sides —
 * the how-to screen's key names, the end screens' score — where neither reading
 * alone is enough. A figure letter-spaced a digit per call is whole only in the
 * run it spells, and a label drawn one space clear of its figure is bounded only
 * in the call that drew the figure, because a gap that narrow joins the two into
 * one run. The union can only add a match: every raw string is still here, and
 * every run is a superstring of the calls that spelled it.
 */
export function drawnTextForms(calls: readonly DrawCall[]): string[] {
  return [...drawnText(calls), ...drawnTextLines(calls)];
}

/** One run of text a frame drew, and the logical x range its glyphs span. */
export type TextSpan = TextDraw;

/**
 * Every run of text `calls` drew, placed in logical units, ONE PER CALL.
 *
 * A build may anchor its text through any `translate`/`scale` it likes and align
 * it any way it likes, so the anchor is mapped through the transform the context
 * held at the call and the run is extended about it by its measured width and
 * `textAlign`. Which way a `start`/`end` alignment reads is the page's direction;
 * this game draws no right-to-left text, so they are left and right.
 *
 * The package's reading answers in CANVAS pixels, because that is where the calls
 * were made, so it is taken back through the runtime's own fit into the logical
 * units every figure this suite states is stated in. At the harness's default
 * shape the two coincide; at any other they do not.
 */
export function drawnTextSpans(
  h: Harness,
  calls: readonly DrawCall[] = h.calls,
): TextSpan[] {
  return allInLogical(h.viewport(), textDraws(calls));
}

/**
 * Every LOGICAL RUN of text `calls` drew, placed in logical units.
 *
 * {@link drawnTextSpans} is one span per call, which is the reading for a check
 * that holds each draw's own extent. A build that letter-spaces a menu item or
 * a HUD label draws a glyph per call, so a check that has to FIND the text
 * carrying some copy before it can place it reads these as well: the shared
 * harness's merge rule (`case-harness/text.ts`) folds side-by-side draws on one
 * baseline back into the string they spell, and a run keeps the placement of
 * its first draw and spans its glyphs' extent. The rule is decided in the
 * canvas's own pixels, where the calls were made — the recorder stamps the
 * transform in force beside every text call, the engine's fit included — and
 * the runs are taken back through that fit into logical units here exactly as
 * the spans are.
 */
export function drawnTextRunSpans(
  h: Harness,
  calls: readonly DrawCall[] = h.calls,
): TextSpan[] {
  return allInLogical(h.viewport(), drawnTextRuns(calls));
}

/**
 * Every span of text `calls` drew, BOTH as the calls split it and as the runs
 * those calls spell: the placed counterpart of {@link drawnTextForms}.
 *
 * For the reader that locates copy on the frame — the row a menu item sits on,
 * the label a readout's digits must sit beside, the readout that must sit
 * inside the bar. A span holds the copy whole only if the build drew it in one
 * call, and a run only if the run did not swallow a boundary the reader holds,
 * so neither alone is enough and the union can only add a match. A run of one
 * draw is that draw, and is listed once.
 */
export function drawnTextSpanForms(
  h: Harness,
  calls: readonly DrawCall[] = h.calls,
): TextSpan[] {
  const spans = drawnTextSpans(h, calls);
  const runs = drawnTextRunSpans(h, calls).filter(
    (run) => !spans.some((span) => sameSpan(span, run)),
  );
  return [...spans, ...runs];
}

/** How far apart two placements of one draw may read, in logical units. */
const SAME_SPAN_SLACK = 1e-3;

/** Whether two spans are one draw read twice: the same text at the same place. */
function sameSpan(a: TextSpan, b: TextSpan): boolean {
  return (
    a.text === b.text &&
    Math.abs(a.y - b.y) <= SAME_SPAN_SLACK &&
    Math.abs(a.left - b.left) <= SAME_SPAN_SLACK &&
    Math.abs(a.right - b.right) <= SAME_SPAN_SLACK
  );
}

/* ---- Where a frame put its sprites ---------------------------------------- */

/** One `drawImage` a frame made, placed in logical units. */
export interface DrawnImage {
  /** The image the build handed the context: the frame it drew from. */
  source: unknown;
  /** The destination box's CENTER, in logical units. */
  x: number;
  y: number;
  /** The destination box's size, in logical units, always positive. */
  w: number;
  h: number;
  /** The build drew it flipped, which is how a leftward body is mirrored. */
  mirrored: boolean;
}

/** A source's own pixel size, where it reports one. */
function naturalSize(
  source: unknown,
): { width: number; height: number } | null {
  const held = source as { width?: unknown; height?: unknown };
  if (typeof held?.width !== "number" || typeof held?.height !== "number") {
    return null;
  }
  return { width: held.width, height: held.height };
}

/**
 * Every `drawImage` in `calls`, with its destination box mapped into logical
 * units.
 *
 * A build draws a sprite by translating to the tile's center and drawing the frame
 * about the origin, so the call's own arguments say nothing about where the sprite
 * landed. The destination box's center is taken through the transform the context
 * held at the call and then back through the engine's fit, so what comes out is
 * the point on the stage a check can hold against a reported center — which is how
 * a draw is attributed to the node, segment or foe it was drawn for.
 *
 * THE CASE'S OWN WALK, over the package's `imageDraws`. That reading identifies a
 * source by the reference the recorder INTERNS for it, and this project's sprite
 * points rasterize the SOURCE ITSELF against the seeded PNGs, so the bitmap has to
 * reach a check untouched — which is why the recorder is asked not to intern.
 *
 * All three argument forms are read: `(image, dx, dy)`, `(image, dx, dy, dw, dh)`,
 * and the nine-argument form with a source rectangle.
 */
export function drawnImages(
  h: Harness,
  calls: readonly DrawCall[] = h.calls,
): DrawnImage[] {
  const view = h.viewport();
  const drawn: DrawnImage[] = [];
  for (const call of calls) {
    if (call.kind !== "call" || call.method !== "drawImage") continue;
    const m = call.transform;
    if (m === undefined) continue;
    const [source, ...rest] = call.args;

    let box: [number, number, number, number] | null = null;
    if (rest.length >= 8) {
      box = rest.slice(4, 8) as [number, number, number, number];
    } else if (rest.length >= 4) {
      box = rest.slice(0, 4) as [number, number, number, number];
    } else if (rest.length >= 2) {
      const size = naturalSize(source);
      if (size !== null) {
        box = [rest[0] as number, rest[1] as number, size.width, size.height];
      }
    }
    if (box === null || !box.every((value) => typeof value === "number")) {
      continue;
    }

    const [dx, dy, dw, dh] = box;
    const lx = dx + dw / 2;
    const ly = dy + dh / 2;
    const deviceX = m.a * lx + m.c * ly + m.e;
    const deviceY = m.b * lx + m.d * ly + m.f;
    drawn.push({
      source,
      x: (deviceX - view.offsetX) / view.scale,
      y: (deviceY - view.offsetY) / view.scale,
      w: Math.abs(dw * Math.hypot(m.a, m.b)) / view.scale,
      h: Math.abs(dh * Math.hypot(m.c, m.d)) / view.scale,
      // A negative determinant is a flip, whichever axis the build wrote it on.
      mirrored: m.a * m.d - m.b * m.c < 0,
    });
  }
  return drawn;
}

/* ---- The seeded art ------------------------------------------------------- */

/** Every folder under `assets/`, and how many frames each holds. */
export const SPRITE_FOLDERS = {
  node: NODE_FRAMES,
  worm: WORM_FRAMES,
  cursor: CURSOR_FRAMES,
  glitch: GLITCH_FRAMES,
  dropper: DROPPER_FRAMES,
  corruptor: CORRUPTOR_FRAMES,
} as const;

export type SpriteFolder = keyof typeof SPRITE_FOLDERS;

/** One seeded frame, as the comparison reads it. */
export interface SeededFrame {
  folder: SpriteFolder;
  index: number;
  width: number;
  height: number;
  /** Premultiplied RGBA, four channels per pixel. */
  pixels: Float64Array;
}

/**
 * How far a drawn source's pixels may sit from a seeded frame's, as a mean
 * absolute difference over premultiplied RGBA channels, out of `255`.
 *
 * The requirement is IDENTITY — the source IS the seeded frame — so this is not a
 * likeness tolerance. It is room for the one lossy step in reading a bitmap back
 * out of a canvas: a partially transparent pixel is premultiplied on the way in
 * and un-premultiplied on the way out, so it can shift by a unit. Comparing on
 * premultiplied channels removes even that, and a different frame of the SAME
 * folder measures several times this.
 */
export const SPRITE_MATCH_MAX = 1;

/** A drawable source's premultiplied RGBA channels, rasterized at its own size. */
async function rasterize(
  source: unknown,
): Promise<{ width: number; height: number; pixels: Float64Array } | null> {
  const size = naturalSize(source);
  if (size === null || size.width <= 0 || size.height <= 0) return null;
  const canvas = createCanvas(size.width, size.height);
  const ctx = canvas.getContext("2d");
  try {
    ctx.drawImage(
      source as Parameters<SKRSContext2D["drawImage"]>[0],
      0,
      0,
      size.width,
      size.height,
    );
  } catch {
    return null;
  }
  const { data } = ctx.getImageData(0, 0, size.width, size.height);
  const pixels = new Float64Array(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3] / 255;
    pixels[i] = data[i] * alpha;
    pixels[i + 1] = data[i + 1] * alpha;
    pixels[i + 2] = data[i + 2] * alpha;
    pixels[i + 3] = data[i + 3];
  }
  return { width: size.width, height: size.height, pixels };
}

/** The mean absolute difference between two equal-length channel runs. */
function meanDifference(a: Float64Array, b: Float64Array): number {
  let total = 0;
  for (let i = 0; i < a.length; i += 1) total += Math.abs(a[i] - b[i]);
  return total / a.length;
}

/** Read once, because every presentation check reads the same twenty-one files. */
let seeded: Promise<SeededFrame[]> | null = null;

/**
 * Every frame of the seeded art, read off the workspace's own `assets/` tree.
 *
 * The same tree the build was handed, so a match is against exactly the art the
 * case seeded rather than against a copy of it (specs/assets.md).
 */
export function seededFrames(): Promise<SeededFrame[]> {
  // A read that failed is NOT kept: a memoised rejection would answer every later
  // check with the first one's error, long after whatever caused it.
  seeded ??= readSeededFrames().catch((error: unknown) => {
    seeded = null;
    throw error;
  });
  return seeded;
}

/** Every seeded frame, read off disk and rasterized once. */
async function readSeededFrames(): Promise<SeededFrame[]> {
  const frames: SeededFrame[] = [];
  for (const folder of Object.keys(SPRITE_FOLDERS) as SpriteFolder[]) {
    for (let index = 0; index < SPRITE_FOLDERS[folder]; index += 1) {
      const bytes = readFileSync(
        join(WORKSPACE, "assets", folder, `${index}.png`),
      );
      const raster = await rasterize(await loadImage(bytes));
      if (raster === null) continue;
      frames.push({ folder, index, ...raster });
    }
  }
  return frames;
}

/** Which seeded frame a drawn source is, or `null` where it is none of them. */
export interface SpriteMatch {
  folder: SpriteFolder;
  index: number;
  /** The mean absolute channel difference the match was made at. */
  difference: number;
}

/**
 * Identify the seeded frame a build drew from, or `null` where it drew from
 * something else.
 *
 * The reading is the IMAGE SOURCE ITSELF rather than the pixels on the stage: the
 * bitmap the build handed the context is rasterized and held against the seeded
 * PNGs. A source that IS a seeded frame matches it exactly; anything else — a
 * canvas the build painted, art of its own, a recoloured copy — does not. That is
 * what tells a build drawing the game from the seeded art apart from one drawing
 * convincing shapes in code, which is the whole point of the sprite items.
 */
export async function identifySprite(
  source: unknown,
  frames?: readonly SeededFrame[],
): Promise<SpriteMatch | null> {
  const sheet = frames ?? (await seededFrames());
  const raster = await rasterize(source);
  if (raster === null) return null;
  let best: SpriteMatch | null = null;
  for (const frame of sheet) {
    if (frame.width !== raster.width || frame.height !== raster.height)
      continue;
    const difference = meanDifference(raster.pixels, frame.pixels);
    if (best === null || difference < best.difference) {
      best = { folder: frame.folder, index: frame.index, difference };
    }
  }
  return best !== null && best.difference <= SPRITE_MATCH_MAX ? best : null;
}

/* ---- Colour --------------------------------------------------------------- */

/**
 * The rendered colour at a logical point, averaged over a small cluster.
 *
 * The centre pixel plus four neighbours 4 units out, which on a `32`-unit tile all
 * stay well inside it, so one stray anti-aliased or glow pixel cannot swing the
 * reading. The package takes the radius from its caller for exactly that reason —
 * what "comfortably inside the body" means is the case's own geometry — and four
 * is the radius every reading in this project was taken at.
 */
export function sampleColor(h: Harness, x: number, y: number): Rgb {
  return clusterSample(h, x, y, 4);
}

/** The rendered colour on tile `(c, r)`, sampled about its centre. */
export function sampleTile(h: Harness, c: number, r: number): Rgb {
  return sampleColor(h, tileCX(c), tileCY(r));
}

/**
 * `steps` colours sampled evenly along the segment joining two logical points,
 * both ends included.
 *
 * How a check reads whether the build drew something ALONG a line — an arc between
 * two tile centres, a bolt's climb — without knowing what colour it drew it in.
 */
export function samplesAlong(
  h: Harness,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps: number,
): Rgb[] {
  const samples: Rgb[] = [];
  const last = Math.max(1, steps - 1);
  for (let i = 0; i < steps; i += 1) {
    const t = i / last;
    samples.push(
      sampleColor(
        h,
        from.x + (to.x - from.x) * t,
        from.y + (to.y - from.y) * t,
      ),
    );
  }
  return samples;
}

/* -------------------------------------------------------------------------- */
/* The menus, where the build drew them                                       */
/* -------------------------------------------------------------------------- */
//
// `specs/ui.md` gives every menu screen a mouse and a finger as well as the
// keyboard, and deliberately leaves the LAYOUT to the build: what it fixes is
// that the build reports each item's hit region through `menuItemRect`, and that
// a pointer over that region selects the item. So every helper below asks the
// build where it put the item and then drives the pointer there. Nothing here
// knows a menu coordinate, and a build that lays its menus out any way it likes
// passes.

/**
 * The hit region of item `index` on the menu the current screen shows.
 *
 * `menuItemRect` returns `null` on `playing` and `howto`, which show no menu,
 * and for an index the current menu has no item at. A check that asked for an
 * item it expects to exist gets a failure naming the reading rather than a
 * `TypeError` on the next line.
 *
 * THE INDEX REACHES THE BUILD. `menuItemRect` is a declared READING
 * (`surface.ts`), so the driver hands it `engine.state` followed by every argument
 * the check passed; a reading whose index was dropped would answer about item zero
 * with nothing to say so.
 */
export function menuRect(h: Harness, index: number): MenuRect {
  const rect = h.debug.menuItemRect(index);
  assertTruthy(
    rect,
    `menuItemRect(${index}) must report the hit region of item ${index} on ` +
      `the menu the current screen shows (specs/instrumentation.md)`,
  );
  return rect as MenuRect;
}

/** The centre of item `index`'s hit region, in logical units. */
export function menuItemCenter(
  h: Harness,
  index: number,
): { x: number; y: number } {
  const rect = menuRect(h, index);
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/**
 * Move the pointer onto item `index` and run the frame that delivers it.
 *
 * The hover `specs/ui.md` selects on: no button is pressed, so what a check
 * reads afterwards is `menuIndex` alone.
 */
export async function pointAtItem(
  h: Harness,
  index: number,
  options: PointerOptions = {},
): Promise<void> {
  const at = menuItemCenter(h, index);
  await h.movePointer(at.x, at.y, options);
}

/**
 * Press and release inside item `index`'s region, both edges on one frame.
 *
 * A press and its release inside ONE region is what confirms (`specs/ui.md`),
 * and a frame may carry both, so this is the ordinary click. Pass
 * `device: "touch"` for the finger's form of the same gesture, whose landing
 * also selects.
 */
export async function clickItem(
  h: Harness,
  index: number,
  options: PointerOptions = {},
): Promise<void> {
  const at = menuItemCenter(h, index);
  await h.tapPointer(at.x, at.y, options);
}

/** {@link clickItem} with a finger: a touch contact landing and lifting. */
export function touchItem(
  h: Harness,
  index: number,
  options: PointerOptions = {},
): Promise<void> {
  return clickItem(h, index, { ...options, device: "touch" });
}

/**
 * Press inside item `from`'s region, travel onto item `to`'s, and release there.
 *
 * The slide-off affordance: a press begun on one item and released on another
 * confirms nothing (`specs/ui.md`). Three driven frames, so the press, the
 * travel and the release are each read.
 */
export async function slideOffItem(
  h: Harness,
  from: number,
  to: number,
  options: PointerOptions = {},
): Promise<void> {
  const start = menuItemCenter(h, from);
  await h.pressPointer(start.x, start.y, options);
  const end = menuItemCenter(h, to);
  await h.movePointer(end.x, end.y, options);
  await h.releasePointer(end.x, end.y, options);
}

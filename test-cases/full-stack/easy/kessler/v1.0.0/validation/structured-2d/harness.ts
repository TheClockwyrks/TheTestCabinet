// Kessler — the case's half of the validator harness. CASE-PROVIDED.
//
// Every check in this project is an ordinary vitest test that runs IN THE SAME
// PROCESS as the build. It imports the engine and the build's own
// `src/game.ts`, creates an engine over a canvas it owns and a clock it chose,
// and steps the game with `engine.advance`. Nothing drives a browser, nothing
// polls, and no wall-clock time passes: a check asks for a number of ticks and
// gets exactly that number.
//
// THE MACHINERY THAT DOES THAT IS NOT KESSLER'S. The canvas and its draw-command
// recorder, the debug surface and the stand-in for a missing one, the frame
// sweep, the key and pointer events, the cue stamping, the host that serves the
// build's own produced files to the engine's loader, and the evidence a review
// item's output is written from — every engine-backed case needs exactly that,
// and it lives once, in `@clockwyrks/case-harness`, staged beside this file as
// `./case-harness/`. What is left HERE is what is genuinely Kessler's: its
// types, the polar mapping every rule of the game is stated in, the blit reading
// its produced sprites are decided on, and every scenario helper that poses this
// game.
//
// WHAT A CHECK READS. The game's own state (through the case's `snapshot`),
// the engine's object model — the open world, the game state its mode built,
// its controllers — the engine's frame counter, the cue events it broadcast,
// the draw calls the pipeline issued, and the pixels those calls left on the
// canvas. Nothing here fabricates an outcome: the helpers below only ARRANGE
// the world through the debug surface, and the real ticks the build wrote are
// what run from there. Kessler's collisions are simulation-owned
// (`specs/field.md` decides every contact from the state's own polar figures),
// so no engine collision event is read anywhere: everything comes off the
// debug surface and the world.
//
// WHY THE DEBUG SURFACE RATHER THAN RAW ASSIGNMENT. `specs/instrumentation.md`
// fixes its operations, so they mean the same thing in every build: a pose
// arranges the running game through the same systems play uses, the two driver
// switches hold the game's autonomous consequences still while one behavior is
// watched, and `reset` gives everything back. `surface.ts` is that
// specification as types, and it is the only description of the surface this
// harness reads: the build's own module for it is never imported.
//
// WHERE THE SURFACE COMES FROM. Off `engine.debug`, never built here. The
// build's game instance returns it from `initialize`, the engine holds that
// same object, and reading it back off the engine is the only way a surface
// reaches a check — so a build that returned no surface, or one missing an
// operation, fails the checks that reach the game through it, at the moment a
// check first reaches for an operation. The surface is already imperative under
// this engine, so what a check holds is the object the build returned,
// untouched: the package's {@link identityDriver}.
//
// THE CLOCK. `ConstantClock(TICK_MS)` — 1000/60 ms per frame — exactly the
// pairing `specs/instrumentation.md` names: one frame consumes exactly one
// tick, because the accumulator receives the same float it compares against
// and consumes, so `engine.advance(n)` is `n` ticks. A check about the
// subdivision of a tick builds a harness with a clock of its own
// ({@link HarnessOptions.clock}).
//
// INPUT EDGES ARE CONSUMED PER CONTROLLER. An edge is `pressed` once for each
// reader that asks, so a check that read `world.players()[0].input` would eat
// the copy the BUILD's own controller was going to read. A check that wants to
// read an action for itself takes {@link addObserver} instead.

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Canvas, SKRSContext2D } from "@napi-rs/canvas";
import {
  ConstantClock,
  createEngine,
  PlayerController,
  type Clock,
  type Engine,
  type GameDefinition,
  type GameInstance,
  type GameState,
  type SurfaceMetrics,
  type Viewport,
  type World,
} from "@clockwyrks/structured-2d";
import {
  createEngineCaseHarness,
  identityDriver,
  installAssetHost,
  type AssetFailure,
  type DrivenEngine,
  type EngineHarness,
  type EngineHarnessOptions,
  type TimedCue,
  type UntilOptions,
  type UntilResult as BaseUntilResult,
} from "./case-harness/engine/index";
import { makeReplayCapture } from "./case-harness/engine/2d";
import type { DrawCall } from "./case-harness/draw-calls";
import {
  drawnText,
  textDraws as placedText,
  DEFAULT_TEXT_ALIGN,
  type TextDraw as PlacedText,
} from "./case-harness/text";
import { colorDistance, type Rgb } from "./case-harness/color";
import {
  apply,
  IDENTITY,
  transformed,
  type Matrix,
} from "./case-harness/matrix";
import { BACKGROUND, game as build } from "../src/game";
import { fail } from "./assert";
import {
  STAGE_CX,
  STAGE_CY,
  STAGE_H,
  STAGE_W,
  TICK_HZ,
  TICK_MS,
  WAVECLEAR_TICKS,
} from "./constants";
import {
  REQUIRED_OPS,
  type KesslerDebugApi,
  type KesslerSnapshot,
  type MenuItemRect,
  type PodKind,
  type Screen,
} from "./surface";

export type { KesslerDebugApi, KesslerSnapshot, MenuItemRect, PodKind, Screen };
export { REQUIRED_OPS };

/* The readings the package already carries, under the names the suites say. */
export { colorDistance, drawnText };
export type { AssetFailure, DrawCall, Matrix, Rgb, TimedCue, UntilOptions };

/** What a sweep found: whether the predicate ever held, and where it stopped. */
export type UntilResult = BaseUntilResult<KesslerSnapshot>;

/** The case's surface, exactly as `surface.ts` specifies it. */
export type KesslerSurface = KesslerDebugApi;

/** The engine this project's checks run the build on. */
export type KesslerEngine = Engine<KesslerSurface>;

/**
 * The build's game, typed against the surface the CASE specifies.
 *
 * The build declares its own type for the surface its instance's `initialize`
 * returns; what a check holds it to is `surface.ts`, so the definition is cast
 * to the case's `GameDefinition<KesslerSurface>` here and the engine is
 * parameterized with it. A surface that departs from the specification is
 * caught where a check reaches for the missing member, not by the build's own
 * compiler.
 */
const game = build as unknown as GameDefinition<KesslerSurface>;

/* -------------------------------------------------------------------------- */
/* The step schedule                                                          */
/* -------------------------------------------------------------------------- */
//
// One frame is one tick. `specs/instrumentation.md` states the pairing itself:
// "a scenario pairs a `ConstantClock` of `1000 / 60` milliseconds with
// `engine.advance`, so one frame consumes exactly one tick". The delta each
// frame supplies is the very float the build's accumulator compares against
// and subtracts, so the arithmetic is exact frame after frame: no residue
// accumulates, and a section resolves the ticks it asked for however long it
// runs.

/** Frames covering `ticks` whole ticks of simulation time: one for one. */
export const FRAMES_PER_TICK = 1;

/** Frames covering `seconds` of simulation time, rounded up to a whole frame. */
export function secondFrames(seconds: number): number {
  return Math.ceil(seconds * 60 - 1e-9);
}

/* -------------------------------------------------------------------------- */
/* The polar mapping, as the specification fixes it                           */
/* -------------------------------------------------------------------------- */
//
// `specs/overview.md`: `x = 500 + r * cos(theta * PI / 180)`,
// `y = 500 + r * sin(theta * PI / 180)`, angles in `[0, 360)`, `0` along `+x`
// and increasing toward `+y`. `specs/field.md` fixes the wrap-aware offset in
// `[-180, 180)` and the radial/tangential frame at a ball's center.

/** Degrees normalized into `[0, 360)`. */
export function normDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** The wrap-aware signed offset from `fromDeg` to `toDeg`, in `[-180, 180)`. */
export function angularOffset(fromDeg: number, toDeg: number): number {
  return normDeg(toDeg - fromDeg + 180) - 180;
}

/** The stage point at radius `r`, angle `thetaDeg`, under the polar mapping. */
export function polarToXy(
  r: number,
  thetaDeg: number,
): { x: number; y: number } {
  const rad = (thetaDeg * Math.PI) / 180;
  return { x: STAGE_CX + r * Math.cos(rad), y: STAGE_CY + r * Math.sin(rad) };
}

/** The polar reading of a stage point: `r`, and `thetaDeg` in `[0, 360)`. */
export function xyToPolar(
  x: number,
  y: number,
): { r: number; thetaDeg: number } {
  const dx = x - STAGE_CX;
  const dy = y - STAGE_CY;
  return {
    r: Math.hypot(dx, dy),
    thetaDeg: normDeg((Math.atan2(dy, dx) * 180) / Math.PI),
  };
}

/**
 * A velocity from its polar components at angle `thetaDeg`: `vr` along the
 * outward unit radial `n`, `vt` along the unit tangential `t` (`n` rotated by
 * `+90` degrees, so positive `vt` is toward `+theta`).
 */
export function polarVelocity(
  thetaDeg: number,
  vr: number,
  vt: number,
): { vx: number; vy: number } {
  const rad = (thetaDeg * Math.PI) / 180;
  const nx = Math.cos(rad);
  const ny = Math.sin(rad);
  return { vx: vr * nx - vt * ny, vy: vr * ny + vt * nx };
}

/** A velocity's polar components at the stage point `(x, y)`. */
export function velocityPolar(
  x: number,
  y: number,
  vx: number,
  vy: number,
): { vr: number; vt: number } {
  const { thetaDeg } = xyToPolar(x, y);
  const rad = (thetaDeg * Math.PI) / 180;
  const nx = Math.cos(rad);
  const ny = Math.sin(rad);
  return { vr: vx * nx + vy * ny, vt: -vx * ny + vy * nx };
}

/**
 * The center angle of slot `slot`'s target arc on a ring posed at
 * `ringAngleDeg`, in `[0, 360)`.
 *
 * `specs/rings.md`: slot `k` begins at the ring's angle plus `k` slot widths,
 * its target arc begins `2` degrees into the slot and spans the target arc
 * width — so the arc's center sits `2 + arc / 2` degrees into the slot.
 */
export function slotArcCenterDeg(
  ring: number,
  slot: number,
  ringAngleDeg: number,
): number {
  const spec = RING_TABLES[ring - 1];
  return normDeg(
    ringAngleDeg + slot * spec.slotWidthDeg + 2 + spec.targetArcDeg / 2,
  );
}

/** The slot geometry {@link slotArcCenterDeg} reads, from `specs/rings.md`. */
const RING_TABLES = [
  { slotWidthDeg: 30, targetArcDeg: 26 },
  { slotWidthDeg: 22.5, targetArcDeg: 18.5 },
  { slotWidthDeg: 18, targetArcDeg: 14 },
] as const;

/* -------------------------------------------------------------------------- */
/* What the build owes                                                        */
/* -------------------------------------------------------------------------- */

/**
 * What the build owes when its surface is missing: the `Expected:` line of the
 * failure every check that reaches for the surface lands on.
 *
 * The case's own sentence rather than the package's, because how the surface
 * gets to the engine is phrased differently by the two state models, and a
 * fault that misdescribed the return would send a reviewer to the wrong line of
 * the build.
 */
const SURFACE_REQUIREMENT =
  "the debug surface src/game.ts's instance returns from initialize, which " +
  "the engine hands back from engine.debug (specs/instrumentation.md)";

/** Fail the running check because the build's surface is not what it must be. */
export function failSurface(fault: string): never {
  return fail(SURFACE_REQUIREMENT, fault);
}

/* -------------------------------------------------------------------------- */
/* Serving the produced tree to the engine's loader                           */
/* -------------------------------------------------------------------------- */
//
// `specs/assets.md` has the build load every produced sprite and sound through
// the engine, which resolves each path under `assets/` relative to the page
// the build is served from and fetches it. This project runs in a Node process
// with no page, so the two globals the loader reaches for are stood up over
// the workspace's own `assets/` directory, once, for the life of the process.
//
// AUDIO IS THE ONE THING THIS CANNOT SERVE, and that is why no `AudioContext`
// is installed at all. `loadAudio` decodes through a Web Audio context and this
// host has none, so every cue's produced `.wav` fails to decode here — a fact
// about the host rather than about the build. So the cue points read WHICH cue
// sounded off the cue bus, and the points that are about the FILES read them off
// disk directly, which is where they live. The package splits the asset host and
// the audio host into two modules for exactly this: a case that wants the first
// and not the second says so by calling one of them.

/**
 * The directory this harness sits in, which is the validator project's root.
 * Taken from this module's own URL so it names the same directory in both
 * layouts this file lives in: the case's own `validation/structured-2d/`, and
 * the `validation/` the runner stages that directory to in the build's tree. It
 * must never come from the package's own module, which is staged one directory
 * deeper.
 */
const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

/** The build's workspace, which is where `assets/` and `src/` sit. */
export const WORKSPACE = resolve(PROJECT_ROOT, "..");

/**
 * The transport the engine's loader reaches for, over the workspace on disk.
 *
 * ONE ROOT, the repository root itself: `specs/assets.md` puts every produced
 * file under `assets/` at the root and the loader asks for `assets/<path>`, so
 * nothing here should ever answer out of a staged copy. `onMissing` is left at
 * the package's `"404"` — the honest answer a served page gives, and what makes
 * the engine announce `asset:failed` with a status, which is what
 * `assetFailures` reports and what the produced-file points read.
 *
 * `images` shims `createImageBitmap` and names the decoded type `ImageBitmap`,
 * which is what lets a produced sprite reach a recording as its pixels rather
 * than as an opaque marker — and what makes `AssetHost.sourceOf` able to say
 * which produced file a drawn bitmap came from.
 *
 * ONE DIFFERENCE FROM THE SHIM THIS REPLACES, AND IT DECIDES NOTHING. The old
 * shim handed a ROOT-RELATIVE URL (`/assets/x.png`) to the platform's own fetch;
 * the shared host treats a leading `/` as the root of the served tree, exactly as
 * a static server does, and answers it out of the workspace. The point that
 * cares — `assets/asset-urls-page-relative` — is decided off the REQUEST LOG,
 * rejecting any URL carrying a scheme or a leading slash whether or not it was
 * answered, so a build that constructed one is still named.
 */
const assets = installAssetHost({
  workspaceRoot: WORKSPACE,
  roots: ["."],
  images: true,
  label: "kessler",
});

/**
 * The produced file a drawn source came from, or `""` for one this harness
 * never served — so a build that drew a canvas it painted itself is reported
 * as having drawn something other than the produced file rather than nothing.
 */
export function sourceId(source: unknown): string {
  if (source === null || typeof source !== "object") return "";
  return assets.sourceOf(source) ?? "";
}

/* -------------------------------------------------------------------------- */
/* Readings taken off one frame's render                                      */
/* -------------------------------------------------------------------------- */

/**
 * One bitmap the build blitted. `id` is the produced file the bytes were
 * served from, as the engine resolved it under the asset root — so
 * `assets/sprites/planet.png` — and `""` names a source this harness never
 * served (a canvas or image the build made for itself). The rectangle is the
 * axis-aligned box of the destination in DEVICE pixels, mapped through the
 * transform in force at the call, so `x + w / 2, y + h / 2` is its center
 * under any transform the build drew under.
 *
 * NO `smoothing` MEMBER, WHERE THE ENGINELESS PROJECT'S BLIT CARRIES ONE. That
 * reading came off the real context at the moment of the call, which the shared
 * recorder does not take: it records the property SET, and a build that sets the
 * flag once when it builds its context never sets it inside a frame at all. No
 * point in this project reads it, so it is dropped rather than answered with a
 * default that would look like a reading.
 */
export interface Blit {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What one frame's render issued: its operations, and its bitmap blits. */
export interface FrameDraw {
  calls: DrawCall[];
  blits: Blit[];
}

/**
 * One run of text a frame drew, and where it drew it in device pixels.
 *
 * The package's placed reading plus the two members this case's HUD suites read
 * it through: the run's measured extent as a WIDTH, and the alignment that
 * places that width about the anchor. Both are what the package answers as
 * `left`/`right`/`align`; carrying them under this case's names is what keeps
 * `hud/hud-clear-of-field` reading what it was written to read.
 */
export interface TextDraw extends PlacedText {
  /** The run's measured width, under the same scale the anchor took. */
  width: number;
  /** The alignment that places the run about its anchor. */
  textAlign: string;
}

/** Every run of text the frame drew, with its anchor in device pixels. */
export function textDraws(calls: readonly DrawCall[]): TextDraw[] {
  return placedText(calls).map((draw) => ({
    ...draw,
    width: draw.right - draw.left,
    textAlign: draw.align ?? DEFAULT_TEXT_ALIGN,
  }));
}

/**
 * Every bitmap the recorded calls blitted, as axis-aligned boxes in device
 * pixels: the four corners of each destination rectangle are mapped through
 * the transform in force at the call and the box is taken around them.
 *
 * THE BOX, NOT THE PACKAGE'S `imageDraws`. That reading answers the destination
 * as the two corners a transform carried, which is the same CENTRE and a
 * different `dw`/`dh` under any rotation — and `presentation/sprites-drawn-at-
 * native-size` asserts on exactly those two numbers. So the identity and the
 * transform walk come from the package and the box is taken here.
 */
export function blitsOf(calls: readonly DrawCall[]): Blit[] {
  const blits: Blit[] = [];
  const stack: Matrix[] = [];
  let current: Matrix = IDENTITY;
  for (const call of calls) {
    if (call.kind !== "call") continue;
    const { method, args } = call;
    if (method === "save") {
      stack.push(current);
      continue;
    }
    if (method === "restore") {
      current = stack.pop() ?? IDENTITY;
      continue;
    }
    const moved = transformed(current, method, args);
    if (moved !== null) {
      current = moved;
      continue;
    }
    if (method !== "drawImage") continue;
    const box = destinationOf(args);
    if (box === null) continue;
    const corners = [
      apply(current, box.x, box.y),
      apply(current, box.x + box.w, box.y),
      apply(current, box.x, box.y + box.h),
      apply(current, box.x + box.w, box.y + box.h),
    ];
    const xs = corners.map((corner) => corner.x);
    const ys = corners.map((corner) => corner.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    blits.push({
      id: sourceOfCall(args[0]),
      x,
      y,
      w: Math.max(...xs) - x,
      h: Math.max(...ys) - y,
    });
  }
  return blits;
}

/**
 * The produced file a recorded `drawImage` argument names.
 *
 * The recorder INTERNS a drawn bitmap, so what the record carries is an
 * `ImageRef` naming it rather than the source itself; the real bitmap is kept
 * beside the recorder and the asset host remembers which produced file each
 * decoded bitmap was fetched from. Those two together are the identity — never
 * a path matched out of the call's arguments, since a build resolves its
 * produced files through the bundler.
 */
function sourceOfCall(argument: unknown): string {
  const ref = (argument as { $src?: { id?: unknown } } | null)?.$src;
  if (ref === undefined || typeof ref.id !== "number") return "";
  const source = drawnSources.get(ref.id);
  return source === undefined ? "" : sourceId(source);
}

/**
 * Every bitmap the recorder has interned in this worker, by the id it names it
 * under. Filled from each harness as it draws — the ids are worker-wide, so one
 * table serves every harness a suite opens.
 */
const drawnSources = new Map<number, object>();

/**
 * The destination rectangle of a `drawImage` call, in the space it was issued
 * in, or `null` for a call whose arguments are not one of the three forms. A
 * two-argument placement takes its size from the source, which the interned
 * reference carries.
 */
function destinationOf(args: unknown[]): {
  x: number;
  y: number;
  w: number;
  h: number;
} | null {
  const source = args[0];
  const numbers = args.slice(1);
  if (!numbers.every((value) => typeof value === "number")) return null;
  const at = numbers as number[];
  if (at.length === 8) return { x: at[4], y: at[5], w: at[6], h: at[7] };
  if (at.length === 4) return { x: at[0], y: at[1], w: at[2], h: at[3] };
  if (at.length === 2) {
    const ref = (source as { $src?: { width?: unknown; height?: unknown } })
      ?.$src;
    const w = typeof ref?.width === "number" ? ref.width : 0;
    const h = typeof ref?.height === "number" ? ref.height : 0;
    return { x: at[0], y: at[1], w, h };
  }
  return null;
}

/** Where a blit's center landed, in device pixels. */
export function blitCenter(blit: Blit): { x: number; y: number } {
  return { x: blit.x + blit.w / 2, y: blit.y + blit.h / 2 };
}

/**
 * Every blit whose center landed within `tolerance` device pixels of the
 * logical stage point `(x, y)` — how a sprite is attributed to the object it
 * was drawn on, since `specs/assets.md` centers each sprite on its object.
 */
export function blitsNear(
  h: Harness,
  blits: readonly Blit[],
  x: number,
  y: number,
  tolerance: number,
): Blit[] {
  const at = h.device(x, y);
  return blits.filter((blit) => {
    const center = blitCenter(blit);
    return Math.hypot(center.x - at.x, center.y - at.y) <= tolerance;
  });
}

/* -------------------------------------------------------------------------- */
/* Colour                                                                     */
/* -------------------------------------------------------------------------- */
//
// ONE PIXEL, NOT A CLUSTER. The package's `sampleColor` means the mean of a
// five-point cluster; Kessler's readings are of a single device pixel, and every
// threshold in this project's visibility and presentation suites was measured
// against that. So these keep the case's own names and the case's own meaning.

/** The colour rendered at the logical stage point `(x, y)`. */
export function sampleAt(h: Harness, x: number, y: number): Rgb {
  const [r, g, b] = h.pixel(x, y);
  return { r, g, b };
}

/** The colour rendered at radius `r`, angle `thetaDeg`. */
export function samplePolar(h: Harness, r: number, thetaDeg: number): Rgb {
  const [red, green, blue] = h.pixelPolar(r, thetaDeg);
  return { r: red, g: green, b: blue };
}

/* -------------------------------------------------------------------------- */
/* The harness                                                                */
/* -------------------------------------------------------------------------- */

/** How a window is asked for. The clock is what a subdivision check varies. */
export type HarnessOptions = EngineHarnessOptions;

export interface Harness {
  readonly engine: KesslerEngine;
  /**
   * The target the engine reads input off: where a key event and a pointer
   * event are dispatched, as the engine's validator pages describe.
   */
  readonly keys: EventTarget;
  /**
   * The world currently open, read fresh on every access. Kessler runs in ONE
   * level for the whole session (`specs/overview.md`), so this world lives as
   * long as the engine — but it is the engine's live object, so anything that
   * has to survive a later frame is copied rather than kept.
   */
  readonly world: World;
  /** The open world's game state. Its arrangement is the build's; a check reads
   * {@link Harness.snapshot} for anything the specification states. */
  readonly state: GameState;
  /** The game instance, the one framework object that outlives every level. */
  readonly instance: GameInstance<KesslerSurface>;
  /**
   * The debug surface the BUILD's instance returned from `initialize`, read
   * off `engine.debug` and driven directly: each operation acts on the live
   * world at the moment of the call.
   */
  readonly debug: KesslerDebugApi;
  /** The real 2D context, for `getImageData`. Draw calls also reach it. */
  readonly ctx: SKRSContext2D;
  /** The surface the engine drew into, holding the last frame that ran. */
  readonly canvas: Canvas;
  /** Every call and property set the render has made since the last clear. */
  readonly calls: DrawCall[];
  /** Every cue the build played since the harness opened, oldest first. */
  readonly cues: TimedCue[];
  /** Every asset the build failed to load, oldest first. */
  readonly assetFailures: AssetFailure[];

  /** Whether the build has the cue `name` looping at this moment. */
  looping(name: string): boolean;

  /** Frames run since the engine started. */
  frame(): number;
  /** The simulated time those frames covered, in milliseconds. */
  timeMs(): number;

  /** A fresh read of the game's state through the case's `snapshot`. */
  snapshot(): KesslerSnapshot;
  /**
   * `debug.reset`, with the seed spelled as a plain argument: the boot state,
   * on `title`, both driver switches on, the pod generator seeded with `seed`
   * (`DEFAULT_SEED` when omitted).
   */
  reset(seed?: number): void;
  /** Run `frames` frames of the harness's clock, back to back. */
  advance(frames: number): Promise<void>;
  /** Run `ticks` whole ticks of simulation time, and read what they left. */
  tick(ticks?: number): Promise<KesslerSnapshot>;
  /** Drive a tick at a time until `predicate` holds, or the budget is spent. */
  until(
    predicate: (snapshot: KesslerSnapshot) => boolean,
    options?: UntilOptions,
  ): Promise<UntilResult>;

  /** Press a key and leave it down, as a player holding it would. */
  holdKey(code: string): void;
  /** Release a key held by {@link Harness.holdKey}. */
  releaseKey(code: string): void;
  /** Dispatch a real pointer event at a logical stage point. */
  pointer(
    type: "pointerdown" | "pointermove" | "pointerup",
    x: number,
    y: number,
    device: "mouse" | "touch",
  ): void;

  /** Forget every call recorded so far, so the next frame stands alone. */
  clearCalls(): void;
  /** Run exactly one frame and hand back everything its render issued. */
  frameDraw(): Promise<FrameDraw>;
  /** Run exactly one frame and hand back the operations its render issued. */
  frameCalls(): Promise<DrawCall[]>;
  /** Run exactly one frame and hand back the bitmaps it blitted. */
  frameBlits(): Promise<Blit[]>;

  /** How the stage is mapped onto this harness's canvas. */
  viewport(): Viewport;
  /** Where a logical point lands in the canvas's backing store. */
  device(x: number, y: number): { x: number; y: number };
  /** The device pixel under a logical point, as `[r, g, b, a]`. */
  pixel(x: number, y: number): [number, number, number, number];
  /** The device pixel at radius `r`, angle `thetaDeg`, as `[r, g, b, a]`. */
  pixelPolar(r: number, thetaDeg: number): [number, number, number, number];

  /** Close the world, halt the loop, and drop the engine's listeners. */
  dispose(): void;
}

/**
 * The cues each engine's bus is running as loops, tracked from before the game
 * was initialized.
 *
 * Kept per ENGINE and subscribed inside `createEngine` below, because a build is
 * free to start its title bed from `initialize` — and the kit takes its own cue
 * subscriptions at the same moment for the same reason. A set built after the
 * harness came back would miss the bed the build opened on.
 */
const runningLoops = new WeakMap<object, Set<string>>();

/**
 * The package's engine machinery, bound to Kessler on this engine.
 *
 * The recorder is asked for both extras, and each pays for itself:
 * `measureText` is what gives a text draw the extent `hud/hud-clear-of-field`
 * holds the HUD clear of the field by, and the width the package's merge rule
 * coalesces a letter-spaced heading by, which is what the package's
 * `drewText` reads copy off; `internImages` is what gives a `drawImage` an
 * identity {@link sourceId} can turn into the produced file it painted — the
 * reading every produced-sprite point in this project is decided on.
 *
 * `cueEvents` names BOTH firings, because `specs/assets.md` gives this case two
 * music beds beside its thirteen one-shot cues and a bed is announced as a loop;
 * `TimedCue.looped` tells the two apart afterwards.
 *
 * `toLogical` goes through the WORLD'S CAMERA, which is the one thing this
 * engine puts between a stage point and the canvas. Kessler leaves the camera at
 * rest (`specs/overview.md`), so world and logical coordinates coincide; mapping
 * through it anyway keeps the reading honest against a build that moved it.
 *
 * `pointerPrecision: "exact"` maps a logical point straight through the fit, so
 * a pointer lands exactly where the check asked — which is where this project's
 * pointer readings were taken.
 */
const kit = createEngineCaseHarness<
  KesslerSnapshot,
  KesslerDebugApi,
  KesslerEngine
>({
  slug: "kessler",
  projectRoot: PROJECT_ROOT,
  stage: { width: STAGE_W, height: STAGE_H },
  tickHz: TICK_HZ,
  surfaceRequirement: SURFACE_REQUIREMENT,
  recorder: { measureText: true, internImages: true },
  cueEvents: ["cue:played", "cue:looped"],
  defaultClock: () => new ConstantClock(TICK_MS),
  createEngine: ({ canvas, clock, surface }) => {
    const engine = createEngine<KesslerSurface>({
      canvas,
      width: STAGE_W,
      height: STAGE_H,
      game,
      // The build's own stage background, handed to the engine exactly as the
      // seeded `src/main.ts` hands it (specs/overview.md).
      background: BACKGROUND,
      clock: clock as Clock,
      surface: surface as SurfaceMetrics,
    });
    const loops = new Set<string>();
    runningLoops.set(engine, loops);
    const events = (engine as unknown as DrivenEngine).events;
    events.on("cue:looped", ({ cue }) => loops.add(cue));
    events.on("cue:stopped", ({ cue }) => loops.delete(cue));
    return engine;
  },
  driver: (_engine, raw) => identityDriver(raw as KesslerDebugApi),
  snapshot: (debug) => debug.snapshot(),
  toLogical: (engine, x, y) => engine.world.camera.worldToLogical({ x, y }),
  pointerPrecision: "exact",
  // The pointer event this case has always dispatched: a position and the DEVICE
  // it came from, and no button mask at all. Neither of the package's two is it
  // — `PointerPositionEvent` names no device, and `specs/controls.md`'s pointer
  // table separates a touch contact from a mouse press, so a check that could not
  // say which it was would decide the wrong point; `DevicePointerEvent` also
  // states `button`/`buttons`, which this engine's input reads and this case's
  // readings were never taken under.
  pointerEvent: (type, clientX, clientY, device) =>
    Object.assign(new Event(type), {
      clientX,
      clientY,
      isPrimary: true,
      pointerType: device ?? "mouse",
    }),
});

/**
 * Record the frames `act` draws and keep them as the review item's `outputId`
 * output, handing back whatever the scenario returned.
 *
 * Wrap the drive, not the arrangement:
 *
 * ```ts
 * const after = await captureReplay(h, "bounce", () => h.tick(30));
 * assertEqual(after.balls.length, 1);
 * ```
 *
 * The assertions stay exactly where they were and read exactly what they did:
 * capture sits BESIDE them, and a scenario that failed still leaves its
 * evidence behind.
 */
export const captureReplay = makeReplayCapture("kessler", PROJECT_ROOT);

/**
 * Keep the frame currently on the canvas as the review item's `outputId`
 * output — the companion to {@link captureReplay}, for a point whose evidence
 * is one PICTURE: which screen the game opened on, what it drew a pod as.
 *
 * What is written is whatever the last frame that RAN left behind, so call it
 * after the frame that poses the thing under test — a `frameDraw()` or an
 * `advance(1)` following the arrangement — and before the assertions, so a
 * check that fails still leaves the picture that shows why. Nothing here can
 * change a verdict.
 */
export function captureStill(h: Harness, outputId: string): void {
  kit.captureStill(
    h as unknown as EngineHarness<
      KesslerSnapshot,
      KesslerDebugApi,
      KesslerEngine
    >,
    outputId,
  );
}

/**
 * Build an engine over a canvas of the harness's own, initialize the build's
 * game, and hand back everything a check reads.
 *
 * NAMED `openHarness` RATHER THAN ALIASING THE KIT'S `createHarness`, and a
 * WRAPPER rather than the kit's `extend`, for one reason: this project's
 * vocabulary is `h.tick(n)` for a drive, where the kit's harness spells a drive
 * `advance(n)` and spells a COUNTER `tick()`. Folding the two would leave
 * `h.tick` meaning two things at once across a hundred and seventy-four call
 * sites. So the kit's harness is the machinery underneath, and what a check
 * holds is this case's own shape over it.
 */
export async function openHarness(
  options: HarnessOptions = {},
): Promise<Harness> {
  const base = await kit.createHarness(options);
  const engine = base.engine;
  const calls = base.calls;
  const loops = runningLoops.get(engine) ?? new Set<string>();
  for (const [id, source] of base.images) drawnSources.set(id, source);

  const harness: Harness = {
    engine,
    keys: base.events,
    get world() {
      return engine.world;
    },
    get state() {
      return engine.world.state;
    },
    get instance() {
      return engine.instance;
    },
    debug: base.debug,
    ctx: base.ctx,
    canvas: base.canvas,
    calls,
    cues: base.cues,
    assetFailures: base.assetFailures,

    looping: (name) => loops.has(name),

    frame: () => base.frame(),
    timeMs: () => base.timeMs(),

    snapshot: () => base.snapshot(),
    reset: (seed) => base.debug.reset(seed),

    advance: (frames) => base.advance(frames),

    async tick(ticks = 1) {
      await base.advance(ticks * FRAMES_PER_TICK);
      return base.snapshot();
    },

    until: (predicate, untilOptions) => base.until(predicate, untilOptions),

    holdKey: (code) => base.hold(code),
    releaseKey: (code) => base.release(code),
    pointer: (type, x, y, device) => base.pointer(type, x, y, device),

    clearCalls: () => {
      calls.length = 0;
    },
    async frameDraw() {
      calls.length = 0;
      await base.advance(1);
      // The interned ids are minted as a frame draws, so the table is caught up
      // here rather than only when the harness was built.
      for (const [id, source] of base.images) drawnSources.set(id, source);
      return { calls: [...calls], blits: blitsOf(calls) };
    },
    async frameCalls() {
      return (await harness.frameDraw()).calls;
    },
    async frameBlits() {
      return (await harness.frameDraw()).blits;
    },

    viewport: () => base.viewport() as Viewport,
    device: (x, y) => base.device(x, y),
    pixel: (x, y) => base.pixel(x, y),
    pixelPolar(r, thetaDeg) {
      const { x, y } = polarToXy(r, thetaDeg);
      return base.pixel(x, y);
    },

    dispose: () => base.dispose(),
  };

  return harness;
}

/* -------------------------------------------------------------------------- */
/* The shared helper contract                                                 */
/* -------------------------------------------------------------------------- */
//
// The surface is ATOMIC by design — one field per operation — so every
// compound sequence lives here, spelled once, and the category suites stay
// near-identical across engines. Nothing below decides an outcome: each
// helper only arranges the world through the surface and runs real ticks.

/**
 * Run `n` whole ticks of simulation time and read what they left.
 *
 * Under this engine one frame is one tick (see The step schedule above), so
 * this is `engine.advance(n)` followed by a snapshot.
 */
export async function advanceTicks(
  h: Harness,
  n: number,
): Promise<KesslerSnapshot> {
  await h.advance(n * FRAMES_PER_TICK);
  return h.snapshot();
}

/**
 * Press a key, run the one frame that delivers its edge, and release it.
 *
 * An edge arms the moment the `keydown` is dispatched and the engine closes
 * the input frame after the frame renders, discarding whatever no controller
 * consumed — so a tap that ran no frame would never reach the game.
 * `specs/controls.md` makes every non-rotation action a press EDGE, so one tap
 * is one action however long the key is nominally down. The frame it runs
 * consumes one tick.
 *
 * A FREE FUNCTION, where the kit's harness carries a `tap` of its own. The two
 * are not the same gesture: the kit's presses and RELEASES the key before the
 * frame runs, and this one holds it across the frame, which is the shape this
 * case's controls suites were written against.
 */
export async function tap(h: Harness, code: string): Promise<void> {
  h.holdKey(code);
  await h.advance(1);
  h.releaseKey(code);
}

/**
 * Hold a key down for `ticks` whole ticks of real frames, then release it.
 *
 * How the two rotation actions are driven: `specs/controls.md` reads `left`
 * and `right` as held values, and `specs/deflector-and-ball.md` moves the
 * deflector `270` degrees per second while one is held — so `hold` for `n`
 * ticks moves it `270 * n / 60` degrees.
 */
export async function hold(
  h: Harness,
  code: string,
  ticks: number,
): Promise<KesslerSnapshot> {
  h.holdKey(code);
  try {
    await h.advance(ticks * FRAMES_PER_TICK);
  } finally {
    h.releaseKey(code);
  }
  return h.snapshot();
}

/**
 * Pose an ISOLATED world: a fresh `playing` screen holding no target, no
 * ball, and no pod, with both driver switches off.
 *
 * The arrangement the authoring guide requires of a validator — clear every
 * entity the requirement is not about, then spawn back exactly what it IS
 * about through the surface's atomic poses. The switches are off so neither
 * autonomous consequence (the clearing event, the pod draw) arrives on top of
 * the behavior being watched; a check that is ABOUT one turns it back on with
 * `h.debug.setWaveAdvance(true)` / `setPodSpawn(true)`.
 *
 * `reset` first, so nothing a previous section left is inherited, seeding the
 * pod generator with `seed` when one is named; then the fresh session
 * (`setScreen("playing")` starts one exactly as confirming START does); then
 * the clears, which score nothing, draw nothing, and sound nothing.
 */
export function isolate(h: Harness, seed?: number): KesslerSnapshot {
  h.reset(seed);
  h.debug.setScreen("playing");
  h.debug.clearTargets();
  h.debug.clearBalls();
  h.debug.clearPods();
  h.debug.setWaveAdvance(false);
  h.debug.setPodSpawn(false);
  return h.snapshot();
}

/**
 * Reach the `playing` screen the way a player does: reset to the title and
 * confirm START with a real key.
 *
 * The REAL path, for the checks that are about the flow into play; a check
 * about anything else poses its screen with {@link poseScene} or
 * {@link isolate} and never touches a menu — a build with a broken title and
 * a working tick must fail the navigation points and pass the others. The
 * entering session has wave 1 laid out and a ball parked on the deflector.
 */
export async function startPlay(
  h: Harness,
  seed?: number,
): Promise<KesslerSnapshot> {
  h.reset(seed);
  // Entry 0 of the title menu is START (specs/screens.md), highlighted on
  // entry, and Enter carries `confirm` (specs/controls.md).
  await tap(h, "Enter");
  return h.snapshot();
}

/**
 * Enter screen `screen` through the surface, exactly as the real transition
 * enters it, and read what it left.
 *
 * A thin name over `debug.setScreen` so a suite says which screen it is
 * posing; it deliberately does NOT reset first, so a check can arrange a
 * session (score, wave, lives) and then pose the screen that shows it. A
 * check that wants a clean slate calls `h.reset()` first or uses
 * {@link isolate}.
 */
export function poseScene(h: Harness, screen: Screen): KesslerSnapshot {
  h.debug.setScreen(screen);
  return h.snapshot();
}

/**
 * Spawn one unparked ball by its polar figures: at radius `r`, angle
 * `thetaDeg`, moving with radial speed `vr` (positive outward) and
 * tangential speed `vt` (positive toward `+theta`).
 *
 * The spelling nearly every contact scenario wants, since every contact in
 * `specs/field.md` is a radius crossing. Pure arithmetic over
 * `debug.spawnBall`; the cap rule is the surface's own.
 */
export function spawnBallPolar(
  h: Harness,
  r: number,
  thetaDeg: number,
  vr: number,
  vt = 0,
): void {
  const { x, y } = polarToXy(r, thetaDeg);
  const { vx, vy } = polarVelocity(thetaDeg, vr, vt);
  h.debug.spawnBall(x, y, vx, vy);
}

/** Spawn one pod by its polar position. It falls radially inward on its own. */
export function spawnPodPolar(
  h: Harness,
  kind: PodKind,
  r: number,
  thetaDeg: number,
): void {
  const { x, y } = polarToXy(r, thetaDeg);
  h.debug.spawnPod(kind, x, y);
}

/** The polar reading of one snapshot ball or pod. */
export function polarOf(body: { x: number; y: number }): {
  r: number;
  thetaDeg: number;
} {
  return xyToPolar(body.x, body.y);
}

/** The count of live targets across all three rings. */
export function targetCount(snapshot: KesslerSnapshot): number {
  return snapshot.rings.reduce((sum, ring) => sum + ring.targets.length, 0);
}

/**
 * Start a fresh session the way confirming START starts one, out of atomic
 * poses: the reset lays wave 1 — score `0`, `3` lives, wave `1`, every slot
 * filled, every ring angle at `0`, the wave-1 figures in force, the deflector
 * at angle `90` with its baseline span — `setScreen("playing")` puts the game
 * on the live field, and `parkBall` puts the serve on the deflector.
 *
 * `setScreen` sets the screen and nothing else, so the arrangement is this
 * sequence rather than the call: the authoring guide puts every compound
 * sequence in the harness, and this is the one every check that needs a
 * session in play shares. `seed` seeds the pod generator.
 */
export function startFreshSession(h: Harness, seed?: number): KesslerSnapshot {
  h.reset(seed);
  h.debug.setScreen("playing");
  h.debug.parkBall();
  return h.snapshot();
}

/**
 * Enter the interstitial the way the clearing event enters it, out of atomic
 * poses: every ball, every pod, every timed effect and the shield are removed,
 * the interstitial timer is set to the `180` ticks `specs/screens.md` fixes,
 * and the screen becomes `waveclear`.
 *
 * The wave the interstitial is running out belongs to the caller: it poses
 * `setWave` and the ring state it wants before calling this.
 */
export function poseInterstitial(
  h: Harness,
  ticks: number = WAVECLEAR_TICKS,
): KesslerSnapshot {
  h.debug.clearBalls();
  h.debug.clearPods();
  for (const kind of ["widen", "narrow", "pierce"] as const) {
    h.debug.setEffectTicks(kind, 0);
  }
  h.debug.setShield(false);
  h.debug.setInterstitialTicks(ticks);
  h.debug.setScreen("waveclear");
  return h.snapshot();
}

/**
 * Stand on the menu-bearing screen `screen` with entry `index` highlighted,
 * through the two poses that say exactly that and nothing else.
 *
 * The route for every check whose requirement is what `confirm` does to an
 * entry rather than how the highlight got there: walking to the entry with the
 * `down` key would fail the check on a build whose only fault is its `down`
 * key, which is a defect `controls/arrow-down-moves-highlight` already decides.
 */
export function poseMenu(
  h: Harness,
  screen: Screen,
  index: number,
): KesslerSnapshot {
  h.debug.setScreen(screen);
  h.debug.setMenuIndex(index);
  return h.snapshot();
}

/**
 * The hit region the build reports for menu entry `index` on the screen it is
 * standing on, or `null` where there is no such entry.
 *
 * The layout is the build's — `specs/screens.md` fixes no position for a menu —
 * so a check that drives the pointer at an entry asks the build where it drew
 * it, exactly as `specs/instrumentation.md` has it report.
 */
export function menuRect(h: Harness, index: number): MenuItemRect | null {
  return h.debug.menuItemRect(index);
}

/**
 * The middle of a reported hit region, which is where a press aims.
 *
 * Kessler's own, not the package's `rectCenter`: a `MenuItemRect` reports
 * `width`/`height`, where the package's `Rect` carries `w`/`h`.
 */
export function rectCenter(rect: MenuItemRect): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/* -------------------------------------------------------------------------- */
/* Reading an action for oneself                                              */
/* -------------------------------------------------------------------------- */

/**
 * A player controller of the check's own, which reads the frame's actions and
 * does nothing with them.
 *
 * Input reaches the simulation through `PlayerController.input` alone, and
 * each player controller consumes edges INDEPENDENTLY — so a check that
 * reached into `h.world.players()[0].input` would eat the copy the BUILD's
 * own controller was about to read. The observer is built from the engine's
 * own base class, whose `tick` does nothing, so nothing is acted on twice.
 * Read it BETWEEN the press and the frame that delivers it:
 *
 * ```ts
 * const observer = addObserver(h);
 * h.holdKey("KeyP");
 * const seen = observer.input.pressed("pause"); // the observer's own copy
 * await h.advance(1);                           // the build reads its copy
 * h.releaseKey("KeyP");
 * ```
 */
export function addObserver(h: Harness): PlayerController {
  return h.world.mode.addPlayer({
    name: "observer",
    // Possessing nothing, so nothing is spawned into the world the check posed.
    pawn: null,
    controller: PlayerController,
  });
}

/* -------------------------------------------------------------------------- */
/* Cues                                                                       */
/* -------------------------------------------------------------------------- */
//
// The build declares each cue by name and plays it by name, and the engine
// announces every play on its bus — so what a check reads is WHICH cue
// sounded, without a decoder. Audio belongs to the ticks
// (`specs/instrumentation.md`): a pose sounds nothing, so what a collector
// holds is exactly what the driven ticks caused.

/**
 * Record every cue the build plays from this call onward.
 *
 * A live array the harness pushes into: a check opens the collector after its
 * arrangement and reads it after the drive it is about, and what it holds is
 * exactly the cues that sounded during that drive and none of the ones that
 * sounded while the scene was being posed.
 */
export function onCue(h: Harness): TimedCue[] {
  return kit.watchCues(
    h as unknown as EngineHarness<
      KesslerSnapshot,
      KesslerDebugApi,
      KesslerEngine
    >,
  );
}

/**
 * Every recorded play of the cue `name`, in the order they sounded.
 *
 * Over a WATCH's own slice, where the package's `cuesNamed(h, name)` reads the
 * harness's whole log: an audio suite here takes two slices either side of the
 * event tick and asserts on each, so what it filters is the array rather than
 * the harness.
 */
export function cuesNamed(cues: readonly TimedCue[], name: string): TimedCue[] {
  return cues.filter((played) => played.cue === name);
}

/** Every recorded play that fell on frame `frame` of the drive. */
export function cuesOnFrame(
  cues: readonly TimedCue[],
  frame: number,
): TimedCue[] {
  return cues.filter((played) => played.frame === frame);
}

/* -------------------------------------------------------------------------- */
/* The pointer and the finger                                                 */
/* -------------------------------------------------------------------------- */
//
// The engine owns the pointer as it owns the keyboard, reading `clientX`,
// `clientY`, `isPrimary` and `pointerType` off events dispatched at the same
// target the keys go to. The harness pins the surface to the stage's own size
// at a device pixel ratio of `1`, so a logical stage point IS the client
// position an event carries.
//
// EACH PART OF A GESTURE RUNS ITS OWN FRAME, because the engine closes its
// input frame each time one runs: a press and a release delivered inside one
// frame would be one sample list rather than the two moments a build reads.

/** Move the pointer onto the logical stage point `(x, y)`, and run its frame. */
export async function pointerTo(
  h: Harness,
  x: number,
  y: number,
): Promise<void> {
  h.pointer("pointermove", x, y, "mouse");
  await h.advance(1);
}

/** Press the primary button where the pointer stands, and run its frame. */
export async function pointerDown(
  h: Harness,
  x: number,
  y: number,
): Promise<void> {
  h.pointer("pointerdown", x, y, "mouse");
  await h.advance(1);
}

/** Release the primary button where the pointer stands, and run its frame. */
export async function pointerUp(
  h: Harness,
  x: number,
  y: number,
): Promise<void> {
  h.pointer("pointerup", x, y, "mouse");
  await h.advance(1);
}

/** Land a touch contact on the logical stage point `(x, y)`, and run its frame. */
export async function touchDown(
  h: Harness,
  x: number,
  y: number,
): Promise<void> {
  h.pointer("pointerdown", x, y, "touch");
  await h.advance(1);
}

/** Lift the touch contact at `(x, y)`, and run its frame. */
export async function touchUp(h: Harness, x: number, y: number): Promise<void> {
  h.pointer("pointerup", x, y, "touch");
  await h.advance(1);
}

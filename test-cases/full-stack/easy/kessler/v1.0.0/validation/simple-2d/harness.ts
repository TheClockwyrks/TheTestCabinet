// Kessler — the case's half of the validator harness. CASE-PROVIDED.
//
// Every check in this project is an ordinary vitest test that runs IN THE SAME
// PROCESS as the build. It imports the engine and the build's own `src/game.ts`,
// creates an engine over a canvas it owns and a `ConstantClock` of `1000 / 60`
// milliseconds, and steps the game with `engine.advance` — so ONE FRAME CONSUMES
// EXACTLY ONE TICK, which is the pairing `specs/instrumentation.md` itself
// prescribes for a scenario. Nothing drives a browser, nothing polls, and no
// wall-clock time passes.
//
// THE MACHINERY THAT DOES THAT IS NOT KESSLER'S. The canvas and its draw-command
// recorder, the debug surface and the stand-in for a missing one, the driver that
// threads a PURE surface through `engine.apply`, the frame sweep, the key and
// pointer events, the cue stamping, the host that serves the build's own produced
// files to the engine's loader, and the evidence a review item's output is
// written from — every engine-backed case needs exactly that, and it lives once,
// in `@clockwyrks/case-harness`, staged beside this file as `./case-harness/`.
// What is left HERE is what is genuinely Kessler's: its types, the polar
// arithmetic every rule of the game is stated in, the blit reading its produced
// sprites are decided on, and every scenario helper that poses this game.
//
// WHAT A CHECK READS. The game's own state (through the case's `snapshot`), the
// engine's frame counter, the cue events it broadcast, the draw calls the render
// issued, and the pixels those calls left on the canvas. Nothing here fabricates
// an outcome: the scenario helpers below only ARRANGE the world through the
// debug surface, and per the spec "no pose decides an outcome: every bounce,
// hit, destruction, catch, burn-up, life loss, and clearing comes from the ticks
// run after the pose".
//
// WHY THE DEBUG SURFACE RATHER THAN RAW ASSIGNMENT. `specs/instrumentation.md`
// fixes its operations, so they mean the same thing in every build; posing
// through it is how a scenario is reproducible, and it is the seam the case's
// specification documents. `surface.ts` is that specification as types, and it
// is the only description of the surface this harness reads: the build's own
// module for it is never imported.
//
// WHERE THE SURFACE COMES FROM. Off `engine.debug`, never built here. The
// build's `initialize` returns it beside the state, as `[state, debug]`, the
// engine holds the second element, and reading it back off the engine is the
// only way a surface reaches a check — so a build that returned no surface, or
// a surface missing an operation, fails the checks that reach the game through
// it, at the moment a check first reaches for an operation.
//
// HOW THE SURFACE IS DRIVEN. The engine holds the state by value and hands it
// out read-only, so the surface is pure: a pose takes the current state and
// returns the next, a reading takes the current state and returns what it read.
// A check still writes `h.debug.setScore(500)` and `h.debug.menuItemRect(1)`,
// because `h.debug` is the package's {@link applyDriver} over the raw surface:
// it runs each pose through `engine.apply`, and hands each READING `engine.state`
// followed by whatever the check passed — which is what `menuItemRect(index)`
// needs, since a reading whose index was dropped would answer about entry zero.
//
// WHAT THE HARNESS OWNS THAT THE SURFACE MUST NOT. The surface is ATOMIC by
// design — one field per operation — so every compound sequence lives here:
// {@link isolate} (the empty posed field with both driver switches off),
// {@link startPlay} (the real, key-pressed path into a session), and the polar
// spawn helpers a scenario stages contacts with.

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Canvas, SKRSContext2D } from "@napi-rs/canvas";
import {
  ConstantClock,
  createEngine,
  type Clock,
  type Engine,
  type Game,
  type SurfaceMetrics,
  type Viewport,
} from "@clockwyrks/simple-2d";
import type { DeepReadonly } from "ts-essentials";
import {
  applyDriver,
  createEngineCaseHarness,
  installAssetHost,
  installAudioContext,
  wavAudioBuffer,
  type AssetFailure,
  type DrivenEngine,
  type EngineHarness,
  type EngineHarnessOptions,
  type PureDriver,
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
import { BACKGROUND, game as build, type KesslerState } from "../src/game";
import { fail } from "./assert";
import {
  STAGE_CX,
  STAGE_CY,
  STAGE_H,
  STAGE_W,
  TICK_HZ,
  WAVECLEAR_TICKS,
} from "./constants";
import {
  READINGS,
  type EffectKind,
  type KesslerDebugApi,
  type KesslerSnapshot,
  type MenuItemRect,
  type PodKind,
  type Screen,
} from "./surface";

export type { EffectKind, KesslerSnapshot, MenuItemRect, PodKind, Screen };

/* The readings the package already carries, under the names the suites say. */
export { colorDistance, drawnText };
export type { AssetFailure, DrawCall, Matrix, Rgb, TimedCue, UntilOptions };

/** What a sweep found: whether the predicate ever held, and where it stopped. */
export type UntilResult = BaseUntilResult<KesslerSnapshot>;

/** The case's surface, bound to the state type the build declared. */
export type KesslerSurface = KesslerDebugApi<KesslerState>;

/** The engine this project's checks run the build on. */
export type KesslerEngine = Engine<KesslerState, KesslerSurface>;

/**
 * The imperative reading of the pure surface: every member of the case's
 * surface, minus its state argument, over the engine that holds the state.
 */
export type KesslerDriver = PureDriver<
  DeepReadonly<KesslerState>,
  KesslerState,
  KesslerSurface
>;

/**
 * The build's game, typed against the surface the CASE specifies.
 *
 * The build declares its own type for the surface its `initialize` returns, and
 * that type is the build's: what a check holds it to is `surface.ts`, so the
 * game is cast to the case's `Game<KesslerState, KesslerSurface>` here and the
 * engine is parameterized with it. A surface that departs from the specification
 * is caught where a check reaches for the missing member, not by the build's
 * own compiler.
 */
const game = build as unknown as Game<KesslerState, KesslerSurface>;

/* -------------------------------------------------------------------------- */
/* The step schedule                                                          */
/* -------------------------------------------------------------------------- */
//
// One frame is one tick, on the spec's own advice: "a scenario pairs a
// ConstantClock of 1000 / 60 milliseconds with engine.advance, so one frame
// consumes exactly one tick" (specs/instrumentation.md). Every duration this
// case states is a whole count of ticks, so a check asks for that count of
// frames and no arithmetic sits between the two. A check that is ABOUT the
// subdivision of ticks into frames builds a harness with a clock of its own,
// which {@link EngineHarnessOptions.clock} is for.

/** One frame — one tick — of game time, in milliseconds. */
export const TICK_MS = 1000 / TICK_HZ;

/* -------------------------------------------------------------------------- */
/* Polar arithmetic, as specs/field.md fixes the conventions                  */
/* -------------------------------------------------------------------------- */
//
// The game is polar, and its rules speak in radii and degrees; a check speaks
// the same way and converts at the edge, with the mapping specs/overview.md
// fixes: `x = 500 + r cos(theta)`, `y = 500 + r sin(theta)`, angles in degrees,
// `0` along `+x`, increasing toward `+y`, normalized to `[0, 360)`.

/** Degrees to radians. */
const RAD = Math.PI / 180;

/** `deg` normalized into `[0, 360)`. */
export function normalizeDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/**
 * The signed wrap-aware angular offset from `fromDeg` to `toDeg`, in
 * `[-180, 180)` — the reading every span and arc membership rule compares by.
 */
export function angularOffset(fromDeg: number, toDeg: number): number {
  return ((((toDeg - fromDeg) % 360) + 540) % 360) - 180;
}

/** The stage point at radius `r` and angle `deg` about the stage center. */
export function polarToXy(r: number, deg: number): { x: number; y: number } {
  return {
    x: STAGE_CX + r * Math.cos(deg * RAD),
    y: STAGE_CY + r * Math.sin(deg * RAD),
  };
}

/** The polar reading of a stage point: its radius and its angle in [0, 360). */
export function xyToPolar(x: number, y: number): { r: number; deg: number } {
  const dx = x - STAGE_CX;
  const dy = y - STAGE_CY;
  return { r: Math.hypot(dx, dy), deg: normalizeDeg(Math.atan2(dy, dx) / RAD) };
}

/**
 * The velocity `(vx, vy)` at angle `deg` whose radial speed is `vr` (outward
 * positive) and tangential speed `vt` (toward `+theta` positive). The two axes
 * are specs/field.md's own `n` and `t` at that angle.
 */
export function polarVelocity(
  deg: number,
  vr: number,
  vt: number,
): { vx: number; vy: number } {
  const cos = Math.cos(deg * RAD);
  const sin = Math.sin(deg * RAD);
  return { vx: vr * cos - vt * sin, vy: vr * sin + vt * cos };
}

/**
 * The center angle of slot `slot`'s target arc on ring `ring` (1 to 3), with
 * the ring's angle at `ringAngleDeg` — where a posed ball must be aimed to meet
 * that target. specs/rings.md: slot `k` begins at the ring's angle plus `k`
 * slot widths, and the arc begins 2 degrees into the slot and spans the arc
 * width.
 */
export function targetArcCenterDeg(
  ring: number,
  slot: number,
  ringAngleDeg = 0,
): number {
  const spec = RING_TABLE[ring - 1];
  if (spec === undefined) throw new Error(`no ring ${ring}`);
  return normalizeDeg(
    ringAngleDeg + slot * spec.slotWidthDeg + 2 + spec.arcWidthDeg / 2,
  );
}

/** The slot/arc figures {@link targetArcCenterDeg} reads, from specs/rings.md. */
const RING_TABLE = [
  { slotWidthDeg: 30, arcWidthDeg: 26 },
  { slotWidthDeg: 22.5, arcWidthDeg: 18.5 },
  { slotWidthDeg: 18, arcWidthDeg: 14 },
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
  "the debug surface src/game.ts's initialize returns beside its state, as " +
  "[state, debug], which the engine hands back from engine.debug " +
  "(specs/instrumentation.md)";

/** Fail the running check because the build's surface is not what it must be. */
export function failSurface(fault: string): never {
  return fail(SURFACE_REQUIREMENT, fault);
}

/* -------------------------------------------------------------------------- */
/* Serving the produced tree to the engine's loader                           */
/* -------------------------------------------------------------------------- */
//
// `specs/assets.md` has the build load every produced sprite and sound through
// the engine, which resolves each path under `assets/` relative to the page the
// build is served from and fetches it. This project runs in a Node process with
// no page, so the harness supplies the three things a browser gives the loader:
// a `fetch` that reads the very file the build committed, a `createImageBitmap`
// that decodes one, and an `AudioContext` that decodes a produced PCM `.wav`
// far enough for `api.audio.load` to bind the cue.
//
// WHAT WOULD HAPPEN WITHOUT IT. Every produced file would fail to load, and
// every point about a produced sprite or a bound cue would fail every build
// ever written — a fact about Node rather than about the build. So every check
// this project runs gets the produced files, and `assetFailures` records the
// loads that failed for the checks that read that the tree arrived whole.

/**
 * The directory this harness sits in, which is the validator project's root.
 *
 * Taken from this module's own URL rather than from the working directory,
 * because it has to name the same directory in both layouts this file lives in:
 * the case's own `validation/<engine>/`, and the `validation/` the runner
 * stages that directory to inside the build's tree. It must never come from the
 * package's own module, which is staged one directory deeper.
 */
const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

/** The build's workspace, which is where `assets/` and `src/` sit. */
export const WORKSPACE = resolve(PROJECT_ROOT, "..");

/**
 * The transport the engine's loader reaches for, over the workspace on disk.
 *
 * `roots` is the repository root first, because `specs/assets.md` puts every
 * produced file under `assets/` at the root and the loader asks for
 * `assets/<path>`; `public/` and `dist/` follow so a build that staged its tree
 * for Vite is still loading its own committed files rather than nothing.
 *
 * `onMissing: "upstream"` hands a relative URL no root carries to the platform's
 * own `fetch`, which is what this harness has always done: Node then rejects the
 * relative URL, so the load fails with a parse error rather than with a status.
 * `images` shims `createImageBitmap` and names the decoded type `ImageBitmap`,
 * which is what lets a produced sprite reach a recording as its pixels rather
 * than as an opaque marker — and what makes {@link AssetHost.sourceOf} able to
 * say which produced file a drawn bitmap came from.
 */
const assets = installAssetHost({
  workspaceRoot: WORKSPACE,
  roots: [".", "public", "dist"],
  onMissing: "upstream",
  images: true,
  label: "kessler",
});

/**
 * An `AudioContext` that decodes a produced `.wav` and nothing else.
 *
 * `wavAudioBuffer` decodes the file to its SAMPLES — the half of the package's
 * pair that a case listening to a channel needs, as against `silentAudioBuffer`,
 * which reads the header alone. This project's `assets/` suites read a produced
 * bed's own samples for their loop seam, so a decoder that answered silence
 * would read zero off every channel with nothing to say so.
 */
installAudioContext({ decode: wavAudioBuffer });

/**
 * The produced file a drawn source came from, or `""` for one this harness
 * never served — a canvas the build painted itself, reported as having drawn
 * something other than the produced file rather than as having drawn nothing.
 */
export function sourceId(source: unknown): string {
  if (source === null || typeof source !== "object") return "";
  return assets.sourceOf(source) ?? "";
}

/* -------------------------------------------------------------------------- */
/* Readings taken off one frame's render                                      */
/* -------------------------------------------------------------------------- */

/**
 * One bitmap the build blitted.
 *
 * `id` is the source's identity: the path the bitmap's bytes were served from,
 * as the engine resolved it under the asset root — `assets/sprites/planet.png`
 * — so two blits carry the same one exactly when they painted the same produced
 * file. `""` names a source this harness never served, which is a canvas or an
 * image the build made for itself. The rectangle is in DEVICE pixels, mapped
 * through the transform in force at the call, so `x + w / 2, y + h / 2` is its
 * center under any transform the build drew under.
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
 * Whether the frame drew `text` as part of some RAW run of text, ignoring case.
 *
 * Substring rather than equality on purpose: the copy a check asserts is the
 * case's own, but how a build presents it is the build's, and a menu entry is
 * commonly drawn with a selection marker or padding around it.
 *
 * KESSLER'S OWN, over the package's `drawnText`. The package ships a `drewText`
 * of its own and it is a different reading: it matches against the LOGICAL runs
 * a frame spells, which merges the glyphs of a letter-spaced heading into one
 * string. Kessler's copy points were all decided against the raw calls, so this
 * composes the package's raw reading rather than binding a name whose meaning
 * would be the other one.
 */
export function drewText(calls: readonly DrawCall[], text: string): boolean {
  const wanted = text.trim().toLowerCase();
  return drawnText(calls).some((drawn) => drawn.toLowerCase().includes(wanted));
}

/**
 * Every bitmap the recorded calls blitted, as axis-aligned boxes in device
 * pixels: the four corners of each destination rectangle mapped through the
 * transform in force at the call, and the box taken around them, so a sprite
 * drawn under a rotation still reports the square of the canvas it covered.
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
 * beside the recorder ({@link Harness.images}) and the asset host remembers
 * which produced file each decoded bitmap was fetched from. Those two together
 * are the identity — never a path matched out of the call's arguments, since a
 * build resolves its produced files through the bundler.
 */
function sourceOfCall(argument: unknown): string {
  const ref = (argument as { $src?: { id?: unknown } } | null)?.$src;
  if (ref === undefined || typeof ref.id !== "number") return "";
  const source = drawnSources.get(ref.id);
  return source === undefined ? "" : sourceId(source);
}

/**
 * Every bitmap the recorder has interned in this worker, by the id it names it
 * under. Filled from each harness as it is built — the ids are worker-wide, so
 * one table serves every harness a suite opens.
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
  if (at.length === 8) {
    return { x: at[4], y: at[5], w: at[6], h: at[7] };
  }
  if (at.length === 4) {
    return { x: at[0], y: at[1], w: at[2], h: at[3] };
  }
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
 * Every blit whose center landed within `within` logical units of the logical
 * point `(x, y)` — how a blit is attributed to the ball, pod, or planet it was
 * drawn on, since every produced sprite is drawn centered on its object
 * (specs/assets.md).
 */
export function blitsNear(
  h: Harness,
  blits: readonly Blit[],
  x: number,
  y: number,
  within: number,
): Blit[] {
  const view = h.viewport();
  const at = h.device(x, y);
  const limit = within * view.scale;
  return blits.filter((blit) => {
    const center = blitCenter(blit);
    return Math.hypot(center.x - at.x, center.y - at.y) <= limit;
  });
}

/**
 * The produced file painted nearest to and within `within` units of `(x, y)`,
 * or `null` when no blit landed there. The LAST such blit, because that is the
 * one a player sees.
 */
export function spriteNear(
  h: Harness,
  blits: readonly Blit[],
  x: number,
  y: number,
  within: number,
): string | null {
  const found = blitsNear(h, blits, x, y, within);
  return found.length === 0 ? null : found[found.length - 1].id;
}

/* -------------------------------------------------------------------------- */
/* Colour                                                                     */
/* -------------------------------------------------------------------------- */
//
// ONE PIXEL, NOT A CLUSTER. The package's `sampleColor` means the mean of a
// five-point cluster; Kessler's readings are of a single device pixel, and every
// threshold in this project's visibility and presentation suites was measured
// against that. So these keep the case's own names and the case's own meaning.

/** The colour rendered at the logical point `(x, y)`. */
export function samplePoint(h: Harness, x: number, y: number): Rgb {
  const [r, g, b] = h.pixel(x, y);
  return { r, g, b };
}

/** The colour rendered at radius `r` and angle `deg` about the stage center. */
export function samplePolar(h: Harness, r: number, deg: number): Rgb {
  const at = polarToXy(r, deg);
  return samplePoint(h, at.x, at.y);
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
  /** The engine's current state, read fresh on every access. */
  readonly state: DeepReadonly<KesslerState>;
  /**
   * The debug surface the BUILD returned beside its state, driven over the
   * engine: each pose runs through `engine.apply`, each reading is handed
   * `engine.state` followed by the check's own arguments.
   */
  readonly debug: KesslerDriver;
  /** The real 2D context, for `getImageData`. Draw calls also reach it. */
  readonly ctx: SKRSContext2D;
  /** The surface the engine drew into, holding the last frame that ran. */
  readonly canvas: Canvas;
  /** Every call and property set the render has made since the last clear. */
  readonly calls: DrawCall[];
  /** Every cue the build played, oldest first. */
  readonly cues: TimedCue[];
  /** Every asset the build failed to load, oldest first. */
  readonly assetFailures: AssetFailure[];

  /** Whether the build has the cue `name` looping at this moment. */
  looping(name: string): boolean;

  /** Frames run since the engine started. One frame is one tick. */
  frame(): number;
  /** The simulated time those frames covered, in milliseconds. */
  timeMs(): number;

  /** A fresh read of the game's state through the case's `snapshot`. */
  snapshot(): KesslerSnapshot;
  /** `debug.reset`, with `seed` seeding the pod generator when given. */
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

  /** Press a key (`KeyboardEvent.code`) and leave it down. */
  holdKey(code: string): void;
  /** Release a key held by {@link holdKey}. */
  releaseKey(code: string): void;
  /** Dispatch a real pointer event at a logical stage point. */
  pointer(
    type: "pointerdown" | "pointermove" | "pointerup",
    x: number,
    y: number,
    device: "mouse" | "touch",
  ): void;

  /** Forget every call recorded so far. */
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

  /** Drop the engine's listeners and release the canvas. */
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
 * holds the HUD clear of the field by, and `internImages` is what gives a
 * `drawImage` an identity {@link sourceId} can turn into the produced file it
 * painted — the reading every produced-sprite point in this project is decided
 * on.
 *
 * `cueEvents` names BOTH firings, because `specs/assets.md` gives this case two
 * music beds beside its thirteen one-shot cues and a bed is announced as a loop;
 * `TimedCue.looped` tells the two apart afterwards.
 *
 * `pointerPrecision: "exact"` maps a logical point straight through the fit. No
 * camera stands between the stage and the canvas under this engine, and every
 * check runs at the stage's own size, so the mapping is the identity and a
 * pointer lands exactly where the check asked — which is where this project's
 * pointer readings were taken.
 */
const kit = createEngineCaseHarness<
  KesslerSnapshot,
  KesslerDriver,
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
    const engine = createEngine<KesslerState, KesslerSurface>({
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
  driver: (engine, raw) =>
    applyDriver<DeepReadonly<KesslerState>, KesslerState, KesslerDriver>(
      engine,
      raw,
      { readings: READINGS },
    ),
  snapshot: (debug) => debug.snapshot(),
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
 * output — for a point whose evidence is one PICTURE rather than a stretch of
 * motion. Call it after the frame that poses the thing under test (a
 * `frameDraw()` or an `advance(1)` following the arrangement) and before the
 * assertions, so a check that fails still leaves the picture that shows why.
 */
export function captureStill(h: Harness, outputId: string): void {
  kit.captureStill(
    h as unknown as EngineHarness<
      KesslerSnapshot,
      KesslerDriver,
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
 * `h.tick` meaning two things at once across a hundred and seventy-five call
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
    get state() {
      return engine.state;
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
    reset: (seed) => {
      base.debug.reset(seed);
    },

    advance: (frames) => base.advance(frames),

    async tick(ticks = 1) {
      await base.advance(ticks);
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

    dispose: () => base.dispose(),
  };

  return harness;
}

/* -------------------------------------------------------------------------- */
/* Input, as a player's keys deliver it                                       */
/* -------------------------------------------------------------------------- */

/**
 * Press `code`, run the one frame that delivers its edge, and release it.
 *
 * The engine discards an edge nothing consumed by the end of the frame it was
 * armed in, so a tap that ran no frame would never reach the game. Every
 * non-rotation action in `specs/controls.md` is a press EDGE, so one tap is one
 * action. NOTE: under this harness the delivering frame is one whole tick.
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
 * Hold `code` down for `ticks` whole ticks, then release it.
 *
 * The held rotation actions read the key's value each frame, so the deflector
 * turns at its 270 degrees per second for exactly `ticks / 60` seconds of game
 * time. The release dispatches after the last held frame and delivers on the
 * next frame the caller runs.
 */
export async function hold(
  h: Harness,
  code: string,
  ticks: number,
): Promise<void> {
  h.holdKey(code);
  await h.advance(ticks);
  h.releaseKey(code);
}

/** Run `n` whole ticks of simulation time. One frame is one tick. */
export async function advanceTicks(h: Harness, n: number): Promise<void> {
  await h.advance(n);
}

/* -------------------------------------------------------------------------- */
/* Posing a world                                                             */
/* -------------------------------------------------------------------------- */
//
// The rule the authoring guide states is that a validator poses an ISOLATED
// world: it clears every entity the requirement is not about and spawns back
// exactly what it is about, and it holds still the consequences the
// requirement does not exercise. The surface carries the operations that make
// that possible — `clearTargets`, `clearBalls`, `clearPods`, and the two
// driver switches — and {@link isolate} is the one place they are all spoken
// in a single breath.

/**
 * Reset the game and pose an EMPTY playing field with both driver switches
 * off: no targets, no balls, no pods, `waveAdvance` and `podSpawn` disabled.
 *
 * The reset first, so nothing a previous section left is inherited; then a
 * fresh session through `setScreen("playing")`, entered "exactly as confirming
 * START does"; then the world is emptied and the two autonomous consequences
 * are held. A check spawns back exactly what its requirement is about — a
 * target it aims a ball at, a pod it drops on the deflector — and turns a
 * switch back on only when the switch's consequence IS the requirement.
 *
 * `waveAdvance` off is what lets a destruction that empties the field play on
 * in `playing`, and `podSpawn` off is what keeps a watched destruction from
 * shedding a pod on top of the scenario — the two holds the spec gives a
 * scenario "so it can watch one behavior without another arriving on top of
 * it".
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
 * Start a session the way a player does: reset to the title and `confirm` the
 * START entry with a real key press.
 *
 * The one compound sequence that presses keys rather than posing — it is what
 * the navigation and session-start points drive. A point about anything else
 * reaches its screen through {@link poseScene} or {@link isolate} instead,
 * because a build with a broken menu and a correct simulation must fail the
 * menu points and pass the others.
 */
export async function startPlay(
  h: Harness,
  seed?: number,
): Promise<KesslerSnapshot> {
  h.reset(seed);
  await tap(h, "Enter");
  return h.snapshot();
}

/**
 * Reset and enter `screen` through the surface alone, "exactly as the real
 * transition into it enters it" (`setScreen`, specs/instrumentation.md).
 *
 * The reset first, so the screen is entered from the boot state and two poses
 * of the same scene read the same way. A check that wants a scene UNDER the
 * screen — a paused mid-flight ball, a game over with a score — poses the
 * scene first through the atomic operations and calls `h.debug.setScreen`
 * itself.
 */
export function poseScene(h: Harness, screen: Screen): KesslerSnapshot {
  h.reset();
  h.debug.setScreen(screen);
  return h.snapshot();
}

/**
 * Spawn an unparked ball at radius `r` and angle `deg`, moving with radial
 * speed `vr` (outward positive) and tangential speed `vt` (toward `+theta`
 * positive) — the polar spelling of `spawnBall` nearly every contact scenario
 * stages with.
 */
export function spawnBallPolar(
  h: Harness,
  r: number,
  deg: number,
  vr: number,
  vt = 0,
): void {
  const at = polarToXy(r, deg);
  const v = polarVelocity(deg, vr, vt);
  h.debug.spawnBall(at.x, at.y, v.vx, v.vy);
}

/** Spawn a pod of `kind` at radius `r` and angle `deg`. It falls inward. */
export function spawnPodPolar(
  h: Harness,
  kind: PodKind,
  r: number,
  deg: number,
): void {
  const at = polarToXy(r, deg);
  h.debug.spawnPod(kind, at.x, at.y);
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
 * it, exactly as `specs/instrumentation.md` has it report. The index REACHES
 * the build: `menuItemRect` is a reading, and the package's apply-threaded
 * driver hands a reading `engine.state` followed by the check's own arguments.
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
/* Cues                                                                       */
/* -------------------------------------------------------------------------- */
//
// `specs/assets.md` fixes the thirteen cue names and the two beds, and the
// file that specifies each event fixes the cue it plays. Under this engine the
// build declares each by name and plays it by name, and the engine announces
// every play — so what a check reads is WHICH cue sounded, without a decoder.
// "Audio belongs to the ticks. A pose changes the state alone and sounds
// nothing; the cues a scenario hears come from the ticks run after it"
// (specs/instrumentation.md).

/**
 * Record every cue the build plays from this call onward.
 *
 * A live array the harness pushes into, rather than a slice taken at the end: a
 * check reads it after the drive it is about, and what it holds is exactly the
 * cues that sounded during that drive and none of the ones that sounded while
 * the scene was being posed.
 */
export function onCue(h: Harness): TimedCue[] {
  return kit.watchCues(
    h as unknown as EngineHarness<
      KesslerSnapshot,
      KesslerDriver,
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

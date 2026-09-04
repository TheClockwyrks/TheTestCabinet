// The harness: one page, one build, and everything a check reads off it.
//
// Every check in an engineless suite is an ordinary vitest test that drives the
// built site IN A REAL BROWSER. There is nothing to import: an engineless run
// seeds no `src/` at all, so the build wrote its own frame loop, its own canvas
// fit, its own keyboard and pointer, its own audio, and its own debug surface —
// and the only place all of that exists is a page that has loaded the bundle. So
// the project serves the build output, loads it in Chromium, and reaches the game
// the way anything reaches it: over the surface the specification told the build
// to install.
//
// THE CLOCK IS THE SURFACE'S. Nothing outside an engineless build owns its loop,
// so `specs/instrumentation.md` puts the clock on the surface: `setAutoStep(false)`
// takes the game off real time and the step operation runs whole frames. Every
// harness opens by taking the game off the clock, so a check asks for a number of
// frames and gets exactly that number.
//
// EVERYTHING CROSSING INTO THE PAGE IS ASYNC. That is the whole of the difference
// between a suite here and its counterpart under an engine: `await h.snapshot()`
// rather than reading the state in process.
//
// ONE INTERFACE, FOUR VOCABULARIES. The four cases this was extracted from name
// the same machinery differently — `frame()` and `tick()`, `advance()` and
// `step()` and `skip()`, `until()` and `stepUntil()` and `skipUntil()`,
// `maxFrames` and `maxTicks`, `frames` and `ticks`. Those are not four designs;
// they are one design under four house styles, and a suite is written in its
// case's. So {@link Harness} is the UNION of all of them: each aliased pair is
// implemented ONCE and exposed under both names, {@link UntilOptions} accepts
// either spelling of its bound, and {@link UntilResult} carries both spellings of
// its count. Nothing is dropped to keep the union small — a member a case never
// calls costs it nothing, and every name dropped would be a suite rewritten.
//
// METHOD SYNTAX IS LOAD-BEARING. Every member below is declared as a METHOD
// rather than as a property holding a function. Method parameters are bivariant,
// which is what lets a free helper typed over `Harness<unknown, object>` accept a
// harness bound to a case's own snapshot type. Rewriting one as
// `until: (…) => …` would make it contravariant under `strictFunctionTypes` and
// break every such helper.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { gzipSync } from "node:zlib";
import { inject } from "vitest";
import type { Page } from "playwright";
import { ConstantClock, type Clock } from "./clock";
import {
  PROVIDE_URL_KEY,
  resolveConfig,
  type CaseConfig,
  type ResolvedConfig,
} from "./config";
import { contextFor, openPages } from "./browser";
import {
  makeFailSurface,
  readSurfaceFault,
  surfaceRequirement,
  unexposedSurface,
} from "./surface";
import { toDrawCall, type DrawCall, type RecordedOp } from "./draw-calls";
import { DEFAULT_FONT, DEFAULT_TEXT_ALIGN } from "./text";
import { mediaDestination } from "./media";
import { type Recording } from "./replay/format";
import { thinReplay } from "./replay/retable";
import {
  decodeRect,
  type EncodedRect,
  type Pixel,
  type PixelRect,
} from "./pixels";
import type { Point } from "./point";
import { fitViewport, toDevice, type Viewport } from "./viewport";

export type { Pixel, PixelRect } from "./pixels";

/** How a harness opens its page, and what it steps in. */
export interface HarnessOptions {
  /** The clock each frame takes its delta from. Defaults to the case's rate. */
  clock?: Clock;
  /** The window's CSS width. Defaults to the logical stage width. */
  cssWidth?: number;
  /** The window's CSS height. Defaults to the logical stage height. */
  cssHeight?: number;
  /** Device pixels per CSS pixel. Defaults to 1, so one device pixel is one unit. */
  dpr?: number;
  /** The seed the opening `reset` is given. Defaults to the case's, if it has one. */
  seed?: number;
  /**
   * Give the build a real, browser-trusted gesture, so its audio can open.
   *
   * OPT IN, and off by default: the gesture is a genuine browser event, which is
   * the whole point of it, so the game is free to act on it — and a check that is
   * not about sound has nothing to gain from handing the build one. Only the
   * suites that read what a build SOUNDED ask for it, so a fault here can only
   * reach the checks that needed it.
   *
   * What it costs the checks that do ask is nothing, because of WHEN it happens:
   * the gesture is delivered before the opening `reset`, so whatever it moved is
   * put back before the harness is handed over. See {@link ArmGesture}.
   */
  armAudio?: boolean;
}

/**
 * How far a sweep may run, and how many frames separate two samples.
 *
 * BOTH SPELLINGS OF THE BOUND ARE ACCEPTED, and they mean the same thing. Two of
 * the four cases count in frames and two in ticks; a sweep counts whatever the
 * case's step operation runs one of.
 */
export interface UntilOptions {
  /** The bound, in frames. */
  maxFrames?: number;
  /** The bound, in ticks. The same bound; two cases spell it this way. */
  maxTicks?: number;
  /** How many frames to run between two samples of the predicate. */
  poll?: number;
}

/**
 * What a sweep found: whether the predicate ever held, and where it stopped.
 *
 * `frames` and `ticks` are the SAME number under two names, filled from one
 * counter, so a suite written in either vocabulary reads the answer it expects.
 */
export interface UntilResult<S> {
  hit: boolean;
  /** Frames run before the sample that ended the sweep. */
  frames: number;
  /** The same count, for a suite that counts in ticks. */
  ticks: number;
  snapshot: S;
}

/**
 * A sound the build emitted, and the frame of the drive it emitted it on.
 *
 * `frame` and `tick` are the same 1-based counter under two names, for the same
 * reason {@link UntilResult} carries both.
 */
export interface TimedCue {
  /** The frame it sounded on, 1-based, as {@link Harness.frame} reports. */
  frame: number;
  /** The same frame, for a suite that counts in ticks. */
  tick: number;
  /** The frame loop's simulated time at that frame, in milliseconds. */
  t: number;
}

/** Everything a check reads off one page running one build. */
export interface Harness<S, D> {
  /** The page the build is running in. For a check that needs Playwright itself. */
  readonly page: Page;
  /** The case this harness was built for, with every default filled in. */
  readonly config: ResolvedConfig;
  /**
   * The surface the BUILD installed, as operations that cross into the page.
   *
   * Read off the build's own global and never constructed here — see
   * `unexposedSurface`.
   */
  readonly debug: D;
  /**
   * Why the build's surface cannot be driven, or `null` when it can.
   *
   * A fault here is the build's: the surface is missing, or it is missing an
   * operation the specification requires. It says what was FOUND, and the
   * failure pairs it with what the specification REQUIRES. Every operation fails
   * by assertion with that pair rather than throwing, so the fault lands on the
   * points whose checks reach the game through the surface.
   */
  readonly surfaceFault: string | null;
  /**
   * The state the build stood the game up in, read before anything reset it, or
   * `null` when the case did not ask for it or the surface could not be driven.
   *
   * A specification that says of a screen "the game opens here" is stating a fact
   * about what a fresh game OPENS on, not about what a `reset` puts it back to,
   * and every check runs after this harness's opening reset — so that half of the
   * requirement would be invisible without a reading taken first. Off by default:
   * it is a real call into the build's surface, and a case that never reads it
   * should not be charged one.
   */
  readonly openingSnapshot: S | null;
  /**
   * The `screen` field of {@link openingSnapshot}, when it has one.
   *
   * Typed loosely on purpose: the package never interprets a snapshot, and a
   * screen name is compared against a string literal at the one call site that
   * reads it.
   */
  readonly openingScreen: string | null;
  /** Everything the page logged to `console.error`, or threw, oldest first. */
  readonly pageErrors: string[];
  /**
   * Where {@link watchCues} attaches: one array per watcher, each collecting the
   * cues from the frame the watcher was opened on.
   *
   * Exposed rather than kept in a private table alone, so a case that wraps a
   * harness — spreading it to override one member — carries the sinks with it
   * instead of quietly getting a watcher that never fills.
   */
  readonly cues: TimedCue[][];

  /** The frames this harness has driven, 1-based, as a recorded frame counts them. */
  frame(): number;
  /** The same counter, for a suite that counts in ticks. */
  tick(): number;
  /** The simulated time those frames covered, in milliseconds. */
  timeMs(): number;

  /** A fresh read of the game's state through the build's `snapshot`. */
  snapshot(): Promise<S>;
  /**
   * Run `count` frames back to back, each closed as one recorded frame.
   *
   * Each frame is opened and closed around a single step of the build's surface,
   * all inside one synchronous evaluation, so nothing the page's own animation
   * frame renders can land inside a recorded frame — and so a frame the recorder
   * keeps is exactly one frame the game ran.
   *
   * ANSWERS NOTHING, WHERE {@link step} ANSWERS THE STATE THE FRAMES LEFT. That
   * is not an oversight in the union and it is not a narrowing either: it is what
   * all three cases that spell the drive this way declare, and a suite is written
   * against its own case's declaration. Widening it to the snapshot would be a
   * SILENT contract change for them — an `advance` handed to a helper that takes
   * a `() => Promise<void>` stops compiling, which is a suite rewrite, and there
   * is nothing to gain: a suite that wants the state reads it with
   * {@link snapshot}, which is what every one of those call sites already does.
   */
  advance(count?: number): Promise<void>;
  /**
   * The same drive, answering the state the frames left.
   *
   * The one case that spells it this way reads that state at nearly every call
   * site, so this half of the pair carries it. Both names run the same frames
   * through the same body; they differ only in what they hand back.
   */
  step(count?: number): Promise<S>;
  /**
   * Run `count` frames in one batched call, closing no recorded frame.
   *
   * The same simulation as {@link advance} — the frames are the build's own and
   * nothing is fabricated — and the same cost to the game. What it saves is a
   * capture's budget: a march to a state spends none of the frames a reviewer
   * looks at.
   */
  skip(count?: number): Promise<void>;
  /** Advance until `predicate` holds, sampling every `poll` frames. */
  until(
    predicate: (snapshot: S) => boolean,
    options?: UntilOptions,
  ): Promise<UntilResult<S>>;
  /** The same sweep. Two of the four cases spell it this way. */
  stepUntil(
    predicate: (snapshot: S) => boolean,
    options?: UntilOptions,
  ): Promise<UntilResult<S>>;
  /** The same sweep on {@link skip}: a march to a state, filmed by nothing. */
  skipUntil(
    predicate: (snapshot: S) => boolean,
    options?: UntilOptions,
  ): Promise<UntilResult<S>>;
  /**
   * Run one frame at a time, handing each frame's snapshot to `watch`, and stop
   * when it answers `true`.
   *
   * What a check about a CADENCE reads. The whole history is handed back, so a
   * check can say what happened on every frame before the one it stopped on.
   */
  stepWatching(
    count: number,
    watch?: (snapshot: S, frame: number) => boolean,
  ): Promise<S[]>;
  /** Hand the game back to its own frame loop for `ms` of real time, then take it back. */
  runFor(ms: number): Promise<void>;

  /** Press a key and leave it down, as a player holding it would. */
  hold(code: string): Promise<void>;
  /** Release a key held by {@link hold}. */
  release(code: string): Promise<void>;
  /**
   * Press a key, run the one frame that delivers it, and release it.
   *
   * A press that ran no frame would never reach a build that reads its actions
   * once per frame as a press edge, and a press released before a frame ran would
   * be invisible to a build that compares held state between frames — so the
   * frame goes between the two. Exactly one frame passes either way, so nothing a
   * caller counts moves.
   */
  tap(code: string): Promise<S>;
  /** Hold `code` for `count` frames, then release it. */
  holdFor(code: string, count: number): Promise<S>;

  /** Move the pointer to a logical point, in CSS pixels. */
  movePointer(x: number, y: number): Promise<void>;
  /**
   * Press and release a mouse button over the stage, running one frame between.
   *
   * The pointer is moved to the point first, so a build that reads an aim from
   * the pointer reads the point pressed.
   */
  clickPointer(x: number, y: number, button?: "left" | "right"): Promise<S>;

  /** Run exactly one frame and hand back every operation its render issued. */
  frameCalls(): Promise<DrawCall[]>;
  /** Every operation the last CLOSED frame's render issued, without driving one. */
  lastCalls(): Promise<DrawCall[]>;
  /** Reflect the surface without invoking it: `typeof` for each name, and the version. */
  probe(
    names: readonly string[],
  ): Promise<{ version: unknown; ops: Record<string, string> }>;

  /** How the stage is mapped onto this harness's canvas. */
  viewport(): Viewport;
  /** Where a logical point lands in the canvas's backing store. */
  device(x: number, y: number): Point;
  /**
   * Where a logical point lands in CSS pixels, taken through the DEVICE mapping.
   *
   * The device point is rounded to a whole pixel and then divided by the device
   * pixel ratio, so this answers "the CSS position of the pixel a logical point
   * lands on". {@link cssPoint} answers the unrounded question directly in CSS
   * units. The two agree wherever the device point is already whole, which is
   * every shape a check runs at bar the ones that are ABOUT the fit — they are
   * kept apart because the cases that use them measure different things.
   */
  css(x: number, y: number): Point;
  /** Where a logical point lands in CSS pixels, in CSS units throughout. */
  cssPoint(x: number, y: number): Point;
  /** The device pixel under a logical point, as `[r, g, b, a]`. */
  pixel(x: number, y: number): Promise<Pixel>;
  /** Many logical points at once, in one crossing into the page. */
  pixels(points: readonly Point[]): Promise<Pixel[]>;
  /** A pixel addressed in the canvas's own backing store, past the fit. */
  devicePixel(x: number, y: number): Promise<Pixel>;
  /**
   * A rectangle of the canvas, addressed in logical units and read back as RGBA.
   *
   * The rectangle is `width` x `height` LOGICAL units with its top-left at
   * `(x, y)`; at the harness's default shape that is one device pixel per unit,
   * so a 28 x 28 read is the 28 x 28 sprite the build drew there.
   */
  pixelRect(
    x: number,
    y: number,
    width: number,
    height: number,
  ): Promise<PixelRect>;
  /**
   * The channel-mean brightness of every device pixel along one line of the
   * backing store, addressed past the fit.
   *
   * One crossing into the page for the whole line, because a check that has to
   * find WHERE the build drew something reads thousands of pixels rather than a
   * handful, and a crossing each would cost more than the frame it is reading.
   */
  scanDevice(axis: "row" | "column", index: number): Promise<number[]>;
  /**
   * The RGBA bytes of a source a frame drew, by its `ImageRef` id.
   *
   * The produced file itself, at its own natural size, rather than the corner of
   * the stage it landed on — which is what a check about a sprite's own pixels
   * needs. `null` when the page no longer holds that source.
   */
  imagePixels(id: number): Promise<PixelRect | null>;
  /** The canvas's backing store size, as the build sized it. */
  surface(): Promise<{ width: number; height: number; dpr: number }>;

  /** How many sounds the build has emitted since the page loaded, in total. */
  sounds(): Promise<number>;
  /**
   * How many of the sources the build started are still live and LOOPING.
   *
   * A build that runs a bed by setting `loop` on its source is read directly
   * here. One that instead re-schedules the buffer end to end is equally
   * conformant and reports zero, so a check about a bed pairs this with
   * {@link sounds}: a bed that is sounding at all is the weaker reading every
   * conformant build satisfies.
   */
  loopingSounds(): Promise<number>;
  /** How many of the sounds emitted were looping when they started. */
  loopStarts(): Promise<number>;

  /** Release anything held, and let the page go. */
  dispose(): Promise<void>;
}

/** Where {@link watchCues} attaches, per harness. */
const harnessCues = new WeakMap<object, TimedCue[][]>();

/** How far a sweep runs when the caller names no bound. */
const DEFAULT_MAX_FRAMES = 600;

/**
 * How many frames run between the arming gesture and the opening `reset`.
 *
 * Not a settling time, a READING time: the frames on which a build's own input
 * layer consumes the gesture, so that whatever it does with it is in the state
 * the `reset` then restores. Two, because that is the most a conformant build
 * takes to read a press and its release.
 */
const ARM_SETTLE_FRAMES = 2;

/** The page's globals, as the shapes the evaluations below reach for. */
type PageGlobals = Record<
  string,
  Record<string, (...args: unknown[]) => unknown>
>;

/** A sweep's answer, with the one count written under both its names. */
function swept<S>(hit: boolean, count: number, snapshot: S): UntilResult<S> {
  return { hit, frames: count, ticks: count, snapshot };
}

/**
 * Advance until `predicate` holds, over whichever of the two drives the caller
 * chose.
 *
 * GUARD AGAINST A VACUOUS PASS. The first read is taken BEFORE anything is
 * driven, so a sweep reports a hit at zero frames when the predicate already
 * held. That is the honest answer, and it is also the trap: a check that sweeps
 * for "the game left live play" without first establishing that it was IN live
 * play passes on a game that was never playing. Capture the state the scenario
 * needs before the sweep, not from the sweep.
 */
async function sweep<S>(
  read: () => Promise<S>,
  run: (count: number) => Promise<S>,
  predicate: (snapshot: S) => boolean,
  options: UntilOptions,
): Promise<UntilResult<S>> {
  const max = options.maxFrames ?? options.maxTicks ?? DEFAULT_MAX_FRAMES;
  const poll = Math.max(1, options.poll ?? 1);

  let snapshot = await read();
  if (predicate(snapshot)) return swept(true, 0, snapshot);

  let count = 0;
  while (count < max) {
    const stride = Math.min(poll, max - count);
    snapshot = await run(stride);
    count += stride;
    if (predicate(snapshot)) return swept(true, count, snapshot);
  }
  return swept(false, count, snapshot);
}

/* ---- Measuring the text a frame drew --------------------------------------- */

/** One text call, and the text state the walk found in force at it. */
interface PendingMeasure {
  call: Extract<DrawCall, { kind: "call" }>;
  text: string;
  font: string;
  textAlign: string;
}

/**
 * Attach a measured width and the alignment in force to every text call of a
 * recorded frame.
 *
 * The recorder records `font` and `textAlign` as ordinary property sets, and
 * `save`/`restore` stack them exactly as they stack the transform, so the state
 * at each call is recovered by walking the frame. The widths themselves are
 * measured IN THE PAGE, against an offscreen 2D context, so a run is measured
 * under the build's own loaded fonts — in ONE crossing, over the distinct
 * (text, font) pairs the frame used, however many calls spelled them.
 *
 * The walk starts from the context's own defaults, because a frame's operation
 * list holds what that frame issued and not what it inherited. A build that sets
 * its font every frame, which is the ordinary render, is measured exactly; one
 * that sets it once and relies on the inheritance is measured against the
 * default font, which under-reports the width and so only ever leaves runs apart
 * that would otherwise have joined.
 */
async function measureTextCalls(page: Page, calls: DrawCall[]): Promise<void> {
  const pending: PendingMeasure[] = [];
  const stack: { font: string; textAlign: string }[] = [];
  let current = { font: DEFAULT_FONT, textAlign: DEFAULT_TEXT_ALIGN };

  for (const call of calls) {
    if (call.kind === "set") {
      if (call.property === "font" && typeof call.value === "string") {
        current = { ...current, font: call.value };
      } else if (
        call.property === "textAlign" &&
        typeof call.value === "string"
      ) {
        current = { ...current, textAlign: call.value };
      }
      continue;
    }
    if (call.method === "save") {
      stack.push(current);
      continue;
    }
    if (call.method === "restore") {
      const popped = stack.pop();
      if (popped !== undefined) current = popped;
      continue;
    }
    if (call.method !== "fillText" && call.method !== "strokeText") continue;
    const text = call.args[0];
    if (typeof text !== "string" || text.length === 0) continue;
    pending.push({
      call,
      text,
      font: current.font,
      textAlign: current.textAlign,
    });
  }
  if (pending.length === 0) return;

  const distinct = new Map<string, { font: string; text: string }>();
  for (const item of pending) {
    distinct.set(measureKey(item.font, item.text), {
      font: item.font,
      text: item.text,
    });
  }
  const wanted = [...distinct.values()];

  const widths = (await page.evaluate((items) => {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (ctx === null) {
      throw new Error("case-harness: no 2D context to measure text in");
    }
    return items.map((item) => {
      ctx.font = item.font;
      return ctx.measureText(item.text).width;
    });
  }, wanted)) as number[];

  const measured = new Map<string, number>();
  for (const [index, item] of wanted.entries()) {
    measured.set(measureKey(item.font, item.text), widths[index] as number);
  }
  for (const item of pending) {
    item.call.text = {
      width: measured.get(measureKey(item.font, item.text)) ?? 0,
      textAlign: item.textAlign,
    };
  }
}

/**
 * One (font, text) pair as a map key.
 *
 * The separator is a newline, which neither a CSS font shorthand nor a run of
 * canvas text can contain, so no two distinct pairs ever collide on one key.
 */
function measureKey(font: string, text: string): string {
  return `${font}\n${text}`;
}

/**
 * Bind {@link Harness} to one case, and hand back the `createHarness` its suites
 * call.
 *
 * TYPES BY GENERICS, VALUES BY CONFIG. `S` is the case's snapshot and `D` its
 * debug surface, neither of which this file ever interprets: a snapshot is
 * carried opaquely from the page to the predicate that reads it, and the surface
 * is a proxy that forwards a name and its arguments. Everything else a case
 * differs in — the handle, the required operations, the stage, the step
 * operation, the arming gesture — arrives in one object.
 */
export function createHarnessFactory<S, D extends object>(
  config: CaseConfig<S>,
): (options?: HarnessOptions) => Promise<Harness<S, D>> {
  const resolved = resolveConfig(config);
  // The case's own narrowing, or none. Held here rather than on `ResolvedConfig`
  // because it is the one member of a case's config that reads the case's own
  // snapshot type, and `ResolvedConfig` is handed to every check as `h.config`.
  const project: (snapshot: S) => S =
    config.projectSnapshot?.bind(config) ?? ((snapshot) => snapshot);
  const requirement = surfaceRequirement(resolved.handle, resolved.specPath);
  const failSurface = makeFailSurface(requirement);
  const tickMs = 1000 / resolved.tickHz;

  return async function createHarness(
    options: HarnessOptions = {},
  ): Promise<Harness<S, D>> {
    const cssWidth = options.cssWidth ?? resolved.stage.width;
    const cssHeight = options.cssHeight ?? resolved.stage.height;
    const dpr = options.dpr ?? 1;
    const clock = options.clock ?? new ConstantClock(tickMs);
    const seed = options.seed ?? resolved.defaultSeed;
    // Both are read by the arming gesture below, which happens before the page is
    // handed to anything else, so neither can wait until the harness is built.
    const view = fitViewport(cssWidth, cssHeight, dpr, resolved.stage);
    const cssPointOf = (x: number, y: number): Point => ({
      x: view.cssOffsetX + x * view.cssScale,
      y: view.cssOffsetY + y * view.cssScale,
    });
    const context = await contextFor({ cssWidth, cssHeight, dpr }, resolved);
    const page = await context.newPage();
    openPages.add(page);

    // Whatever this page throws or logs as an error while THIS harness drives
    // it. The page belongs to one harness, so the log cannot pick up what some
    // other check provoked.
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => {
      pageErrors.push(String(error.message || error));
    });
    page.on("console", (message) => {
      if (message.type() === "error") pageErrors.push(message.text());
    });

    await page.goto(inject(PROVIDE_URL_KEY), { waitUntil: "load" });

    const surfaceFault = await readSurfaceFault(
      page,
      resolved.handle,
      resolved.requiredOps,
      resolved.surfaceTimeoutMs,
    );
    const refuse = (): never => failSurface(surfaceFault ?? "");

    const call = async (
      operation: string,
      args: unknown[],
    ): Promise<unknown> => {
      if (surfaceFault !== null) refuse();
      const returned = await page.evaluate(
        ([handle, name, rest]) =>
          (window as unknown as PageGlobals)[handle]![name]!(...rest),
        [resolved.handle, operation, args] as const,
      );
      // One of the points a snapshot crosses back out of the page, and the one
      // every read of the surface's own `snapshot` goes through — `h.snapshot()`,
      // `h.debug.snapshot()`, the opening read, and every sweep. The driven runs
      // below are the others.
      return operation === "snapshot" ? project(returned as S) : returned;
    };

    const debug =
      surfaceFault !== null
        ? unexposedSurface<D>(surfaceFault, failSurface)
        : (new Proxy({} as D, {
            get: (_target, property): unknown => {
              if (typeof property === "symbol") return undefined;
              if (property === "then" || property === "constructor")
                return undefined;
              const name = String(property);
              return (...args: unknown[]) => call(name, args);
            },
          }) as D);

    /**
     * A GENUINE browser gesture, so the build's audio can open.
     *
     * A build is free to open its audio context from a real DOM event alone —
     * both that and an explicit unlock are conformant — so a gesture delivered
     * any other way would leave a perfectly good build silent. Which gesture it
     * is, is the case's ({@link ArmGesture}); a press is made at the case's own
     * LOGICAL point, taken through the fit like every other pointer operation, so
     * it lands where the case says it does whatever shape the window is.
     */
    const armGesture = async (): Promise<void> => {
      if (resolved.arm.kind === "key") {
        await page.keyboard.press(resolved.arm.code);
        return;
      }
      const at = cssPointOf(resolved.arm.x, resolved.arm.y);
      await page.mouse.move(at.x, at.y);
      await page.mouse.down();
      await page.mouse.up();
    };

    // What the build opened on, read before the `reset` below puts it back
    // whatever it opened on. Only when the case asked: it is a real call into
    // the build's surface.
    const openingSnapshot =
      resolved.readOpeningSnapshot && surfaceFault === null
        ? ((await call("snapshot", [])) as S)
        : null;

    if (surfaceFault === null) {
      // Off the wall clock and back to the start before a check touches
      // anything: from here the game changes only when this harness says so.
      await call("setAutoStep", [false]);
      // THE AUDIO GESTURE GOES IN BEFORE THAT RESTORE, which is what makes it
      // safe to deliver one at all. It is a real browser event — it has to be, or
      // a build that opens its context from a DOM event alone would stay silent —
      // so the game is entitled to act on it: a press lands wherever the build
      // chose to put its controls, and a case whose specification leaves every key
      // binding to the build has no key that is inert by construction either.
      // Delivered here, neither has to be. The `reset` on the next line restores
      // every declared field of the state, so a menu the gesture took, a screen it
      // left, or a beam it cleared is gone before a check reads anything — while
      // the audio it opened is a fact about the page's user activation, which no
      // reset touches.
      if (options.armAudio ?? false) {
        await armGesture();
        // And the frames the build reads it on, which is the half of the ordering
        // that is easy to miss. An input layer that BUFFERS its samples and reads
        // them once a frame — the shape an engineless build usually writes — has
        // not acted on the gesture yet when this line is reached, and the buffer
        // belongs to that layer rather than to the state, so the `reset` would not
        // empty it: the edges would still be pending, and the first frame a check
        // drove would take them, past the restore meant to erase them. Two frames,
        // because a build is equally free to read one sample per frame, which is
        // what a press and its release take.
        await call(
          resolved.step.op,
          resolved.step.kind === "seconds-frames"
            ? [(ARM_SETTLE_FRAMES * tickMs) / 1000, ARM_SETTLE_FRAMES]
            : [ARM_SETTLE_FRAMES],
        );
      }
      await call("reset", seed === null ? [] : [{ seed }]);
      // And a recorder over the surface before a check can arm one. A build is
      // free to ask for its 2D context on the frame it first draws rather than
      // while it initializes, so the surface can be installed and answering
      // before any context exists to record — and a `captureReplay` armed in
      // that window arms nothing and writes no evidence for a section that drew.
      await page
        .waitForFunction(
          (rec) =>
            (window as unknown as Record<string, { ready(): boolean }>)[
              rec
            ]!.ready(),
          resolved.recorderGlobal,
          { timeout: resolved.surfaceTimeoutMs },
        )
        .catch(() => undefined);
    }

    const cueSinks: TimedCue[][] = [];
    let frameCount = 0;
    let timeMs = 0;

    /**
     * Run `count` frames and read the state they left, in one crossing.
     *
     * Each frame is opened and closed around a single step of the build's
     * surface, all inside one synchronous evaluation, and the audio probe is read
     * either side of it, so a sound is attributed to the frame that produced it.
     * `sample` asks for the snapshot after every frame rather than only the last,
     * which is what a check about a cadence reads.
     */
    const drive = async (
      count: number,
      sample = false,
    ): Promise<{ snapshots: S[]; sounds: number[] }> => {
      if (surfaceFault !== null) refuse();
      const deltas: number[] = [];
      for (let i = 0; i < count; i += 1) deltas.push(clock.delta());
      const result = (await page.evaluate(
        ([handle, recName, audioName, op, kind, dts, every]) => {
          const globals = window as unknown as PageGlobals;
          const api = globals[handle] as Record<
            string,
            (...args: unknown[]) => unknown
          >;
          const rec = globals[recName] as Record<
            string,
            (...args: unknown[]) => unknown
          >;
          const audio = globals[audioName] as unknown as {
            started(): number;
          };
          const sounds: number[] = [];
          const snapshots: unknown[] = [];
          for (let i = 0; i < dts.length; i += 1) {
            const dt = dts[i] as number;
            const before = audio.started();
            rec.begin!();
            if (kind === "seconds-frames") api[op]!(dt / 1000, 1);
            else api[op]!(1);
            rec.end!(dt);
            sounds.push(audio.started() - before);
            if (every || i === dts.length - 1) snapshots.push(api.snapshot!());
          }
          if (dts.length === 0) snapshots.push(api.snapshot!());
          return { snapshots, sounds };
        },
        [
          resolved.handle,
          resolved.recorderGlobal,
          resolved.audioGlobal,
          resolved.step.op,
          resolved.step.kind,
          deltas,
          sample,
        ] as const,
      )) as { snapshots: S[]; sounds: number[] };
      result.snapshots = result.snapshots.map(project);

      for (const [index, delta] of deltas.entries()) {
        frameCount += 1;
        timeMs += delta;
        const emitted = result.sounds[index] ?? 0;
        for (let n = 0; n < emitted; n += 1) {
          for (const sink of cueSinks) {
            sink.push({ frame: frameCount, tick: frameCount, t: timeMs });
          }
        }
      }
      return result;
    };

    /**
     * Run `count` frames in one batched call, closing no recorded frame, and read
     * the state they left.
     *
     * The same real frames the game runs under {@link drive}; what is skipped is
     * the recording, not the simulation. A specification that has the step
     * operation run `n` whole frames "immediately and in order" is what makes a
     * batch and a run of singles reach the same state.
     */
    const march = async (count: number): Promise<S> => {
      if (surfaceFault !== null) refuse();
      let totalMs = 0;
      for (let i = 0; i < count; i += 1) totalMs += clock.delta();
      const snapshot = (await page.evaluate(
        ([handle, op, kind, howMany, spanMs]) => {
          const api = (window as unknown as PageGlobals)[handle] as Record<
            string,
            (...args: unknown[]) => unknown
          >;
          if (kind === "seconds-frames") api[op]!(spanMs / 1000, howMany);
          else api[op]!(howMany);
          return api.snapshot!();
        },
        [
          resolved.handle,
          resolved.step.op,
          resolved.step.kind,
          count,
          totalMs,
        ] as const,
      )) as S;
      frameCount += count;
      timeMs += totalMs;
      return project(snapshot);
    };

    /**
     * One animation frame, before a reading, for a case that asked for it.
     *
     * A specification has the step operation redraw the canvas, so on a
     * conforming build the picture is already the one the last frame left — but a
     * build that presents on its own frame instead has drawn the same state a
     * moment later, and waiting costs a sample nothing but a frame. The recorder
     * is in manual mode here, so the frame this waits for closes nothing and no
     * recording sees it.
     */
    const settle = async (): Promise<void> => {
      if (!resolved.awaitFrameBeforeRead) return;
      await page.evaluate(
        () => new Promise<void>((done) => requestAnimationFrame(() => done())),
      );
    };

    const readPixels = async (
      devicePoints: readonly Point[],
    ): Promise<Pixel[]> => {
      await settle();
      return page.evaluate(
        ([slug, points]) => {
          const canvases = Array.from(document.querySelectorAll("canvas"));
          const first = canvases[0];
          if (first === undefined)
            throw new Error(`${slug}: the page has no <canvas>`);
          let canvas = first;
          for (const other of canvases) {
            if (other.width * other.height > canvas.width * canvas.height)
              canvas = other;
          }
          const ctx = canvas.getContext("2d");
          if (ctx === null)
            throw new Error(`${slug}: the canvas has no 2D context`);
          return points.map((point) => {
            const x = Math.min(
              Math.max(point.x, 0),
              Math.max(canvas.width - 1, 0),
            );
            const y = Math.min(
              Math.max(point.y, 0),
              Math.max(canvas.height - 1, 0),
            );
            const { data } = ctx.getImageData(x, y, 1, 1);
            return [data[0], data[1], data[2], data[3]] as Pixel;
          });
        },
        [resolved.slug, devicePoints as Point[]] as const,
      );
    };

    const lastOf = (snapshots: readonly S[]): S =>
      snapshots[snapshots.length - 1] as S;

    const readSnapshot = async (): Promise<S> =>
      (await call("snapshot", [])) as S;

    const stepBy = async (count: number): Promise<S> => {
      const frames = Math.max(0, Math.floor(count));
      return lastOf((await drive(frames)).snapshots);
    };

    const skipBy = async (count: number): Promise<S> => {
      const frames = Math.max(0, Math.floor(count));
      if (frames === 0) return readSnapshot();
      return march(frames);
    };

    const lastCalls = async (): Promise<DrawCall[]> => {
      const ops = (await page.evaluate(
        (rec) =>
          (window as unknown as Record<string, { last(): unknown[] }>)[
            rec
          ]!.last(),
        resolved.recorderGlobal,
      )) as RecordedOp[];
      const calls = ops.map(toDrawCall);
      if (resolved.measureText) await measureTextCalls(page, calls);
      return calls;
    };

    const harness: Harness<S, D> = {
      page,
      config: resolved,
      debug,
      surfaceFault,
      openingSnapshot,
      openingScreen:
        openingSnapshot === null
          ? null
          : (((openingSnapshot as { screen?: unknown }).screen ?? null) as
              | string
              | null),
      pageErrors,
      cues: cueSinks,

      frame: () => frameCount,
      tick: () => frameCount,
      timeMs: () => timeMs,

      snapshot: () => readSnapshot(),

      // `advance` and `skip` answer nothing; `step` answers the state. All three
      // run the same frames — see the declarations above for why the pair is
      // split this way.
      advance: async (count = 1) => {
        await stepBy(count);
      },
      step: (count = 1) => stepBy(count),
      skip: async (count = 1) => {
        await skipBy(count);
      },

      until: (predicate, untilOptions = {}) =>
        sweep(readSnapshot, stepBy, predicate, untilOptions),
      stepUntil: (predicate, untilOptions = {}) =>
        sweep(readSnapshot, stepBy, predicate, untilOptions),
      skipUntil: (predicate, untilOptions = {}) =>
        sweep(readSnapshot, skipBy, predicate, untilOptions),

      async stepWatching(count, watch) {
        const seen: S[] = [];
        for (let i = 0; i < count; i += 1) {
          const snapshot = lastOf((await drive(1)).snapshots);
          seen.push(snapshot);
          if (watch?.(snapshot, i + 1) === true) break;
        }
        return seen;
      },

      async runFor(ms) {
        if (surfaceFault !== null) refuse();
        // The one thing here that depends on real elapsed time, so the one thing
        // a browser's own idea of which page matters can distort. The launch
        // already turns the throttling off; bringing the page forward as well
        // means this does not rest on a flag alone.
        await page.bringToFront().catch(() => undefined);
        await page.evaluate(
          ([handle, rec]) => {
            (window as unknown as Record<string, { setMode(m: string): void }>)[
              rec
            ]!.setMode("raf");
            (
              window as unknown as Record<
                string,
                { setAutoStep(on: boolean): void }
              >
            )[handle]!.setAutoStep(true);
          },
          [resolved.handle, resolved.recorderGlobal] as const,
        );
        await page.waitForTimeout(ms);
        await page.evaluate(
          ([handle, rec]) => {
            (
              window as unknown as Record<
                string,
                { setAutoStep(on: boolean): void }
              >
            )[handle]!.setAutoStep(false);
            (window as unknown as Record<string, { setMode(m: string): void }>)[
              rec
            ]!.setMode("manual");
          },
          [resolved.handle, resolved.recorderGlobal] as const,
        );
      },

      hold: (code) => page.keyboard.down(code),
      release: (code) => page.keyboard.up(code),

      async tap(code) {
        // Down, ONE frame, up. The frame between the two is what makes this a
        // press a build can actually see: an engineless build wrote its own
        // keyboard layer, and the two conformant ways to read a press — latching
        // the edge in the event handler, or comparing held state at the top of
        // each frame — agree only if the key is genuinely held while a frame
        // runs. A down and an up delivered back to back would be invisible to the
        // second, which is a build a real player has no trouble with.
        await page.keyboard.down(code);
        const snapshot = await stepBy(1);
        await page.keyboard.up(code);
        return snapshot;
      },

      async holdFor(code, count) {
        await page.keyboard.down(code);
        try {
          return await stepBy(count);
        } finally {
          await page.keyboard.up(code);
        }
      },

      async movePointer(x, y) {
        const at = cssPointOf(x, y);
        await page.mouse.move(at.x, at.y);
      },

      async clickPointer(x, y, button = "left") {
        const at = cssPointOf(x, y);
        await page.mouse.move(at.x, at.y);
        await page.mouse.down({ button });
        const snapshot = await stepBy(1);
        await page.mouse.up({ button });
        return snapshot;
      },

      async frameCalls() {
        await drive(1);
        return lastCalls();
      },

      lastCalls: () => lastCalls(),

      probe: (names) =>
        page.evaluate(
          ([handle, wanted]) => {
            const target =
              (window as unknown as Record<string, Record<string, unknown>>)[
                handle
              ] ?? {};
            const ops: Record<string, string> = {};
            for (const name of wanted) ops[name] = typeof target[name];
            return { version: target.version, ops };
          },
          [resolved.handle, [...names]] as const,
        ),

      viewport: () => ({ ...view }),
      device: (x, y) => toDevice(view, x, y),
      css: (x, y) => {
        const at = toDevice(view, x, y);
        return { x: at.x / dpr, y: at.y / dpr };
      },
      cssPoint: (x, y) => cssPointOf(x, y),
      pixel: async (x, y) =>
        (await readPixels([toDevice(view, x, y)]))[0] as Pixel,
      pixels: (points) =>
        readPixels(points.map((p) => toDevice(view, p.x, p.y))),
      devicePixel: async (x, y) => (await readPixels([{ x, y }]))[0] as Pixel,

      async pixelRect(x, y, width, height) {
        await settle();
        const origin = toDevice(view, x, y);
        const deviceW = Math.max(1, Math.round(width * view.scale));
        const deviceH = Math.max(1, Math.round(height * view.scale));
        const encoded = (await page.evaluate(
          ([slug, left, top, wide, high]) => {
            const canvases = Array.from(document.querySelectorAll("canvas"));
            const first = canvases[0];
            if (first === undefined)
              throw new Error(`${slug}: the page has no <canvas>`);
            let canvas = first;
            for (const other of canvases) {
              if (other.width * other.height > canvas.width * canvas.height)
                canvas = other;
            }
            const ctx = canvas.getContext("2d");
            if (ctx === null)
              throw new Error(`${slug}: the canvas has no 2D context`);
            const clampedX = Math.min(Math.max(left, 0), canvas.width);
            const clampedY = Math.min(Math.max(top, 0), canvas.height);
            const clampedW = Math.max(
              1,
              Math.min(wide, canvas.width - clampedX),
            );
            const clampedH = Math.max(
              1,
              Math.min(high, canvas.height - clampedY),
            );
            const pixels = ctx.getImageData(
              clampedX,
              clampedY,
              clampedW,
              clampedH,
            );
            // Base64 rather than an array of numbers: see `PixelRect`. The
            // string is built in chunks because `String.fromCharCode` is applied
            // to its arguments, and two million of them overflow the stack.
            let binary = "";
            const chunk = 0x8000;
            for (let i = 0; i < pixels.data.length; i += chunk) {
              binary += String.fromCharCode(
                ...pixels.data.subarray(i, i + chunk),
              );
            }
            return {
              width: pixels.width,
              height: pixels.height,
              b64: btoa(binary),
            };
          },
          [resolved.slug, origin.x, origin.y, deviceW, deviceH] as const,
        )) as EncodedRect;
        return decodeRect(encoded);
      },

      async scanDevice(axis, index) {
        await settle();
        return page.evaluate(
          ([slug, which, at]) => {
            const canvases = Array.from(document.querySelectorAll("canvas"));
            const first = canvases[0];
            if (first === undefined) {
              throw new Error(`${slug}: the page has no <canvas>`);
            }
            let canvas = first;
            for (const other of canvases) {
              if (other.width * other.height > canvas.width * canvas.height) {
                canvas = other;
              }
            }
            const ctx2d = canvas.getContext("2d");
            if (ctx2d === null) {
              throw new Error(`${slug}: the canvas has no 2D context`);
            }
            const row = which === "row";
            const line = Math.min(
              Math.max(at, 0),
              Math.max((row ? canvas.height : canvas.width) - 1, 0),
            );
            const { data } = row
              ? ctx2d.getImageData(0, line, canvas.width, 1)
              : ctx2d.getImageData(line, 0, 1, canvas.height);
            const out: number[] = [];
            for (let i = 0; i < data.length; i += 4) {
              out.push(
                ((data[i] as number) +
                  (data[i + 1] as number) +
                  (data[i + 2] as number)) /
                  3,
              );
            }
            return out;
          },
          [resolved.slug, axis, index] as const,
        );
      },

      async imagePixels(id) {
        const read = (await page.evaluate(
          ([rec, wanted]) =>
            (
              window as unknown as Record<
                string,
                {
                  imagePixels(
                    n: number,
                  ): { width: number; height: number; data: number[] } | null;
                }
              >
            )[rec]!.imagePixels(wanted),
          [resolved.recorderGlobal, id] as const,
        )) as { width: number; height: number; data: number[] } | null;
        if (read === null) return null;
        // A sprite is small enough that the array costs nothing; it is widened to
        // the same shape a canvas read has, so the two are interchangeable.
        return {
          width: read.width,
          height: read.height,
          data: Uint8ClampedArray.from(read.data),
        };
      },

      surface: () =>
        page.evaluate((slug) => {
          const canvases = Array.from(document.querySelectorAll("canvas"));
          const first = canvases[0];
          if (first === undefined) {
            throw new Error(
              `${slug}: the page has no <canvas>, so the build drew nowhere — ` +
                "index.html supplies one and the build is asked not to edit it " +
                "(specs/overview.md)",
            );
          }
          let canvas = first;
          for (const other of canvases) {
            if (other.width * other.height > canvas.width * canvas.height)
              canvas = other;
          }
          return {
            width: canvas.width,
            height: canvas.height,
            dpr: window.devicePixelRatio,
          };
        }, resolved.slug),

      sounds: () =>
        page.evaluate(
          (audioName) =>
            (window as unknown as Record<string, { started(): number }>)[
              audioName
            ]!.started(),
          resolved.audioGlobal,
        ),

      loopingSounds: () =>
        page.evaluate(
          (audioName) =>
            (window as unknown as Record<string, { looping(): number }>)[
              audioName
            ]!.looping(),
          resolved.audioGlobal,
        ),

      loopStarts: () =>
        page.evaluate(
          (audioName) =>
            (window as unknown as Record<string, { loopStarts(): number }>)[
              audioName
            ]!.loopStarts(),
          resolved.audioGlobal,
        ),

      async dispose() {
        // The context stays: it holds the init scripts and the window shape, and
        // the next harness of this shape wants both. The page goes, so nothing
        // this check pressed, opened or muted can reach the next one.
        openPages.delete(page);
        await page.close().catch(() => undefined);
      },
    };

    harnessCues.set(harness, cueSinks);
    return harness;
  };
}

/* -------------------------------------------------------------------------- */
/* Cues                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Record every sound the build emits from now on, stamped with the frame of the
 * drive it sounded on.
 *
 * WHAT IS OBSERVED, AND WHY IT IS THE FAIR READING. A case's specification
 * requires one cue per event, played from the update on the frame its event
 * happens, and says nothing at all about how a build makes a sound — under no
 * engine the whole audio layer is the build's. So the injected audio probe
 * watches the two doors a browser can emit sound through (a Web Audio source
 * being `start()`ed, whatever kind it is, and an `<audio>` element being played)
 * and counts what goes through them; the harness brackets each driven frame
 * around that count, so a sound is attributed to the frame that produced it. A
 * blip made of two oscillators counts as two, which is why a check asserts that a
 * frame sounded rather than how many times: the number of sources is the build's
 * business and the specification never fixed it.
 *
 * WHAT IS LOST HERE THAT AN ENGINE GIVES. The cue's NAME. Under an engine the
 * game asks the bus for a cue by name and the bus announces it. There is no bus
 * here to ask, so these checks confirm that a sound was emitted and on which
 * frame, and a reviewer decides by ear whether the cues are told apart. That is a
 * real reduction, and the alternative — inferring the cue from the waveform the
 * reference happens to use — would grade builds against an implementation rather
 * than against the specification.
 *
 * THIS LIVES BESIDE `createHarnessFactory` BY DESIGN. The sinks it attaches to
 * are the very arrays the drive pushes into; split across a module boundary the
 * two type-check perfectly and this returns an array that never fills, so every
 * audio check passes vacuously.
 */
export function watchCues<S, D>(h: Harness<S, D>): TimedCue[] {
  const played: TimedCue[] = [];
  const sinks = harnessCues.get(h) ?? h.cues;
  sinks.push(played);
  return played;
}

/* -------------------------------------------------------------------------- */
/* Evidence                                                                   */
/* -------------------------------------------------------------------------- */
//
// WHAT A CAPTURE IS, AND WHAT IT IS NOT.
//
// 1. IT IS A REVIEW OUTPUT. The runner collects what lands under the media
//    directory and addresses it by the staged path of the suite that produced it.
// 2. IT IS EVIDENCE, NEVER A VERDICT. The scenario's own value comes straight
//    back, and a scenario that THROWS still writes what it had recorded before
//    the failure travels on — a failing check is the one whose replay a reviewer
//    most wants. A recording that cannot be written is reported as an output that
//    never turned up, which is a fact about the host rather than about the build.
// 3. IT WRITES ONLY WHAT THERE IS TO LOOK AT. A capture that closed no frames
//    leaves no file, so the run reports the output absent instead of offering the
//    reviewer a replay of nothing.
// 4. IT COSTS NOTHING WHEN NOBODY IS COLLECTING. Outside a run the media
//    directory is unset and the whole thing is a no-op that still runs the
//    scenario, so a check cannot pass in one place and fail in the other.

/**
 * Write a recording out, reporting rather than raising anything that goes wrong.
 *
 * A capture that closed no frames writes nothing: a file holding an empty frame
 * list would be collected as an output that turned up, and the run would tell the
 * reviewer there is a replay to watch and then open the player on nothing.
 *
 * What lands on disk is gzip rather than raw JSON. A recording is text made
 * almost entirely of numbers and repeated field names, which gzip takes down to a
 * fraction of its size, and every host that serves one declares the encoding so
 * the browser inflates it before the player sees it. The document inside is the
 * same one.
 *
 * Never throws. A file that cannot be written says something about the machine
 * the validators ran on, and failing the point over it would blame the build for
 * the host's problem.
 */
function writeReplay(
  slug: string,
  destination: string,
  recording: Recording | null,
): void {
  if (recording === null || recording.frames.length === 0) return;
  try {
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, gzipSync(JSON.stringify(thinReplay(recording))));
  } catch (error) {
    console.warn(`${slug}: could not write ${destination}: ${String(error)}`);
  }
}

/**
 * Record the frames `scenario` drives and keep them as the review item's
 * `outputId` output, handing back whatever the scenario returned.
 *
 * Wrap the drive, not the arrangement:
 *
 * ```ts
 * const swept = await captureReplay(h, "retract", () => unwind(h));
 * assertEqual(swept.cells.length, 1);
 * ```
 *
 * The assertions stay exactly where they were and read exactly what they did.
 */
export async function captureReplay<S, D, T>(
  h: Harness<S, D>,
  outputId: string,
  scenario: () => T | Promise<T>,
): Promise<T> {
  const { config } = h;
  const destination = mediaDestination(config.projectRoot, outputId, "json.gz");
  if (destination === null) return scenario();

  const view = h.viewport();
  await h.page.evaluate(
    ([rec, design]) =>
      (window as unknown as Record<string, { arm(d: unknown): boolean }>)[
        rec
      ]!.arm(design),
    [
      config.recorderGlobal,
      {
        width: view.width,
        height: view.height,
        background: config.replayBackground,
      },
    ] as const,
  );
  try {
    return await scenario();
  } finally {
    // In a `finally`, so a scenario that failed still leaves its evidence behind.
    const recording = (await h.page.evaluate(
      (rec) =>
        (window as unknown as Record<string, { disarm(): unknown }>)[
          rec
        ]!.disarm(),
      config.recorderGlobal,
    )) as Recording | null;
    writeReplay(config.slug, destination, recording);
  }
}

/**
 * Keep the picture currently on the canvas as the review item's `outputId`
 * output.
 *
 * The companion to {@link captureReplay}, for a point whose evidence is one
 * PICTURE rather than a stretch of motion: the posed board, the select grid, the
 * screen a menu landed on. What is written is whatever the last frame that RAN
 * left behind, so drive a frame after the pose and call this before the
 * assertions, so a check that fails still leaves the picture that shows why.
 * Nothing here can change a verdict: outside a run this is a no-op, and a still
 * that cannot be written is reported as an output that never turned up.
 */
export async function captureStill<S, D>(
  h: Harness<S, D>,
  outputId: string,
): Promise<void> {
  const { config } = h;
  const destination = mediaDestination(config.projectRoot, outputId, "png");
  if (destination === null) return;
  try {
    mkdirSync(dirname(destination), { recursive: true });
    await h.page.screenshot({ path: destination, type: "png" });
  } catch (error) {
    console.warn(
      `${config.slug}: could not write ${destination}: ${String(error)}`,
    );
  }
}

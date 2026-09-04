// Orrery — the case's half of the validator harness, under NO ENGINE.
// CASE-PROVIDED.
//
// Every check in this project is an ordinary vitest test that drives the built
// site IN A REAL BROWSER. There is nothing to import: an engineless run seeds no
// `src/` at all, so the build wrote its own frame loop, its own canvas fit, its
// own keyboard and pointer, its own audio, and its own `window.__orrery` — and
// the only place all of that exists is a page that has loaded the bundle. So the
// project serves `dist/`, loads it in Chromium, and reaches the game the way
// anything reaches it: over the surface `specs/instrumentation.md` told the build
// to install.
//
// THE MACHINERY THAT DOES THAT IS NOT ORRERY'S. Serving the build, holding one
// browser, opening a page per harness, injecting the draw-command recorder and
// the audio probe, bracketing each driven frame around one step of the build's
// surface, reading pixels and draw calls back out, and writing the evidence a
// review point declares — every engineless case needs exactly that, and it lives
// once, in `@test-cabinet/case-harness`, staged beside this file as
// `./case-harness/`.
//
// WHAT THIS FILE ADDS IS THE THING THE OTHER TWO PROJECTS ALSO HAVE. Orrery ships
// three validator projects and one review item's suite is the SAME TEXT in all
// three, so what a suite holds is not the shared kit's harness but ORRERY's
// {@link Harness}: the same member names, the same argument shapes and the same
// return shapes as `validation/simple-2d/harness.ts` and
// `validation/structured-2d/harness.ts` expose. The kit is what most of them are
// implemented over here; under an engine there is no kit and they are implemented
// over the engine. A suite cannot tell, and that is the whole point.
//
// EVERYTHING CROSSING INTO THE PAGE IS ASYNC, and so is every member of
// {@link Harness} under all three engines. An in-process call has nothing to wait
// for, but a suite that awaited under one engine and did not under another would
// be two suites.
//
// THE CLOCK IS THE SURFACE'S. Nothing outside an engineless build owns its loop,
// so `specs/instrumentation.md` puts the clock on the surface: `setAutoStep(false)`
// takes the game off real time and `advance(seconds, frames)` runs whole frames of
// a chosen length. Every harness opens by taking the game off the clock, so a
// check asks for a number of frames and gets exactly that number. The POINTER
// needs no frames at all — the three pointer operations "take effect immediately,
// when they are called" — so a whole machine is built without advancing the game,
// and a frame is driven only where something is genuinely per-frame: a render to
// sample, a cue to hear, a key to deliver.

import {
  createCaseHarness,
  type Clock,
  type Harness as KitHarness,
  type TimedCue as KitCue,
} from "./case-harness/index";
import {
  INERT_KEY,
  ORRERY_SURFACE_KEY,
  STAGE_H,
  STAGE_W,
  TICK_HZ,
} from "./constants";
import type { OrreryDriver } from "./driver";
import type { StagePoint } from "./field";
import type { OrrerySnapshot } from "./snapshot";
import { REQUIRED_OPS, type OrrerySurface } from "./surface";
import type { DrawCall } from "./drawing";
import type { Pixel, PixelRect } from "./color";
import { fitViewport, toCss, toDevice, type Viewport } from "./viewport";
import { PROJECT_ROOT } from "./media";
import type { TimedCue, UntilOptions, UntilResult } from "./scenario";

export * from "./scenario";
export * from "./media";
export * from "./drawing";
export * from "./color";
export * from "./viewport";
export * from "./snapshot";
export type { OrreryDriver, OrrerySurface };
export { REQUIRED_OPS };

/* -------------------------------------------------------------------------- */
/* The shared kit, bound to Orrery                                            */
/* -------------------------------------------------------------------------- */

/**
 * The shared harness with Orrery's snapshot, Orrery's surface and Orrery's
 * figures bound into it.
 *
 * `projectRoot` comes from THIS module and must never come from the package's:
 * the package is staged one directory deeper than this file, and a produced
 * replay or still is addressed by the running suite's path relative to the
 * project root. Taken from the package it would address every output one level
 * too deep — and silently, because a writer that raised on a failed write would
 * be blaming the build for the host's problem, so neither of them raises.
 */
const kit = createCaseHarness<OrrerySnapshot, OrrerySurface>({
  slug: "orrery",
  handle: ORRERY_SURFACE_KEY,
  requiredOps: REQUIRED_OPS,
  // `advance(seconds, frames)`: a span of simulated time divided into whole
  // frames, so the harness's clock decides how long a frame is — which is what
  // makes `advanceSeconds` exact at any speed step.
  step: { kind: "seconds-frames", op: "advance" },
  stage: { width: STAGE_W, height: STAGE_H },
  tickHz: TICK_HZ,
  // A GENUINE browser gesture, so the build's audio context can open: a build is
  // free to open its audio from a real DOM event alone (both are conformant), so
  // a gesture delivered any other way would leave a perfectly good build silent.
  // A KEY rather than a click, because Orrery's pointer works whatever screen it
  // lands on: a press on the editor would select, deselect, or set the focus, and
  // one on a menu screen would move a highlight or take an item (`specs/ui.md`).
  // `KeyO` is bound to no action in `specs/controls.md`'s whole binding table, so
  // pressing it is inert by specification rather than by accident.
  //
  // IT IS PRESSED ONLY FOR A HARNESS THAT ASKED (`HarnessOptions.armAudio`), and
  // only on the way up: before the opening `reset`, whose restore puts back
  // anything the press touched. So a build that is not being graded on its sound
  // is pressed on never, and one that is, is handed a game the restore made.
  arm: { kind: "key", code: INERT_KEY },
  // A build installs its surface while its entry module runs, so a page that has
  // fired `load` has either installed it already or is not going to. Orrery's
  // build decodes fifty-seven produced files before its first frame, and
  // `specs/assets.md` requires every one of them decoded before that frame, so
  // the wait is the generous one rather than the short one.
  surfaceTimeoutMs: 15_000,
  projectRoot: PROJECT_ROOT,
});

/** What the specification requires of the surface, as a failure's `Expected:`. */
export const SURFACE_REQUIREMENT = kit.SURFACE_REQUIREMENT;

/** Fail the running check on a surface fault, beside what the spec requires. */
export const failSurface = kit.failSurface;

/* -------------------------------------------------------------------------- */
/* The harness                                                                */
/* -------------------------------------------------------------------------- */

/** One asset the build asked for and did not get. */
export interface AssetFailure {
  /** The request's path, relative to the served site. */
  path: string;
  /** What went wrong: a status line, or the browser's own reason. */
  reason: string;
}

/** How a harness opens, and what it steps in by default. */
export interface HarnessOptions {
  /**
   * The length of one frame at the harness's own clock, in milliseconds.
   * Defaults to `1000 / TICK_HZ`. {@link Harness.advanceSeconds} overrides it
   * for the frames it runs, so a check about a fraction of a cycle names the
   * span rather than the frame.
   */
  frameMs?: number;
  /** The window's CSS width. Defaults to the logical stage width. */
  cssWidth?: number;
  /** The window's CSS height. Defaults to the logical stage height. */
  cssHeight?: number;
  /** Device pixels per CSS pixel. Defaults to 1, so one device pixel is one unit. */
  dpr?: number;
  /**
   * Give the build the genuine, browser-trusted gesture its audio context needs
   * before it may sound at all: a press of `INERT_KEY`.
   *
   * OPT IN, AND OFF BY DEFAULT, because a real gesture is one the game is
   * entitled to act on and a check that never reads what the build SOUNDED has
   * nothing to gain from handing it one. Only the suites that count sounds ask
   * for it, so a fault in the arming can only ever reach the points about sound.
   *
   * IT COSTS THOSE SUITES NOTHING, because of WHEN it happens: the press is
   * delivered before the harness's opening `reset`, which restores every declared
   * field of the state, so whatever the key touched is put back before the
   * harness is handed over — while the audio it opened is a fact about the page's
   * user activation, which no reset undoes. Two frames run between the press and
   * the restore, so a build that latches its key edges in the DOM handler and
   * reads them on a frame has consumed them before the restore rather than on the
   * first frame a check drives.
   */
  armAudio?: boolean;
  /**
   * Produced files whose REQUEST PATH matches are not served, so the build's load
   * of them fails.
   *
   * `specs/assets.md`: "A load that fails leaves the game running... so a missing
   * file costs the game its polish rather than its playability." This is how a
   * check poses that: the page is routed so every matching request is refused,
   * reloaded, and put back where a fresh harness leaves it, and what is read back
   * is that the game still initializes, still ticks, still takes input and still
   * draws.
   *
   * THE PATTERN IS TESTED AGAINST THE REQUEST'S PATHNAME, WHICH IS THE BUNDLER'S
   * NAME RATHER THAN THE AUTHORED ONE. A build's `dist/` is a bundle, so
   * `assets/audio/place.wav` is served as something like
   * `/assets/place-C7eSjQc3.wav` — match the stem (`/place/`) or the extension
   * (`/\.wav$/`) rather than the authored path.
   *
   * AND A FILE THE BUILD NEVER REQUESTS CANNOT BE WITHHELD. A bundler is free to
   * inline a small produced PNG as a `data:` URI, which is still the committed
   * file and is still conformant; such a build simply makes no request to refuse,
   * so a check that withholds it observes a game that never missed anything. That
   * is the honest outcome rather than a gap: the requirement is about a load that
   * FAILS, and no load happened.
   */
  withoutAssets?: RegExp;
}

/**
 * Everything a check reads off one page running this build.
 *
 * THE PORTABLE CORE IS EVERYTHING DOWN TO {@link dispose}, and every member of it
 * carries the same name, arguments and return shape in all three of Orrery's
 * validator projects. Below that sit the two members that are this project's
 * alone, because a browser is: {@link page} and {@link kitHarness}.
 */
export interface Harness {
  /** The surface the BUILD installed, driven: every call crosses into the page. */
  readonly debug: OrreryDriver;
  /**
   * Why the build's surface cannot be driven, or `null` when it can.
   *
   * A fault here is the build's: the surface is missing, or it is missing an
   * operation `specs/instrumentation.md` requires. Every operation then fails by
   * assertion, naming what was found beside what the specification requires, so
   * the fault lands on the points whose checks reach the game through it.
   */
  readonly surfaceFault: string | null;
  /** Where `watchCues` attaches: one array per watcher. */
  readonly cues: TimedCue[][];
  /** Every produced file the build asked for and did not get, oldest first. */
  readonly assetFailures: AssetFailure[];
  /** Everything the runtime logged as an error or threw, oldest first. */
  readonly pageErrors: string[];

  /** The frames this harness has driven, 1-based, as a recorded frame counts them. */
  frame(): number;
  /** The simulated time those frames covered, in milliseconds. */
  timeMs(): number;

  /** A fresh read of the game's state through the build's `snapshot`. */
  snapshot(): Promise<OrrerySnapshot>;
  /** Run `frames` frames back to back, each closed as one recorded frame. */
  advance(frames?: number): Promise<void>;
  /**
   * Run `frames` whole frames covering exactly `seconds` of game time.
   *
   * The primitive every cycle helper is built on. A run "advances the fraction by
   * `SPEEDS[sim.speed] * dt` cycles" (`specs/simulation.md`), so a span of game
   * time is what names a cycle or a fraction of one exactly, at any speed step
   * and whatever the division — which `specs/instrumentation.md` guarantees
   * reaches the same state.
   */
  advanceSeconds(seconds: number, frames?: number): Promise<void>;
  /** The same drive as {@link advance}, answering the state the frames left. */
  step(frames?: number): Promise<OrrerySnapshot>;
  /**
   * Run `frames` frames in one batched call.
   *
   * The same real frames the game runs and the same result; what it saves is the
   * crossings. Under this engine it also closes no recorded frame, so a march to
   * a state spends none of a capture's budget; under either engine project it is
   * {@link advance}, and the difference reaches the EVIDENCE alone and never a
   * verdict.
   */
  skip(frames?: number): Promise<void>;
  /** Advance until `predicate` holds, sampling every `poll` frames. */
  until(
    predicate: (snapshot: OrrerySnapshot) => boolean,
    options?: UntilOptions,
  ): Promise<UntilResult>;
  /**
   * Run one frame at a time, handing each frame's snapshot to `watch`, and stop
   * when it answers `true`. What a check about a CADENCE reads.
   */
  stepWatching(
    count: number,
    watch?: (snapshot: OrrerySnapshot, frame: number) => boolean,
  ): Promise<OrrerySnapshot[]>;
  /** Hand the game back to its own frame loop for `ms` of real time, then take it back. */
  runFor(ms: number): Promise<void>;

  /** Press a key and leave it down, as a player holding it would. */
  hold(code: string): Promise<void>;
  /** Release a key held by {@link hold}. */
  release(code: string): Promise<void>;
  /** Press a key, run the one frame that delivers it, and release it. */
  tap(code: string): Promise<OrrerySnapshot>;
  /** Hold `code` for `frames` frames, then release it. */
  holdFor(code: string, frames: number): Promise<OrrerySnapshot>;

  /**
   * Press the REAL pointer at a logical stage point, and run the frame that reads
   * it.
   *
   * The slow sibling of the surface's `pointerDown`. The surface's pointer
   * operations resolve at the CALL, between frames, which is what makes building
   * a machine from code instant; a CUE is played "on the frame its event happens,
   * from `update`" (`specs/ui.md`). So a check whose subject is what a FRAME did
   * with a player's gesture drives the real device instead, one frame per sample,
   * and reads the cue off the frame that consumed it.
   */
  mousePress(x: number, y: number): Promise<void>;
  /** Move the held pointer to a logical stage point, and run the frame that reads it. */
  mouseGlide(x: number, y: number): Promise<void>;
  /** Release the real pointer, and run the frame that reads it. */
  mouseRelease(): Promise<void>;

  /** Run exactly one frame and hand back every operation its render issued. */
  frameCalls(): Promise<DrawCall[]>;
  /** Every operation the last CLOSED frame's render issued, without driving one. */
  lastCalls(): Promise<DrawCall[]>;

  /** How the stage is mapped onto this harness's canvas. */
  viewport(): Viewport;
  /** Where a logical point lands in the canvas's backing store. */
  device(x: number, y: number): StagePoint;
  /** Where a logical point lands in CSS pixels, which is what a real pointer uses. */
  css(x: number, y: number): StagePoint;
  /** The device pixel under a logical point, as `[r, g, b, a]`. */
  pixel(x: number, y: number): Promise<Pixel>;
  /** Many logical points at once, in one crossing. */
  pixels(points: readonly StagePoint[]): Promise<Pixel[]>;
  /** A rectangle of the canvas, addressed in logical units, read back as RGBA. */
  pixelRect(
    x: number,
    y: number,
    width: number,
    height: number,
  ): Promise<PixelRect>;
  /**
   * The RGBA bytes of a source a frame drew, by its `ImageRef` id: the produced
   * file itself, at its own natural size, rather than the corner of the stage it
   * landed on. `null` when the harness no longer holds that source.
   */
  imagePixels(id: number): Promise<PixelRect | null>;
  /** The canvas's backing store size, as the build sized it. */
  surface(): Promise<{ width: number; height: number; dpr: number }>;

  /** How many sounds the build has emitted since the game stood up, in total. */
  sounds(): Promise<number>;
  /**
   * How many of the sources the build started are still live and LOOPING.
   *
   * A build that runs the bed by setting `loop` on its source is read directly
   * here. One that instead re-schedules the buffer end to end is equally
   * conformant and reports zero, so a check about the bed pairs this with
   * {@link sounds}: a bed that is sounding at all is the weaker reading every
   * conformant build satisfies.
   */
  loopingSounds(): Promise<number>;
  /** How many of the sounds emitted were looping when they started. */
  loopStarts(): Promise<number>;
  /** Reflect the surface without invoking it: `typeof` for each name, and `version`. */
  probe(
    names: readonly string[],
  ): Promise<{ version: unknown; ops: Record<string, string> }>;

  /** Release anything held, and let the page go. */
  dispose(): Promise<void>;

  /* -- This project's own, past the portable core -------------------------- */

  /** The Playwright page the build is running in. */
  readonly page: KitHarness<OrrerySnapshot, OrrerySurface>["page"];
  /** The shared kit's harness underneath, for the media helpers below. */
  readonly kitHarness: KitHarness<OrrerySnapshot, OrrerySurface>;
}

/** A clock whose frame length this harness retunes between drives. */
class TunableClock implements Clock {
  constructor(private ms: number) {}
  set(ms: number): void {
    this.ms = ms;
  }
  delta(): number {
    return this.ms;
  }
}

/**
 * Open a page on the build, take the game off its own clock, and hand back
 * everything a check reads.
 */
export async function createHarness(
  options: HarnessOptions = {},
): Promise<Harness> {
  const frameMs = options.frameMs ?? 1000 / TICK_HZ;
  const clock = new TunableClock(frameMs);
  const base = await kit.createHarness({
    clock,
    cssWidth: options.cssWidth,
    cssHeight: options.cssHeight,
    dpr: options.dpr,
    armAudio: options.armAudio,
  });

  const assetFailures: AssetFailure[] = [];
  base.page.on("response", (response) => {
    if (response.status() >= 400) {
      assetFailures.push({
        path: new URL(response.url()).pathname,
        reason: `HTTP ${response.status()}`,
      });
    }
  });
  base.page.on("requestfailed", (request) => {
    assetFailures.push({
      path: new URL(request.url()).pathname,
      reason: request.failure()?.errorText ?? "the request failed",
    });
  });

  if (options.withoutAssets !== undefined) {
    await withheldAssets(base, options.withoutAssets);
  }

  // The kit stamps every sound with the frame it sounded on and pushes it into
  // the sinks it holds. Orrery's cue carries two more fields — the name, and
  // whether it looped — so this harness keeps sinks of its own and drains the
  // kit's into them after every drive, filling the two the engineless runtime
  // cannot answer with what it honestly knows: `null` and `false`. See
  // `scenario.ts`'s `TimedCue` for why that is the strongest reading here.
  const kitSink: KitCue[] = [];
  base.cues.push(kitSink);
  const cues: TimedCue[][] = [];
  const drain = (): void => {
    for (const played of kitSink) {
      const entry: TimedCue = {
        frame: played.frame,
        t: played.t,
        cue: null,
        looping: false,
      };
      for (const sink of cues) sink.push(entry);
    }
    kitSink.length = 0;
  };

  const view = fitViewport(
    options.cssWidth ?? STAGE_W,
    options.cssHeight ?? STAGE_H,
    options.dpr ?? 1,
  );

  const advance = async (frames = 1): Promise<void> => {
    await base.advance(frames);
    drain();
  };

  /**
   * Let the build's OWN frame loop run once, so it reads the input just given.
   *
   * WHY A DRIVEN FRAME IS NOT ENOUGH HERE, AND IS UNDER EITHER ENGINE. Under no
   * engine the keyboard and the pointer belong to the runtime layer the build
   * wrote, and `specs/instrumentation.md` says exactly what the clock switch does
   * and does not touch: "Drawing and input are unaffected by the switch either
   * way: the loop keeps rendering and keeps reading the keys, so a menu still
   * answers a key press while the simulation is held." So the loop is what
   * delivers a press, and `advance` is only obliged to run "the same update the
   * loop runs followed by a render" — a build that reads its input in the loop
   * alone is conformant, and so is one that also reads it inside `advance`.
   *
   * Every input helper below therefore does BOTH, in this order: one driven frame
   * with the key or button still down, so a build that reads input inside
   * `advance` sees it, and then one real animation frame, so a build that reads it
   * in its own loop sees it. Neither costs the simulation anything it did not ask
   * for: with the clock switch off the loop's frame advances no game time at all.
   */
  const deliverInput = (): Promise<void> =>
    base.page
      .evaluate(
        () =>
          new Promise<void>((done) => {
            // Two frames, not one. A callback registered here runs in the next
            // frame alongside the build's own, and the order of the two is the
            // order they were registered in, which this side does not control.
            // Waiting for the frame after guarantees the build's loop has run a
            // whole frame with the key or button still down.
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                done();
              });
            });
          }),
      )
      .then(() => undefined);

  const harness: Harness = {
    debug: base.debug,
    surfaceFault: base.surfaceFault,
    cues,
    assetFailures,
    pageErrors: base.pageErrors,

    frame: () => base.frame(),
    timeMs: () => base.timeMs(),

    snapshot: () => base.snapshot(),
    advance,
    async advanceSeconds(seconds, frames = 1) {
      const count = Math.max(1, Math.floor(frames));
      clock.set((seconds * 1000) / count);
      try {
        await base.advance(count);
      } finally {
        clock.set(frameMs);
        drain();
      }
    },
    async step(frames = 1) {
      const snapshot = await base.step(frames);
      drain();
      return snapshot;
    },
    async skip(frames = 1) {
      await base.skip(frames);
      drain();
    },
    async until(predicate, untilOptions) {
      const result = await base.until(predicate, untilOptions);
      drain();
      return result;
    },
    async stepWatching(count, watch) {
      const seen = await base.stepWatching(count, watch);
      drain();
      return seen;
    },
    async runFor(ms) {
      await base.runFor(ms);
      drain();
    },

    hold: (code) => base.hold(code),
    release: (code) => base.release(code),
    async tap(code) {
      // Down, ONE driven frame, ONE of the build's own frames, up. Both frames
      // pass with the key still down, so whichever of the two conformant designs
      // the build chose has read it by the time this returns — see
      // `deliverInput`. Exactly one frame of SIMULATION passes either way, which
      // is what a caller counting frames is counting.
      await base.hold(code);
      await advance(1);
      await deliverInput();
      await base.release(code);
      return base.snapshot();
    },
    async holdFor(code, frames) {
      await base.hold(code);
      try {
        await advance(frames);
        await deliverInput();
      } finally {
        await base.release(code);
      }
      return base.snapshot();
    },

    async mousePress(x, y) {
      const at = base.css(x, y);
      await base.page.mouse.move(at.x, at.y);
      await base.page.mouse.down();
      await advance(1);
      await deliverInput();
    },
    async mouseGlide(x, y) {
      const at = base.css(x, y);
      await base.page.mouse.move(at.x, at.y);
      await advance(1);
      await deliverInput();
    },
    async mouseRelease() {
      await base.page.mouse.up();
      await advance(1);
      await deliverInput();
    },

    async frameCalls() {
      const calls = await base.frameCalls();
      drain();
      return calls;
    },
    lastCalls: () => base.lastCalls(),

    viewport: () => ({ ...view }),
    device: (x, y) => toDevice(view, x, y),
    css: (x, y) => toCss(view, x, y),
    pixel: (x, y) => base.pixel(x, y),
    pixels: (points) => base.pixels(points),
    pixelRect: (x, y, width, height) => base.pixelRect(x, y, width, height),
    imagePixels: (id) => base.imagePixels(id),
    surface: () => base.surface(),

    sounds: () => base.sounds(),
    loopingSounds: () => base.loopingSounds(),
    loopStarts: () => base.loopStarts(),
    probe: (names) => base.probe(names),

    dispose: () => base.dispose(),

    page: base.page,
    kitHarness: base,
  };

  return harness;
}

/**
 * Reload the page with every request matching `pattern` refused, and put the game
 * back where a fresh harness leaves it.
 *
 * The route has to be installed BEFORE the document loads, and the kit's factory
 * navigates as it opens, so the page is routed and then reloaded. The two calls
 * the kit's opening makes — off the wall clock, and back to the title — are made
 * again afterwards, because the reload undid them.
 */
async function withheldAssets(
  base: KitHarness<OrrerySnapshot, OrrerySurface>,
  pattern: RegExp,
): Promise<void> {
  await base.page.route(
    (url) => pattern.test(url.pathname),
    (route) => route.abort(),
  );
  await base.page.reload({ waitUntil: "load" });
  await base.page
    .waitForFunction(
      (handle) =>
        (window as unknown as Record<string, unknown>)[handle] !== undefined,
      ORRERY_SURFACE_KEY,
      { timeout: base.config.surfaceTimeoutMs },
    )
    .catch(() => undefined);
  if (base.surfaceFault !== null) return;
  await base.debug.setAutoStep?.(false);
  await base.debug.reset();
}

/* -------------------------------------------------------------------------- */
/* Media                                                                      */
/* -------------------------------------------------------------------------- */
//
// A review item may declare an `image` or a `replay` output beside its verdict:
// the picture the build drew at the moment the check was about, or the frames it
// drew while the check drove it. Both are EVIDENCE, never a verdict — the
// scenario's own value comes straight back, a scenario that throws still leaves
// what it recorded, and outside a run (no `TCAB_VALIDATION_MEDIA_DIR`) the whole
// thing is a no-op that still runs the scenario.
//
// Both helpers carry the same name and the same shape in all three projects.

/**
 * Record the frames `scenario` drives and keep them as the review item's
 * `outputId` output, handing back whatever the scenario returned.
 *
 * Wrap the DRIVE, not the arrangement:
 *
 * ```ts
 * const measured = await captureReplay(h, "carried", () => carryOneMote(h));
 * ```
 *
 * The assertions stay exactly where they were and read exactly what they did.
 */
export function captureReplay<T>(
  h: Harness,
  outputId: string,
  scenario: () => T | Promise<T>,
): Promise<T> {
  return kit.captureReplay(h.kitHarness, outputId, scenario);
}

/**
 * Keep the picture currently on the canvas as the review item's `outputId`
 * output.
 *
 * What is written is whatever the last frame that RAN left behind, so call it
 * after the frame that poses the thing under test and before the assertions, so a
 * check that fails still leaves the picture that shows why.
 */
export function captureStill(h: Harness, outputId: string): Promise<void> {
  return kit.captureStill(h.kitHarness, outputId);
}

/**
 * The two writers a check about a PRODUCED FILE uses instead — `writeMedia` and
 * `writeImageBytes` — come from `media.ts`, which this module re-exports, so a
 * suite reaches every media helper through `../harness` whatever it is writing.
 */

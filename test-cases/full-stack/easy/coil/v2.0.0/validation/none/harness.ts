// Coil — the case's half of the validator harness. CASE-PROVIDED.
//
// Every check in this project is an ordinary vitest test that drives the built
// site IN A REAL BROWSER. There is nothing to import: an engineless run seeds no
// `src/` at all, so the build wrote its own frame loop, its own canvas fit, its
// own keyboard, its own audio, and its own `window.__coil` — and the only place
// all of that exists is a page that has loaded the bundle. So the project serves
// `dist/`, loads it in Chromium, and reaches the game the way anything reaches
// it: over the surface `specs/instrumentation.md` told the build to install.
//
// THE MACHINERY THAT DOES THAT IS NOT COIL'S. Serving the build, connecting to
// the one browser, opening a page per harness, injecting the draw-command
// recorder, bracketing each driven frame around one `advance(dt, 1)` of the
// build's surface, reading pixels and draw calls back out, and writing the
// evidence a review point declares — every engineless case needs exactly that,
// and it lives once, in `@clockwyrks/case-harness`, staged beside this file as
// `./case-harness/`. What is left here is what is genuinely Coil's: the shape of
// its snapshot, the operations `specs/instrumentation.md` requires, the audio
// probe that NAMES a cue, the blit reading that says which produced sprite landed
// on which cell, its tick vocabulary, and the isolated board a scenario poses.
//
// The seam is one call. `createCaseHarness` takes the case's TYPES as type
// arguments and the case's VALUES as one object, and hands back the machinery
// with Coil's names and Coil's types on it. `createHarness` below wraps what
// comes back so that every drive also reads the named-cue log, and the suites
// next door import `createHarness`, `poseScene`, `arrangeEat` and the rest from
// `../harness` without knowing which half of the machinery each belongs to.
//
// IT IS STILL A VITEST PROJECT, AND THAT IS DELIBERATE. The runner locates the
// build output before it chooses between the vitest and browser paths, so `dist/`
// is on disk by the time this project runs. Staying a vitest project is what lets
// the case name ONE script per review item and have it resolve under every engine
// — `validation/turning/reversal-discarded.test.ts` is the same path whichever
// runtime the run selected — and what keeps `format = 2` resolution passing.
//
// THE CLOCK IS THE SURFACE'S. Nothing outside an engineless build owns its loop,
// so `specs/instrumentation.md` puts the clock on the surface: `setAutoStep(false)`
// takes the game off real time and `advance(seconds, frames)` runs whole frames
// of a chosen length. Every harness opens by taking the game off the clock, so a
// check asks for a number of ticks and gets exactly that number — no polling, no
// waiting, and no measurement of the machine it ran on. The one check that is
// ABOUT the loop running itself (`movement/advances-in-real-time`) hands it back
// with `runFor`.
//
// WHERE THE COMPOUND SEQUENCES LIVE. Here, and nowhere else. The debug surface is
// atomic by design — one field, one read, one clock move — so reaching a screen,
// posing a chain, arranging an eat, or filling the board to its last free cell is
// several calls in a fixed order. Each of those orders is written ONCE, in the
// scenario section at the foot of this file, and every suite that needs part of
// one calls the operations it needs instead of restating the whole.
//
// RECONCILING AFTER A POSE. `specs/instrumentation.md`'s `reconcile()` brings
// every reading the surface reports into agreement with the game as it stands,
// without advancing anything — so a build that keeps a reading as a stored copy
// of something a pose can leave behind answers for the world the scene posed
// rather than for the one before it. A helper here that poses anything a reading
// derives from calls it before it returns, so a check that poses through the
// helpers never calls it itself. A check that poses with `h.debug.set…` directly
// and then reads calls it once, before its first read.
//
// EVERYTHING CROSSING INTO THE PAGE IS ASYNC. That is the whole of the difference
// between a suite here and its counterpart under an engine: `await h.snapshot()`
// rather than reading the state in process, `await h.debug.setSnake(cells)`
// rather than posing it in place. The scenarios, the tolerances and the
// assertions are the same ones, because they are the case's rather than the
// runtime's.

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "playwright";
import {
  createCaseHarness,
  imageRef,
  mouseGlide,
  mousePress,
  mouseRelease,
  touchGlide,
  touchPress,
  touchRelease,
  type DrawCall,
  type Harness as BaseHarness,
  type HarnessOptions,
  type Point,
  type Rgb,
  type TextDraw,
  type Viewport,
} from "./case-harness/index";
import {
  IDENTITY,
  apply as applyMatrix,
  numbers,
  transformed,
  type Matrix,
} from "./case-harness/matrix";
import { fail } from "./assert";
import {
  BOARD_X,
  BOARD_Y,
  CELL,
  CUE_NAMES,
  DIRECTIONS,
  INTERIOR_COL_MAX,
  INTERIOR_COL_MIN,
  INTERIOR_ROW_MAX,
  INTERIOR_ROW_MIN,
  OPPOSITE,
  STAGE_H,
  STAGE_W,
  STEP,
  TICK_SECONDS,
  UNBOUND_KEY,
  type Cell,
  type Dir,
  type Screen,
} from "./constants";
import {
  HANDLE,
  OBSTACLE_OPS,
  REQUIRED_OPS,
  type CoilDebugApi,
  type CoilSnapshot,
  type DrivenSurface,
  type MenuRect,
} from "./surface";

export { HANDLE, REQUIRED_OPS, OBSTACLE_OPS };
export type { Cell, CoilSnapshot, CoilDebugApi, DrivenSurface, MenuRect };

/* The readings this project takes straight off the package, under its names. */
export type { DrawCall, HarnessOptions, Point, Rgb, TextDraw, Viewport };
export {
  callsTo,
  colorDistance,
  drawnText,
  setsOf,
  textDraws,
} from "./case-harness/index";
export { closeWorkerBrowser } from "./case-harness/index";

/**
 * The page global the injected draw-command recorder installs itself on.
 *
 * The package's, and shared with every other engineless case: it is the
 * HARNESS's own instrumentation, installed before a line of the build's script
 * runs, and no case's `specs/instrumentation.md` names it. Re-exported because
 * `movement/updates.ts` brackets its own frame boundaries around a delivery this
 * harness does not offer, and it has to reach the same recorder the harness's own
 * drive does or a capture armed around one would keep nothing.
 */
export { RECORDER_GLOBAL } from "./case-harness/index";

/* -------------------------------------------------------------------------- */
/* The step schedule                                                          */
/* -------------------------------------------------------------------------- */
//
// The suite chooses the length of a frame, because the specification deliberately
// fixes none: `specs/movement.md` puts the game on a fixed TICK of
// `TICK_SECONDS`, fed by whatever elapsed time the runtime hands each update and
// carrying the remainder, so a build must reach the same place however that time
// was divided into frames.
//
// The choice here is 64 Hz, and the reason is exactness. A tick is then EIGHT
// frames, a frame is `0.015625` s, and both are exact in binary floating point —
// so a check that asks for twenty-eight ticks of game time hands the build
// exactly `3.5` s of it, and the tick a combo window lapses on is decided by the
// build's arithmetic rather than by the last bit of ours. Every duration this
// specification states is a whole number of these frames: the combo window is
// 224, the bite is 16. The check that is ABOUT the subdivision
// (`movement/subdivision-invariant`) drives the same second under other divisions
// of its own.
//
// A FRAME AND A TICK ARE DIFFERENT UNITS HERE, and every name below says which it
// counts. The package's own tick arithmetic writes `frames` and `ticks` over ONE
// counter — the two words are synonyms there, for the cases whose frame IS their
// tick — so none of it is bound: `FRAMES_PER_TICK` would be `1` under that
// reading and every duration in this project would be eight times short.

/** Frames the harness drives per second of game time. */
export const FRAME_HZ = 64;

/** One frame of game time, in milliseconds. Exact in binary: `15.625`. */
export const FRAME_MS = 1000 / FRAME_HZ;

/** Frames of the harness's clock one tick of the simulation covers. */
export const FRAMES_PER_TICK = Math.round(TICK_SECONDS * FRAME_HZ);

/** Frames covering `ticks` whole ticks of simulation time. */
export function tickFrames(ticks: number): number {
  return ticks * FRAMES_PER_TICK;
}

/** Frames covering `seconds` of simulation time, rounded up to a whole frame. */
export function secondFrames(seconds: number): number {
  return Math.ceil(seconds * FRAME_HZ);
}

/* -------------------------------------------------------------------------- */
/* The harness, bound to this case                                            */
/* -------------------------------------------------------------------------- */

/** This module's directory: the validator project's root. */
const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * The shared harness, with Coil's snapshot, Coil's surface and Coil's figures
 * bound into it.
 *
 * `projectRoot` comes from THIS module and must never come from the package's:
 * the package is staged one directory deeper than this file, and a produced
 * replay or still is addressed by the running suite's path relative to the
 * project root. Taken from the package it would address every output one level
 * too deep — and silently, because a writer that raised on a failed write would
 * be blaming the build for the host's problem, so neither of them raises.
 */
const kit = createCaseHarness<CoilSnapshot, DrivenSurface>({
  slug: "coil",
  handle: HANDLE,
  requiredOps: REQUIRED_OPS,
  // `advance(seconds, frames)`: a span of simulated time divided into whole
  // frames, so the suite's clock decides how long a frame is. The two obstacle
  // operations are deliberately in NEITHER list — they are laid by an
  // obstacle-placing mode alone, so their absence is a fault only in a build
  // whose snapshot reports such a mode, which is what {@link obstacleSurface}
  // decides at the one moment the mode is known.
  step: { kind: "seconds-frames", op: "advance" },
  stage: { width: STAGE_W, height: STAGE_H },
  // The rate a second of simulated time is counted at, which for this project is
  // the FRAME rate rather than the tick rate: a tick is FRAMES_PER_TICK of these.
  tickHz: FRAME_HZ,
  // A GENUINE browser gesture, so the build's audio can open: a build is free to
  // open its audio context from a real DOM event alone (both are conformant), so
  // a key delivered any other way would leave a perfectly good build silent.
  // `UNBOUND_KEY` is bound to nothing (specs/controls.md), so arming changes no
  // game state. Coil arms from `Harness.armAudio` at a moment the check chooses
  // rather than from `HarnessOptions.armAudio`, because the wait for the cue
  // FILES belongs beside it — see {@link waitForCues}.
  arm: { kind: "key", code: UNBOUND_KEY },
  // `specs/ui.md` gives every menu a touch contact as well as a pointer, so the
  // device the build believes it is running on has to report a touchscreen:
  // without it `navigator.maxTouchPoints` is zero and a dispatched contact
  // arrives as a mouse.
  hasTouch: true,
  // The copy readings place a run at its anchor and read the LOGICAL runs a
  // frame spells, so every text call is measured in the page — width and
  // alignment under the build's own font — and side-by-side glyphs on one
  // baseline coalesce back into the string they spell (`case-harness/text.ts`).
  measureText: true,
  // This case's own audio probe, beside the kit's two. The kit's probe at
  // `__tcabAudio` COUNTS sounds, which is enough for a case whose audio points
  // ask whether a frame sounded; Coil's ask WHICH of four cues sounded and
  // whether the bed is running, so a second probe names each sound by the
  // produced file it played (`specs/assets.md` fixes the file per cue) and every
  // drive below reads its log.
  extraInitScripts: ["audio-init.js"],
  projectRoot: PROJECT_ROOT,
});

export const { fitViewport, failSurface, SURFACE_REQUIREMENT } = kit;

/* -------------------------------------------------------------------------- */
/* Evidence capture                                                           */
/* -------------------------------------------------------------------------- */
//
// A review item may declare a `replay` OUTPUT beside its verdict: the frames the
// build itself drew while a check drove it, kept as evidence a reviewer can scrub
// and compare against the reference implementation's. Both writers are the
// package's, bound here to this case's own `Harness` — which replaces two of the
// package's members (see its declaration) and so is not the package's contract,
// even though it is the same object.
//
// Both are evidence, never a verdict: the scenario's own value comes straight
// back, a scenario that throws still leaves what it had recorded, a capture that
// closed no frames writes nothing, and outside a run the media directory is unset
// and the whole thing is a no-op that still runs the scenario.

/** The package's writers, as this case's `Harness` calls them. */
type PackageHarness = Parameters<typeof kit.captureStill>[0];

/**
 * Record the frames `scenario` drives and keep them as the review item's
 * `outputId` output, handing back whatever the scenario returned.
 *
 * Wrap the drive, not the arrangement:
 *
 * ```ts
 * const after = await captureReplay(h, "eat", () => h.tick());
 * assertEqual(after.score, PELLET_POINTS);
 * ```
 *
 * The assertions stay exactly where they were and read exactly what they did.
 */
export function captureReplay<T>(
  h: Harness,
  outputId: string,
  scenario: () => T | Promise<T>,
): Promise<T> {
  return kit.captureReplay(h as unknown as PackageHarness, outputId, scenario);
}

/**
 * Keep the picture currently on the canvas as the review item's `outputId`
 * output.
 *
 * The companion to {@link captureReplay}, for a point whose evidence is one
 * PICTURE rather than a stretch of motion: which screen the game opened on, what
 * colour it drew a pellet, where the letterbox bars fell. What is written is
 * whatever the last frame that RAN left behind, so call it after the frame that
 * poses the thing under test and before the assertions, so a check that fails
 * still leaves the picture that shows why.
 */
export function captureStill(h: Harness, outputId: string): Promise<void> {
  return kit.captureStill(h as unknown as PackageHarness, outputId);
}

/* -------------------------------------------------------------------------- */
/* Named cues                                                                 */
/* -------------------------------------------------------------------------- */
//
// WHAT IS OBSERVED, AND WHY IT IS THE FAIR READING. `specs/ui.md` requires one
// cue per event, played on the tick its event resolves, and names the four:
// `eat`, `combo-up`, `death`, and a looping `music`. It says nothing about how a
// build makes a sound — under this engine the whole audio layer is the build's —
// but `specs/assets.md` DOES fix the file behind each cue, so `audio-init.js`
// carries the file's name from the fetch, through the decode, to the source that
// plays it. A check therefore reads which cue sounded, not merely that something
// did, which is the reduction the kit's own counting probe would have to accept.
//
// A sound whose file cannot be named arrives with a `name` of `null` and is still
// recorded, so a build's own synthesized flourish is never mistaken for one of
// the four and never silently dropped.
//
// WHAT A DRIVE ATTRIBUTES. The log is read after each drive and everything it
// gained is stamped with the LAST frame that drive ran. A drive of one frame is
// therefore exact, and a drive of several says the sound happened somewhere
// inside it — which is the whole of what one crossing can honestly report, and
// what every check here asserts: a cue sounded after the last quiet frame and no
// later than the last frame of the tick it belongs to.
//
// A SOUND PLAYED OUTSIDE A DRIVEN FRAME BELONGS TO THE LAST FRAME DRIVEN. The
// build's own animation frame keeps running while the simulation is held off the
// wall clock — `specs/instrumentation.md` says so, because a menu still has to
// answer a key press with the game stopped — so an action a check taps can be
// drained by the build's own frame rather than by the one the harness drove a
// moment later. Attributing those to the frame count as it stands is exact where
// it matters and never loses a sound.

/**
 * The page global this case's own audio probe installs itself on.
 *
 * The HARNESS's instrumentation, injected by `audio-init.js` before a line of the
 * build runs; no seeded specification names it, and nothing here is ever seeded
 * into a run.
 */
export const AUDIO_PROBE_GLOBAL = "__coilAudio";

/**
 * How long {@link Harness.armAudio} waits for the build's cues to decode.
 *
 * Short, because it is paid in full by a build that decodes nothing — one that
 * synthesizes its sound, or plays it through an `<audio>` element, or ships none
 * at all — and none of those is a build this wait can help. A build that does
 * decode its files off a loopback server is ready in a few milliseconds, and this
 * returns the instant it is.
 */
export const AUDIO_LOAD_TIMEOUT_MS = 2_000;

/** One sound, as `audio-init.js` logs it. */
export interface Sound {
  /**
   * The cue, named from the file the sound came from, or `null` for a sound
   * whose file could not be named. See `audio-init.js`.
   */
  name: string | null;
  /** The URL the sound's bytes came from, where there was one. */
  url: string | null;
  /** Whether the source was asked to loop, which is what `music` is. */
  loop: boolean;
}

/** A cue the build played, and the frame of the drive it played it on. */
export interface TimedCue extends Sound {
  /** The frame it sounded on, 1-based, as {@link Harness.frame} reports. */
  frame: number;
  /** The frame loop's simulated time at that frame, in milliseconds. */
  t: number;
}

/** The named-cue log's state, per harness. */
interface CueLog {
  /** How many sounds the probe held when this log last read it. */
  cursor: number;
  /** Where {@link watchCues} attaches. */
  sinks: TimedCue[][];
}

/** The probe's shape, as far as this side reads it. */
interface AudioProbe {
  count(): number;
  since(from: number): Sound[];
  decoded(): string[];
  looping(): string[];
}

/** Each harness's named-cue log, kept off the object so a spread carries it. */
const cueLogs = new WeakMap<object, CueLog>();

/** The named-cue log of a harness this case's `createHarness` made. */
function cueLogOf(h: Harness): CueLog {
  const log = cueLogs.get(h);
  if (log === undefined) {
    fail(
      "a harness made by this case's createHarness, which keeps the named-cue log",
      "a harness with no log",
    );
  }
  return log;
}

/** Call one operation of the probe in the page, and answer what it returned. */
function probeAudio<T>(
  page: Page,
  op: keyof AudioProbe,
  ...args: unknown[]
): Promise<T> {
  return page.evaluate(
    ([global, name, rest]) => {
      const audio = (
        window as unknown as Record<
          string,
          Record<string, (...a: unknown[]) => unknown>
        >
      )[global];
      if (audio === undefined) {
        throw new Error(`coil: the audio probe ${global} is not installed`);
      }
      return audio[name]!(...rest) as T;
    },
    [AUDIO_PROBE_GLOBAL, op, args] as const,
  );
}

/** Wait, under a bound, for every one of the four cue files to decode. */
async function waitForCues(page: Page): Promise<void> {
  await page
    .waitForFunction(
      ([global, wanted]) => {
        const audio = (window as unknown as Record<string, AudioProbe>)[global];
        if (audio === undefined) return false;
        const held = audio.decoded();
        return wanted.every((name) => held.includes(name));
      },
      [AUDIO_PROBE_GLOBAL, [...CUE_NAMES]] as const,
      { timeout: AUDIO_LOAD_TIMEOUT_MS, polling: 25 },
    )
    .catch(() => undefined);
}

/**
 * Stamp what the probe logged since the log's last read with the frame the drive
 * ended on, and hand it to every watcher.
 *
 * Nothing is read when no watcher is attached, so a check that never asks about
 * audio pays no extra crossing.
 */
async function settleCues(
  page: Page,
  log: CueLog,
  frame: number,
  timeMs: number,
): Promise<void> {
  if (log.sinks.length === 0) return;
  const read = (await page.evaluate(
    ([global, from]) => {
      const audio = (window as unknown as Record<string, AudioProbe>)[global];
      return { plays: audio.since(from), count: audio.count() };
    },
    [AUDIO_PROBE_GLOBAL, log.cursor] as const,
  )) as { plays: Sound[]; count: number };
  log.cursor = read.count;
  for (const play of read.plays) {
    for (const sink of log.sinks) sink.push({ ...play, frame, t: timeMs });
  }
}

/**
 * Record every cue the build plays from now on, stamped with the frame of the
 * drive it played on and named by the file it came from.
 */
export function watchCues(h: Harness): TimedCue[] {
  const played: TimedCue[] = [];
  cueLogOf(h).sinks.push(played);
  return played;
}

/** Every recorded play of the cue `name`, in the order they sounded. */
export function cuesNamed(cues: readonly TimedCue[], name: string): TimedCue[] {
  return cues.filter((cue) => cue.name === name);
}

/** Every recorded play that fell on frame `frame` of the drive. */
export function cuesOnFrame(
  cues: readonly TimedCue[],
  frame: number,
): TimedCue[] {
  return cues.filter((cue) => cue.frame === frame);
}

/* -------------------------------------------------------------------------- */
/* What a check holds                                                         */
/* -------------------------------------------------------------------------- */

/**
 * How far a sweep may run, IN WHOLE TICKS.
 *
 * Coil's own, and deliberately not the package's `UntilOptions`. A tick of this
 * game is {@link FRAMES_PER_TICK} frames, and the package's sweep counts FRAMES
 * under both of its names — so a bound stated there would run this game an eighth
 * of the distance a suite asked for, silently, and a sweep that was meant to
 * reach a death would report that it never happened.
 */
export interface UntilOptions {
  maxTicks?: number;
}

/** What a sweep found: whether the predicate ever held, and where it stopped. */
export interface UntilResult {
  hit: boolean;
  /** WHOLE TICKS driven before the sample that ended the sweep. */
  ticks: number;
  snapshot: CoilSnapshot;
}

/** What one frame's render issued: its operations, and its bitmap blits. */
export interface FrameDraw {
  calls: DrawCall[];
  blits: Blit[];
}

/** Everything this case's harness carries past the package's own contract. */
interface CoilModel {
  /** Run `ticks` whole ticks of simulation time, and read what they left. */
  tick(ticks?: number): Promise<CoilSnapshot>;
  /** Drive a TICK at a time until `predicate` holds, or the budget is spent. */
  until(
    predicate: (snapshot: CoilSnapshot) => boolean,
    options?: UntilOptions,
  ): Promise<UntilResult>;

  /** Run exactly one frame and hand back everything its render issued. */
  frameDraw(): Promise<FrameDraw>;
  /** Run exactly one frame and hand back the bitmaps it blitted. */
  frameBlits(): Promise<Blit[]>;

  /**
   * Give the build a real, browser-trusted gesture, so its audio can open.
   *
   * Two things, in this order, and each of them is something a build is entitled
   * to make a check wait for. The FILES first: a build fetches and decodes its
   * cues after the page has loaded (`specs/assets.md` puts the four `.wav`s under
   * `assets/` and has the build load them itself), so a check that drove the game
   * the instant the page settled could reach the eat before the eat's own clip
   * had arrived and read silence from a build that is simply still starting up.
   * The wait is BOUNDED and never fails. Then the kit's arming gesture: a real
   * key press, on a key bound to nothing, so arming changes no game state.
   */
  armAudio(): Promise<void>;

  /**
   * Whether the build has the cue `name` sounding as a loop at this moment.
   *
   * `audio-init.js` holds each looping source from the moment it starts until
   * something ends it, so this is a reading of what is playing NOW rather than of
   * what was once asked for. {@link watchCues} records the other thing: the
   * moments a cue was ASKED for. A bed that was started and never stopped shows
   * one entry in the log and reads `true` here.
   */
  looping(name: string): Promise<boolean>;
}

/**
 * Everything a check reads off one page running this build.
 *
 * TWO OF THE PACKAGE'S MEMBERS ARE REPLACED RATHER THAN JOINED, because this
 * case's word for them means something else. The package's `tick()` is its
 * `frame()` under a second name — one counter, two vocabularies — where Coil's
 * `tick(ticks)` DRIVES whole ticks of the simulation, each {@link FRAMES_PER_TICK}
 * frames; and the package's `until` counts its bound in frames under both of its
 * names, where Coil's counts it in ticks. Left joined, an intersection would
 * resolve each call to the package's member and a sweep asked for 400 ticks would
 * run 400 frames.
 */
export type Harness = Omit<
  BaseHarness<CoilSnapshot, DrivenSurface>,
  "tick" | "until"
> &
  CoilModel;

/**
 * The value in force on the page's canvas at this moment.
 *
 * Read before a frame is driven, so {@link blitsOf} starts its walk from the flag
 * the frame OPENED under: `imageSmoothingEnabled` is context state that survives
 * every frame boundary, so a build that sets it once when it starts and never
 * again has it in force on every frame after, and a walk that assumed the
 * canvas's own default would report every one of those blits as smoothed.
 */
async function smoothingNow(page: Page): Promise<boolean> {
  const read = await page.evaluate(() => {
    const canvases = Array.from(document.querySelectorAll("canvas"));
    let canvas = canvases[0];
    if (canvas === undefined) return null;
    for (const other of canvases) {
      if (other.width * other.height > canvas.width * canvas.height) {
        canvas = other;
      }
    }
    const ctx = canvas.getContext("2d");
    return ctx === null ? null : ctx.imageSmoothingEnabled;
  });
  // A page with no canvas, or none that answers a 2D context, is a build the
  // pixel checks fail on their own terms; the canvas's own default is the honest
  // answer for a frame that drew nothing.
  return read ?? true;
}

/**
 * Open a page on the build, take the game off its own clock, and give every drive
 * the named-cue log.
 *
 * The kit's harness does everything but the log and the tick vocabulary. What
 * comes back here is that harness with every member that runs frames wrapped so
 * that, once a watcher is attached, the sounds the probe logged during the drive
 * are stamped with the drive's last frame and handed to every watcher. Nothing is
 * read when no watcher is attached, so a check that never asks about audio pays
 * no extra crossing.
 */
export async function createHarness(
  options?: HarnessOptions,
): Promise<Harness> {
  const base = await kit.createHarness(options);
  const log: CueLog = { cursor: 0, sinks: [] };

  /** Run `drive`, then settle the sounds it produced onto its last frame. */
  const driven = async <T>(drive: () => Promise<T>): Promise<T> => {
    const result = await drive();
    await settleCues(base.page, log, base.frame(), base.timeMs());
    return result;
  };

  /** Drive one frame and answer what its render issued. */
  const oneFrame = async (): Promise<FrameDraw> => {
    const smoothing = await smoothingNow(base.page);
    const calls = await driven(() => base.frameCalls());
    return { calls, blits: blitsOf(calls, smoothing) };
  };

  const h: Harness = {
    ...base,

    advance: (count) => driven(() => base.advance(count)),
    step: (count) => driven(() => base.step(count)),
    skip: (count) => driven(() => base.skip(count)),
    advanceSeconds: (span, frames) =>
      driven(() => base.advanceSeconds(span, frames)),
    skipSeconds: (span, frames) => driven(() => base.skipSeconds(span, frames)),
    stepUntil: (predicate, untilOptions) =>
      driven(() => base.stepUntil(predicate, untilOptions)),
    skipUntil: (predicate, untilOptions) =>
      driven(() => base.skipUntil(predicate, untilOptions)),
    runFor: (ms) => driven(() => base.runFor(ms)),
    tap: (code) => driven(() => base.tap(code)),
    holdFor: (code, count) => driven(() => base.holdFor(code, count)),
    clickPointer: (x, y, button) =>
      driven(() => base.clickPointer(x, y, button)),
    frameCalls: () => driven(() => base.frameCalls()),

    tick: async (ticks = 1) => {
      await driven(() => base.advance(tickFrames(ticks)));
      return base.snapshot();
    },

    async until(predicate, untilOptions = {}) {
      const maxTicks = untilOptions.maxTicks ?? 400;
      let snapshot = await base.snapshot();
      if (predicate(snapshot)) return { hit: true, ticks: 0, snapshot };
      for (let ticks = 1; ticks <= maxTicks; ticks += 1) {
        snapshot = await driven(() => base.step(FRAMES_PER_TICK));
        if (predicate(snapshot)) return { hit: true, ticks, snapshot };
      }
      return { hit: false, ticks: maxTicks, snapshot };
    },

    frameDraw: () => oneFrame(),
    frameBlits: async () => (await oneFrame()).blits,

    async armAudio() {
      await waitForCues(base.page);
      await base.armAudio();
    },

    async looping(name) {
      const sounding = await probeAudio<string[]>(base.page, "looping");
      return sounding.includes(name);
    },
  };

  cueLogs.set(h, log);
  return h;
}

/* -------------------------------------------------------------------------- */
/* The board's geometry                                                       */
/* -------------------------------------------------------------------------- */

/** The logical centre of cell `(col, row)`, as `specs/board.md` places it. */
export function cellCenter(col: number, row: number): Point {
  return {
    x: BOARD_X + col * CELL + CELL / 2,
    y: BOARD_Y + row * CELL + CELL / 2,
  };
}

/** Whether `(col, row)` is an interior cell, which is any cell not a wall cell. */
export function isInterior(col: number, row: number): boolean {
  return (
    col >= INTERIOR_COL_MIN &&
    col <= INTERIOR_COL_MAX &&
    row >= INTERIOR_ROW_MIN &&
    row <= INTERIOR_ROW_MAX
  );
}

/** Whether the two name the same cell. */
export function sameCell(a: Cell, b: Cell): boolean {
  return a.col === b.col && a.row === b.row;
}

/** Whether `cells` holds `cell`. */
export function holdsCell(cells: readonly Cell[], cell: Cell): boolean {
  return cells.some((held) => sameCell(held, cell));
}

/** The cell `n` steps along `dir` from `cell`. */
export function ahead(cell: Cell, dir: Dir, n = 1): Cell {
  return {
    col: cell.col + STEP[dir].col * n,
    row: cell.row + STEP[dir].row * n,
  };
}

/**
 * A straight chain of `length` cells with its head at `head`, laid out behind it.
 *
 * The body trails OPPOSITE `dir`, which is where a snake that arrived travelling
 * that way left it, so the chain a check poses is one the game could have reached
 * by playing. `specs/board.md` requires each cell after the first to be
 * orthogonally adjacent to the one before it, which this satisfies by
 * construction.
 */
export function chainFrom(head: Cell, dir: Dir, length: number): Cell[] {
  const back = OPPOSITE[dir];
  const cells: Cell[] = [];
  for (let i = 0; i < length; i += 1) cells.push(ahead(head, back, i));
  return cells;
}

/**
 * A cell of the wall border, on the left edge halfway down.
 *
 * `specs/board.md` makes the border one cell thick on all four sides, so column
 * `0` is border at every row, and the mid-height row is as far from a corner as
 * the board goes.
 */
export const WALL_CELL: Cell = {
  col: 0,
  row: Math.floor((INTERIOR_ROW_MIN + INTERIOR_ROW_MAX) / 2),
};

/**
 * An interior cell the posed board leaves empty: no snake segment, no pellet, no
 * obstacle, and none of `exclude`.
 *
 * Scanned in a fixed order from the board's top-left, so the same posed scene
 * always yields the same cell and a failing check replays. A board with no empty
 * interior cell at all is the board-cleared ending rather than a scene a check
 * samples, so finding none fails loudly here rather than returning a cell that is
 * not empty.
 */
export function emptyInteriorCell(
  snapshot: CoilSnapshot,
  exclude: readonly Cell[] = [],
): Cell {
  for (let row = INTERIOR_ROW_MIN; row <= INTERIOR_ROW_MAX; row += 1) {
    for (let col = INTERIOR_COL_MIN; col <= INTERIOR_COL_MAX; col += 1) {
      const cell = { col, row };
      if (holdsCell(snapshot.snake, cell)) continue;
      if (snapshot.pellet !== null && sameCell(snapshot.pellet, cell)) continue;
      if (holdsCell(snapshot.obstacles, cell)) continue;
      if (holdsCell(exclude, cell)) continue;
      return cell;
    }
  }
  return fail(
    "an empty interior cell on the posed board",
    "every interior cell carries the snake, the pellet or an obstacle",
  );
}

/**
 * Every interior cell in one contiguous path, row by row and alternating
 * direction.
 *
 * A boustrophedon: left to right along row 1, right to left along row 2, and so
 * on. Consecutive cells are orthogonally adjacent within a row by construction,
 * and between rows because a row ends directly above where the next begins — so
 * the whole path is a chain `setSnake` accepts.
 */
export function serpentine(): Cell[] {
  const path: Cell[] = [];
  for (let row = INTERIOR_ROW_MIN; row <= INTERIOR_ROW_MAX; row += 1) {
    const rightwards = (row - INTERIOR_ROW_MIN) % 2 === 0;
    for (let i = INTERIOR_COL_MIN; i <= INTERIOR_COL_MAX; i += 1) {
      const col = rightwards ? i : INTERIOR_COL_MAX - (i - INTERIOR_COL_MIN);
      path.push({ col, row });
    }
  }
  return path;
}

/* -------------------------------------------------------------------------- */
/* Blits: which produced sprite landed on which cell                          */
/* -------------------------------------------------------------------------- */
//
// `specs/assets.md` has the snake drawn from produced sprites, one per cell,
// "rotated in quarter turns when it is drawn" and sampled with image smoothing
// off. None of that can be read off the picture: a sprite authored backwards and
// a renderer that turns it backwards compose to the right picture, and a smoothed
// blit of pixel art at the stage's own scale is indistinguishable from an
// unsmoothed one. So a blit is read off the OPERATIONS the frame issued, which is
// where the turn and the flag are.
//
// This is Coil's own reading and stays with the case. The package's `imageDraws`
// walks the same operations for the same three `drawImage` forms, but it answers
// a destination box taken from two corners and carries neither the turn nor the
// smoothing flag — so it is a different reading of the same calls, and folding
// them would drop exactly the two facts the points here are about.

/**
 * How far from an exact quarter turn a transform may sit and still be read as
 * one, in quarter turns.
 *
 * A thousandth of a quarter turn is about a twelfth of a degree: far below
 * anything a build could mean by an orientation, and far above the dust a
 * composition of a letterbox fit, a translate and a rotate leaves behind.
 */
const QUARTER_TOLERANCE = 1e-3;

/**
 * One bitmap the build blitted.
 *
 * `id` is the source's identity: two blits carry the same one exactly when they
 * painted the same picture. It is the source's own `src` where the bundler left
 * one short enough to be a path, and the recorder's per-page identity otherwise —
 * a produced PNG small enough to inline arrives as a `data:` URI a hundred
 * kilobytes long, and a check identifies a sprite by the image drawn and never by
 * matching a path under `assets/`. `""` names a call whose first argument the
 * recorder did not recognize as a bitmap source at all.
 *
 * The rectangle is in DEVICE pixels, mapped through the transform in force at the
 * call, and `x + w / 2, y + h / 2` is its centre under any transform the build
 * drew under.
 */
export interface Blit {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Whether image smoothing was on at the moment of this blit. */
  smoothing: boolean;
  /**
   * The quarter turns the blit carried the sprite's OWN `+x` axis through, or
   * `null` when the transform was not a whole number of quarter turns.
   *
   * `0` is the sprite drawn the way it was authored, `1` a quarter turn toward
   * `down`, `2` a half turn, `3` a quarter turn toward `up` — the same order
   * `right`, `down`, `left`, `up` runs in on a y-down canvas. `specs/assets.md`
   * authors each sprite in ONE orientation and has it "rotated in quarter turns
   * when it is drawn", and this is the turn it was drawn under. The picture on
   * the canvas cannot answer that on its own: a sprite authored backwards and a
   * renderer that turns it backwards compose to the right picture, and only the
   * turn itself tells the two halves apart.
   */
  quarterTurns: number | null;
}

/**
 * The quarter turns a transform carries the `+x` axis through, or `null` for a
 * transform that is not a whole number of quarter turns.
 *
 * Read off the LINEAR part alone — the sprite's `+x` axis lands on `(a, b)` — so
 * the translate that puts the sprite on its cell and the uniform scale of the
 * letterbox fit contribute nothing. A reflection is measured the same way and is
 * not rejected here: what a check about facing needs to know is where the edge
 * that was authored on the right ended up, and that is exactly what the image of
 * `+x` says.
 */
function quarterTurnsOf(m: Matrix): number | null {
  const [a, b] = m;
  if (!(Math.hypot(a, b) > 0)) return null;
  const turns = Math.atan2(b, a) / (Math.PI / 2);
  const nearest = Math.round(turns);
  if (Math.abs(turns - nearest) > QUARTER_TOLERANCE) return null;
  return ((nearest % 4) + 4) % 4;
}

/**
 * The destination rectangle of a `drawImage` call, in the space it was issued in,
 * or `null` for a call whose arguments are not one of the three forms.
 *
 * A two-argument placement takes its size from the source, which is why the
 * source's own dimensions are read: a build that blits a sprite at its natural
 * size names no size at all, and the recorder writes that size onto the reference
 * it names the source by.
 */
function destinationOf(
  args: readonly unknown[],
): { x: number; y: number; w: number; h: number } | null {
  const rest = args.slice(1);
  const nine = numbers(rest, 8);
  if (nine !== null) return { x: nine[4], y: nine[5], w: nine[6], h: nine[7] };
  const five = numbers(rest, 4);
  if (five !== null && rest.length === 4) {
    return { x: five[0], y: five[1], w: five[2], h: five[3] };
  }
  const two = numbers(rest, 2);
  if (two === null || rest.length !== 2) return null;
  const ref = imageRef(args[0]);
  return { x: two[0], y: two[1], w: ref?.width ?? 0, h: ref?.height ?? 0 };
}

/**
 * Every bitmap `calls` blitted, as axis-aligned boxes in device pixels.
 *
 * THE FRAME IS WALKED, CARRYING THE TRANSFORM AND THE SMOOTHING FLAG. Both are
 * ordinary context state: `save`/`restore` stack them together, an engineless
 * build issues its own letterbox fit as a `setTransform` the recorder sees, and a
 * renderer draws each sprite under a `translate` and a quarter `rotate` inside a
 * `save`. So the state in force at a call is recovered exactly by replaying the
 * operations the frame issued.
 *
 * `smoothingAtOpen` is the flag in force when the FRAME opened rather than the
 * canvas's own default, because the flag survives every frame boundary: a build
 * that set it once when it started and never again would otherwise have every one
 * of its blits reported as smoothed. {@link Harness.frameBlits} reads it off the
 * page before it drives the frame.
 *
 * The four corners of each destination rectangle are mapped through the transform
 * and the box is taken around them, so a sprite drawn under the quarter turns
 * `specs/assets.md` states still reports the square of the canvas it covered.
 */
export function blitsOf(
  calls: readonly DrawCall[],
  smoothingAtOpen = true,
): Blit[] {
  const blits: Blit[] = [];
  const stack: { matrix: Matrix; smoothing: boolean }[] = [];
  let matrix: Matrix = IDENTITY;
  let smoothing = smoothingAtOpen;

  for (const call of calls) {
    if (call.kind === "set") {
      if (call.property === "imageSmoothingEnabled") {
        smoothing = call.value !== false;
      }
      continue;
    }
    const { method, args } = call;
    if (method === "save") {
      stack.push({ matrix, smoothing });
      continue;
    }
    if (method === "restore") {
      const held = stack.pop();
      matrix = held?.matrix ?? IDENTITY;
      smoothing = held?.smoothing ?? smoothingAtOpen;
      continue;
    }
    const moved = transformed(matrix, method, args);
    if (moved !== null) {
      matrix = moved;
      continue;
    }
    if (method !== "drawImage") continue;
    const box = destinationOf(args);
    if (box === null) continue;
    const ref = imageRef(args[0]);
    const corners = [
      applyMatrix(matrix, box.x, box.y),
      applyMatrix(matrix, box.x + box.w, box.y),
      applyMatrix(matrix, box.x, box.y + box.h),
      applyMatrix(matrix, box.x + box.w, box.y + box.h),
    ];
    const xs = corners.map((corner) => corner.x);
    const ys = corners.map((corner) => corner.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    blits.push({
      id: ref === null ? "" : (ref.src ?? `#${ref.id}`),
      x,
      y,
      w: Math.max(...xs) - x,
      h: Math.max(...ys) - y,
      smoothing,
      quarterTurns: quarterTurnsOf(matrix),
    });
  }
  return blits;
}

/** Where a blit's centre landed, in device pixels. */
export function blitCenter(blit: Blit): Point {
  return { x: blit.x + blit.w / 2, y: blit.y + blit.h / 2 };
}

/**
 * Every blit whose centre landed inside cell `(col, row)`.
 *
 * A sprite covers one cell (`specs/assets.md`), so the cell a blit belongs to is
 * the one its centre falls in — which stays true under the quarter turns that
 * same file has a sprite drawn with, and under whatever fit the build applied.
 */
export function blitsOnCell(
  h: Harness,
  blits: readonly Blit[],
  col: number,
  row: number,
): Blit[] {
  const view = h.viewport();
  const half = (CELL * view.scale) / 2;
  const middle = cellCenter(col, row);
  const at = h.device(middle.x, middle.y);
  return blits.filter((blit) => {
    const centre = blitCenter(blit);
    return (
      Math.abs(centre.x - at.x) <= half && Math.abs(centre.y - at.y) <= half
    );
  });
}

/**
 * The blit that painted cell `(col, row)`, or `null` for a cell no blit landed
 * on.
 *
 * The LAST blit on the cell, for the same reason {@link spriteOnCell} takes it:
 * that is the one a player sees. A check that needs the whole stack has
 * {@link blitsOnCell}.
 */
export function blitOnCell(
  h: Harness,
  blits: readonly Blit[],
  col: number,
  row: number,
): Blit | null {
  const on = blitsOnCell(h, blits, col, row);
  return on.length === 0 ? null : on[on.length - 1]!;
}

/**
 * The identity of the sprite painted on cell `(col, row)`, or `null` for a cell
 * no blit landed on.
 *
 * The LAST blit on the cell, because that is the one a player sees: a build that
 * paints a cell twice has shown the second.
 */
export function spriteOnCell(
  h: Harness,
  blits: readonly Blit[],
  col: number,
  row: number,
): string | null {
  const found = blitsOnCell(h, blits, col, row);
  return found.length === 0 ? null : found[found.length - 1].id;
}

/* -------------------------------------------------------------------------- */
/* Colour                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The colour rendered at the centre of cell `(col, row)`.
 *
 * The centre pixel itself rather than an average over a cluster, because a cell
 * is `CELL` (32) units across: its centre is sixteen units from the nearest
 * edge, far outside any anti-aliased rim, and a build's own ruling or glow at a
 * cell's border cannot reach it.
 */
export async function sampleCell(
  h: Harness,
  col: number,
  row: number,
): Promise<Rgb> {
  const middle = cellCenter(col, row);
  const [r, g, b] = await h.pixel(middle.x, middle.y);
  return { r, g, b };
}

/** The colours at the centres of several cells, in one crossing into the page. */
export async function sampleCells(
  h: Harness,
  cells: readonly Cell[],
): Promise<Rgb[]> {
  const read = await h.pixels(
    cells.map((cell) => cellCenter(cell.col, cell.row)),
  );
  return read.map(([r, g, b]) => ({ r, g, b }));
}

/* -------------------------------------------------------------------------- */
/* The obstacle operations                                                    */
/* -------------------------------------------------------------------------- */

/** The two operations a mode that lays obstacle cells adds to the surface. */
export interface ObstacleSurface {
  clearObstacles(): Promise<void>;
  addObstacle(col: number, row: number): Promise<void>;
}

/** Whether the mode this build ships lays obstacle cells at all. */
export function laysObstacles(snapshot: CoilSnapshot): boolean {
  return snapshot.mode === "maze";
}

/** What each harness's page answered about its obstacle operations. */
const obstacleSurfaces = new WeakMap<object, ObstacleSurface | null>();

/**
 * The obstacle operations, or `null` under a mode that lays no obstacle cell.
 *
 * `specs/instrumentation.md` puts `clearObstacles` and `addObstacle` on the
 * surface of an obstacle-placing mode alone, so their absence is a fault only in
 * a build whose snapshot reports such a mode. This is the one moment the mode is
 * known, so it is where the requirement is decided.
 *
 * Answered once per harness and remembered, because a page runs one build and
 * `specs/mode.md` gives that build one mode for the whole session — and because
 * every posed scene asks, so the two crossings this costs would otherwise be paid
 * a few hundred times over a suite run.
 */
export async function obstacleSurface(
  h: Harness,
): Promise<ObstacleSurface | null> {
  const remembered = obstacleSurfaces.get(h);
  if (remembered !== undefined) return remembered;
  const surface = await readObstacleSurface(h);
  obstacleSurfaces.set(h, surface);
  return surface;
}

async function readObstacleSurface(
  h: Harness,
): Promise<ObstacleSurface | null> {
  const snapshot = await h.snapshot();
  if (!laysObstacles(snapshot)) return null;
  const { ops } = await h.probe(OBSTACLE_OPS);
  const missing = OBSTACLE_OPS.filter((op) => ops[op] !== "function");
  if (missing.length > 0) {
    failSurface(
      `window.${HANDLE} is installed and the build reports the ${snapshot.mode} ` +
        `mode, which lays obstacle cells, but the surface carries no ${missing
          .map((op) => `${op}()`)
          .join(", ")}`,
    );
  }
  const surface = h.debug as unknown as ObstacleSurface;
  return {
    clearObstacles: () => surface.clearObstacles(),
    addObstacle: (col, row) => surface.addObstacle(col, row),
  };
}

/**
 * Take every obstacle cell off the board, under a mode that lays any.
 *
 * A no-op under a mode that lays none, so a scenario that wants an open interior
 * says so once and reads the same board under either build.
 */
export async function clearObstacles(h: Harness): Promise<void> {
  const surface = await obstacleSurface(h);
  if (surface !== null) await surface.clearObstacles();
}

/* -------------------------------------------------------------------------- */
/* Posing a world                                                             */
/* -------------------------------------------------------------------------- */
//
// The surface is atomic — one field, one read, one clock move — so a scenario is
// several calls in a fixed order, and the order matters: an obstacle cannot be
// laid on a cell the snake holds, a pellet cannot be placed on a snake segment or
// an obstacle, and the screen is set last so the tick never runs over a
// half-arranged board. That order is written once, here.
//
// The rule the guide states is that a validator poses an ISOLATED world: it
// clears every entity the requirement is not about and spawns back exactly what
// it is about, and it holds still the faculties the requirement does not
// exercise. `specs/instrumentation.md` gives Coil three switches for that
// (`steering`, `travel`, `pelletRespawn`) and operations that place and remove
// each kind of thing on the board. {@link poseScene} is the one place they are
// spoken in a single breath.

/** A world to pose, one field per thing on the board or switch over it. */
export interface Scene {
  /** The seed `reset` lays the pellet generator with. */
  seed?: number;
  /**
   * The obstacle course: cleared outright, left as the mode lays it, or laid as
   * exactly these cells. Cleared by default — see {@link poseScene}.
   */
  obstacles?: readonly Cell[] | "cleared" | "course";
  /** The chain, head first. */
  snake?: readonly Cell[];
  /** The direction the snake travels in. */
  dir?: Dir;
  /** The live pellet, or `null` for a board with none. */
  pellet?: Cell | null;
  score?: number;
  best?: number;
  /** The multiplier M. */
  combo?: number;
  /** Seconds left on the combo window; `0` is closed. */
  comboWindow?: number;
  /** Whether a steering request is taken and applied. On by default. */
  steering?: boolean;
  /** Whether the head advances and collides. On by default. */
  travel?: boolean;
  /** Whether an eaten pellet is replaced. On by default. */
  pelletRespawn?: boolean;
  /** The screen the world is left on. `playing` by default. */
  screen?: Screen;
  /** The highlighted item, on a screen that carries a menu. */
  menuIndex?: number;
}

/**
 * Reset the game and pose exactly the world `scene` describes, through the
 * surface's atomic operations alone.
 *
 * The reset first, so nothing a previous section left is inherited: the snapshot
 * a scene starts from is a fresh session, on the title, with the starting chain,
 * no pellet, and every switch on. Then, in this order and for the reasons above:
 * the obstacles, the chain, the direction, an emptied turn buffer, the pellet,
 * the figures, the switches, and finally the screen.
 *
 * The turn buffer is emptied whether or not the scene names a direction, because
 * a posed world holds no steering request the scenario did not make.
 *
 * THE OBSTACLE COURSE IS CLEARED UNLESS THE SCENE ASKS FOR IT. A posed world
 * holds what the requirement is about and nothing else, and the course is
 * furniture almost no point is about: a chain a check lays down a column, or a
 * pellet it drops on a cell it chose, must read the same way under a mode that
 * lays a course and one that does not, or the same check decides two different
 * things in two variants. A point that IS about the course says `obstacles:
 * "course"` for the one the mode lays, or names its own cells. Under a mode that
 * lays none this changes nothing.
 *
 * Defaults to the `playing` screen, since that is the only screen a tick resolves
 * on and a scene exists to be ticked; a scenario about a menu names its own.
 */
export async function poseScene(
  h: Harness,
  scene: Scene = {},
): Promise<CoilSnapshot> {
  await h.debug.reset(
    scene.seed === undefined ? undefined : { seed: scene.seed },
  );

  const obstacles = scene.obstacles ?? "cleared";
  if (obstacles !== "course") {
    const surface = await obstacleSurface(h);
    if (surface === null) {
      // A mode that lays no obstacle cell has none to clear and no operation to
      // lay one with, and a scene asking for an empty course already has it.
      if (obstacles !== "cleared" && obstacles.length > 0) {
        return fail(
          "a build whose mode lays obstacle cells, since the scene places some",
          `the build reports the ${(await h.snapshot()).mode} mode, which lays none`,
        );
      }
    } else {
      await surface.clearObstacles();
      if (obstacles !== "cleared") {
        for (const cell of obstacles) {
          await surface.addObstacle(cell.col, cell.row);
        }
      }
    }
  }

  if (scene.snake !== undefined) await h.debug.setSnake(scene.snake);
  if (scene.dir !== undefined) await h.debug.setDirection(scene.dir);
  await h.debug.clearTurns();

  if (scene.pellet !== undefined) {
    if (scene.pellet === null) await h.debug.clearPellet();
    else await h.debug.setPellet(scene.pellet.col, scene.pellet.row);
  }

  if (scene.score !== undefined) await h.debug.setScore(scene.score);
  if (scene.best !== undefined) await h.debug.setBest(scene.best);
  if (scene.combo !== undefined) await h.debug.setCombo(scene.combo);
  if (scene.comboWindow !== undefined) {
    await h.debug.setComboWindow(scene.comboWindow);
  }

  if (scene.steering !== undefined) {
    await h.debug.setSnakeSteering(scene.steering);
  }
  if (scene.travel !== undefined) await h.debug.setSnakeTravel(scene.travel);
  if (scene.pelletRespawn !== undefined) {
    await h.debug.setPelletRespawn(scene.pelletRespawn);
  }

  await h.debug.setScreen(scene.screen ?? "playing");
  if (scene.menuIndex !== undefined) {
    await h.debug.setMenuIndex(scene.menuIndex);
  }
  await h.debug.reconcile();
  return h.snapshot();
}

/**
 * The head cell every posed scenario starts from, unless it names another.
 *
 * Row 8 is the row `specs/board.md` lays the starting chain along, and
 * `specs/mode.md` states that the obstacle course carries none of that row — so a
 * chain laid along it is clear of the board's furniture even in a scene that
 * keeps the course. Column 10 leaves a long runway to the right and room behind
 * for a chain to trail into.
 */
export const HOME_HEAD: Cell = { col: 10, row: 8 };

/** What a posed step left, and the cell the next tick will enter. */
export interface StepScene {
  snapshot: CoilSnapshot;
  head: Cell;
  dir: Dir;
  /** The cell the head advances into on the next tick. */
  next: Cell;
}

/** A posed chain: where its head is, which way it faces, and how long it is. */
export interface StepOptions extends Omit<Scene, "snake" | "dir"> {
  head?: Cell;
  dir?: Dir;
  length?: number;
  /**
   * Ticks of clear travel between the posed head and the moment the scenario is
   * about — the pellet for {@link arrangeEat}, the fatal cell for
   * {@link arrangeApproach}. One by default, which is the moment itself and no
   * run-up at all.
   *
   * A check whose `replay` output has to show the behaviour ARRIVING poses more
   * than one and ticks the difference off inside its recording.
   */
  runUp?: number;
}

/**
 * Pose an isolated chain and say which cell its next tick enters.
 *
 * The single most-used arrangement in this project: nearly every point about
 * movement, turning, growth and collision is "a snake here, facing this way, one
 * tick". What the board holds is the chain and nothing else — the pellet is taken
 * off it and, as {@link poseScene} explains, so is the obstacle course — unless
 * `options` puts something back.
 */
export async function arrangeStep(
  h: Harness,
  options: StepOptions = {},
): Promise<StepScene> {
  const head = options.head ?? HOME_HEAD;
  const dir = options.dir ?? "right";
  const length = options.length ?? 3;
  const snapshot = await poseScene(h, {
    pellet: null,
    ...options,
    snake: chainFrom(head, dir, length),
    dir,
  });
  return { snapshot, head, dir, next: ahead(head, dir) };
}

/** What a posed eat left: the chain, and the pellet the next tick eats. */
export interface EatScene extends StepScene {
  /** The cell the pellet was placed on, which is the head's next cell. */
  pellet: Cell;
}

/**
 * Pose a chain with the pellet `runUp` cells ahead of its head, so the tick after
 * `runUp - 1` ticks of clear travel eats it. One by default: the eat itself.
 *
 * Respawn is off by default, because a check watching one eat should not then be
 * met by a pellet landing on a cell it did not choose — `specs/instrumentation.md`
 * gives the switch for exactly this. A check that is ABOUT the respawn passes
 * `pelletRespawn: true`.
 */
export async function arrangeEat(
  h: Harness,
  options: StepOptions = {},
): Promise<EatScene> {
  const head = options.head ?? HOME_HEAD;
  const dir = options.dir ?? "right";
  const pellet = ahead(head, dir, options.runUp ?? 1);
  const step = await arrangeStep(h, {
    pelletRespawn: false,
    ...options,
    head,
    dir,
    pellet,
  });
  return { ...step, pellet };
}

/**
 * Pose a chain whose head is `runUp` cells from `target`, facing it, so the tick
 * after `runUp - 1` ticks of clear travel enters it.
 *
 * `target` is the fatal cell a collision point is about — a wall cell, an
 * obstacle cell, or a segment of the snake's own body — and `dir` is the
 * direction it is approached from, defaulting to `right`. The head is placed one
 * `runUp` cells short of `target` along that direction — one by default, which
 * is the fatal tick itself — and the chain trails back behind it. The pellet is
 * off the board, so the tick that resolves is the collision alone.
 */
export async function arrangeApproach(
  h: Harness,
  target: Cell,
  options: StepOptions = {},
): Promise<StepScene> {
  const dir = options.dir ?? "right";
  return arrangeStep(h, {
    ...options,
    head: ahead(target, OPPOSITE[dir], options.runUp ?? 1),
    dir,
  });
}

/* -------------------------------------------------------------------------- */
/* Reaching a screen the way a player does                                    */
/* -------------------------------------------------------------------------- */
//
// A point about the menus has to press keys, because the menus are what it is
// about. A point about anything else reaches its screen through `setScreen` and
// never touches a menu — a build with a broken title and a working tick must fail
// the navigation points and pass the movement ones.

/** Reset to a clean title, off the wall clock, with nothing posed on the board. */
export async function openTitle(h: Harness): Promise<CoilSnapshot> {
  await h.debug.reset();
  await h.debug.reconcile();
  return h.snapshot();
}

/**
 * Move the highlight to `index` by pressing `down`, and accept it.
 *
 * `specs/controls.md` moves the highlight one item per press and wraps at the
 * ends, and every screen a menu sits on arrives with `menuIndex` at `0`
 * (`specs/ui.md`), so `index` presses of `down` land on item `index`.
 */
export async function chooseItem(h: Harness, index: number): Promise<void> {
  for (let i = 0; i < index; i += 1) await h.tap("ArrowDown");
  await h.tap("Enter");
}

/**
 * Start a round from the title the way a player does: `confirm` on the first
 * item, which `specs/ui.md` makes the mode's own entry.
 */
export async function startRoundWithKeys(h: Harness): Promise<CoilSnapshot> {
  await openTitle(h);
  await chooseItem(h, 0);
  return h.snapshot();
}

/* -------------------------------------------------------------------------- */
/* The menus, where the build drew them                                       */
/* -------------------------------------------------------------------------- */
//
// `specs/ui.md` gives every menu-bearing screen a pointer and a touch contact as
// well as the keyboard, and deliberately leaves the LAYOUT to the build: what it
// fixes is that the build reports each item's hit region through `menuItemRect`
// (`specs/instrumentation.md`), and that a pointer over that region selects the
// item. So every helper below asks the build where it put the item and then
// drives the real device there. Nothing here knows a menu coordinate, and a build
// that lays its menus out any way it likes passes.
//
// THE DEVICE IS REAL. Chromium's own mouse and its own touch contact, delivered
// to the page, one driven frame per edge — never a position posed through the
// surface, which would tell the build where the pointer is without making the
// build's own input layer see a press, a travel and a lift the way a hand does.
// The three mouse verbs and the three touch verbs are the shared harness
// package's, which is where every engineless case reaches a real device from.

/**
 * The hit region of item `index` on the menu the current screen shows.
 *
 * `menuItemRect` answers `null` on `"playing"`, which shows no menu, and for an
 * index the current menu has no item at, so a check that asked for an item it
 * expects to exist gets a failure naming the reading rather than a `TypeError` on
 * the next line.
 */
export async function menuRect(h: Harness, index: number): Promise<MenuRect> {
  const rect = await h.debug.menuItemRect(index);
  if (rect === null || rect === undefined) {
    fail(
      `menuItemRect(${index}) to report the hit region of item ${index} on the ` +
        "menu the current screen shows, in logical units " +
        "(specs/instrumentation.md)",
      rect,
    );
  }
  return rect;
}

/** The centre of item `index`'s hit region, in logical units. */
export async function menuItemCenter(
  h: Harness,
  index: number,
): Promise<Point> {
  const rect = await menuRect(h, index);
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/**
 * Move the pointer onto item `index` and run the frame that reads it.
 *
 * A move alone, with no button: `specs/ui.md` makes a pointer arriving over an
 * item's region select it, which is the hover a mouse does and the reason this is
 * separate from a click.
 */
export async function hoverMenuItem(h: Harness, index: number): Promise<Point> {
  const at = await menuItemCenter(h, index);
  await mouseGlide(h, at.x, at.y);
  return at;
}

/**
 * Click item `index`: move onto it, press, release.
 *
 * Both edges fall inside the one region, which is what `specs/ui.md` requires of
 * a confirm.
 */
export async function clickMenuItem(h: Harness, index: number): Promise<Point> {
  const at = await menuItemCenter(h, index);
  await mouseGlide(h, at.x, at.y);
  await mousePress(h, at.x, at.y);
  await mouseRelease(h);
  return at;
}

/**
 * Land a touch contact inside item `index`'s region and LEAVE IT DOWN.
 *
 * No move in front of the landing, because a finger does not hover — which is why
 * `specs/ui.md` makes the landing itself select the item. Left down so a check
 * about selection reads what the landing alone did, with no lift to confirm on.
 */
export async function landOnMenuItem(
  h: Harness,
  index: number,
): Promise<Point> {
  const at = await menuItemCenter(h, index);
  await touchPress(h, at.x, at.y);
  return at;
}

/** Land a touch contact inside item `index`'s region and lift it there. */
export async function tapMenuItem(h: Harness, index: number): Promise<Point> {
  const at = await landOnMenuItem(h, index);
  await touchRelease(h);
  return at;
}

/**
 * Press the pointer on item `from`, travel onto item `to`, and release there.
 *
 * The ordinary affordance that lets a player slide off a control to cancel: two
 * edges in different regions confirm nothing (`specs/ui.md`).
 */
export async function slideOffMenuItems(
  h: Harness,
  from: number,
  to: number,
): Promise<void> {
  const start = await menuItemCenter(h, from);
  const end = await menuItemCenter(h, to);
  await mousePress(h, start.x, start.y);
  await mouseGlide(h, end.x, end.y);
  await mouseRelease(h);
}

/** {@link slideOffMenuItems} with a finger: a contact that lifts where it did not land. */
export async function dragOffMenuItems(
  h: Harness,
  from: number,
  to: number,
): Promise<void> {
  const start = await menuItemCenter(h, from);
  const end = await menuItemCenter(h, to);
  await touchPress(h, start.x, start.y);
  await touchGlide(h, end.x, end.y);
  await touchRelease(h);
}

/* -------------------------------------------------------------------------- */
/* Filling the board                                                          */
/* -------------------------------------------------------------------------- */

/** What a board posed one eat short of full left behind. */
export interface FullBoardScene {
  snapshot: CoilSnapshot;
  /** The chain, one cell short of the whole interior. */
  chain: Cell[];
  /** The one free interior cell, holding the pellet. */
  pellet: Cell;
}

/**
 * Pose the board one eat short of full: the snake filling every interior cell
 * but one, and the pellet on that one, directly ahead of the head.
 *
 * The next tick eats it, grows the chain onto the last free cell, and finds no
 * valid cell for the pellet that should follow — which is the board-cleared
 * ending `specs/movement.md` states and `specs/board.md` defines the valid set
 * for.
 *
 * The obstacle course is cleared first, because a course laid across the interior
 * leaves no contiguous path through every remaining cell, and the chain has to be
 * one the game could have grown into. Clearing it also makes the obstacle cells
 * ordinary interior cells (`specs/instrumentation.md`), so the valid set the
 * ending turns on is the whole interior under either mode.
 */
export async function arrangeFullBoard(h: Harness): Promise<FullBoardScene> {
  await h.debug.reset();
  await clearObstacles(h);
  const path = serpentine();
  const pellet = path[0];
  const chain = path.slice(1);
  const head = chain[0];
  const facing = DIRECTIONS.find((dir) => sameCell(ahead(head, dir), pellet));
  await h.debug.setSnake(chain);
  if (facing !== undefined) await h.debug.setDirection(facing);
  await h.debug.clearTurns();
  await h.debug.setPellet(pellet.col, pellet.row);
  await h.debug.setScreen("playing");
  await h.debug.reconcile();
  return { snapshot: await h.snapshot(), chain, pellet };
}

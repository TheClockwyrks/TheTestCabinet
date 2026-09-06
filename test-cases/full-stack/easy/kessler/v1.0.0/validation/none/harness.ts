// Kessler — the case's half of the validator harness. CASE-PROVIDED.
//
// Every check in this project is an ordinary vitest test that drives the built
// site IN A REAL BROWSER. There is nothing to import: an engineless run seeds no
// `src/` at all, so the build wrote its own frame loop, its own canvas fit, its
// own keyboard, its own audio, and its own `window.__kessler` — and the only
// place all of that exists is a page that has loaded the bundle. So the project
// serves `dist/`, loads it in Chromium, and reaches the game the way anything
// reaches it: over the surface `specs/instrumentation.md` told the build to
// install.
//
// THE MACHINERY THAT DOES THAT IS NOT KESSLER'S. Serving the build, connecting
// to the one browser, opening a page per harness, injecting the draw-command
// recorder, bracketing each driven tick around one `step(1)` of the build's
// surface, reading pixels and draw calls back out, and writing the evidence a
// review point declares — every engineless case needs exactly that, and it lives
// once, in `@clockwyrks/case-harness`, staged beside this file as
// `./case-harness/`. What is left here is what is genuinely Kessler's: its
// snapshot and surface types, the polar geometry every rule of the game is
// stated in, the scenario helpers that pose an isolated field, the NAMED cue
// reading its `specs/assets.md` requires, and the blit reading its produced
// sprites are decided on.
//
// The seam is one call. `createCaseHarness` takes the case's TYPES as type
// arguments and the case's VALUES as one object, and hands back the machinery
// with Kessler's names and Kessler's types on it.
//
// WHAT A CHECK READS. The game's own state (through `window.__kessler`'s
// `snapshot`), the ticks the harness itself drove, the operations the build
// issued against its 2D context, the sprites it blitted and where, the pixels
// all of that left on the canvas, and the cues it played. Nothing here
// fabricates an outcome: the scenario helpers below only ARRANGE the world
// through the surface, one atomic operation at a time, and the real tick the
// build wrote is what runs from there.
//
// THE CLOCK IS THE SURFACE'S. Nothing outside an engineless build owns its
// loop, so `specs/instrumentation.md` puts the clock on the surface:
// `setAutoStep(false)` stops the frame loop feeding the wall clock into the
// tick accumulator, and `step(ticks)` runs whole ticks immediately, each the
// full tick followed by a render. Every harness opens by taking the game off
// the clock, so a check asks for a number of ticks and gets exactly that number
// — no polling, no waiting, and no measurement of the machine it ran on. The
// one check that is ABOUT the loop running itself hands it back with
// {@link Harness.runFor}.
//
// WHERE THE COMPOUND SEQUENCES LIVE. Here, and nowhere else. The debug surface
// is atomic by design — one field, one read, one clock move — so posing an
// isolated field, starting a session the way a player does, or arranging a
// bounce is several calls in a fixed order. Each of those orders is written
// ONCE, in the scenario section at the foot of this file, and every suite that
// needs part of one calls the operations it needs instead of restating the
// whole.

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "playwright";
import {
  createCaseHarness,
  drawnText,
  type CaseConfig,
  type DrawCall,
  type Harness as BaseHarness,
  type HarnessOptions as BaseHarnessOptions,
  type Rgb,
  type UntilResult as BaseUntilResult,
} from "./case-harness/index";
import {
  CUE_NAMES,
  MUSIC_PLAY,
  MUSIC_TITLE,
  STAGE_H,
  STAGE_W,
  TICK_HZ,
  UNBOUND_KEY,
  WAVECLEAR_TICKS,
  outwardVelocity,
  pointAt,
  type Screen,
} from "./constants";
import {
  HANDLE,
  REQUIRED_OPS,
  SURFACE_TIMEOUT_MS,
  type DrivenSurface,
  type KesslerDebugApi,
  type KesslerSnapshot,
  type MenuItemRect,
} from "./surface";

export { HANDLE, REQUIRED_OPS };
export type { KesslerSnapshot, KesslerDebugApi, DrivenSurface, MenuItemRect };

/* The readings the package already carries, under the names the suites say. */
export { colorDistance, drawnText, textDraws } from "./case-harness/index";
export type { DrawCall, Rgb, TextDraw, Viewport } from "./case-harness/index";

/** How far a sweep may run. `maxTicks` is the spelling this case counts in. */
export type { UntilOptions } from "./case-harness/index";

/** What a sweep found: whether the predicate ever held, and where it stopped. */
export type UntilResult = BaseUntilResult<KesslerSnapshot>;

/* -------------------------------------------------------------------------- */
/* The harness, bound to this case                                            */
/* -------------------------------------------------------------------------- */

/** This module's directory: the validator project's root. */
const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * How long {@link Harness.armAudio} waits for the build's cues to decode.
 *
 * Short, because it is paid in full by a build that decodes nothing — one that
 * synthesizes its sound, plays through an `<audio>` element, or ships none at
 * all — and none of those is a build this wait can help. A build that does
 * decode its files off a loopback server is ready in a few milliseconds, and
 * this returns the instant it is.
 */
const AUDIO_LOAD_TIMEOUT_MS = 2_000;

/**
 * How far a sweep runs when a check names no bound.
 *
 * Kessler's own figure rather than the package's 600: every sweep in this
 * project is a ball crossing a radius or a timer running out, and the longest
 * of them — the 600-tick pierce arming — is posed rather than swept. Raising the
 * bound would change which builds a sweep reaches a predicate on, so the case's
 * figure travels with the case.
 */
const DEFAULT_MAX_TICKS = 400;

/**
 * Everything the shared harness needs to know about Kessler, bar the one field
 * the two kits below disagree on.
 *
 * The two INJECTED SCRIPTS are the ones the package does not carry, and both are
 * here because this case reads something no shared probe can answer:
 *
 *   - `audio-init.js` names the cue a sound came from, carrying the file's name
 *     from the fetch through the decode to the source that played it. The
 *     package's own probe COUNTS sounds and cannot name them, which is the
 *     honest reading for a case whose specification fixes no files — and
 *     Kessler's fixes thirteen cues and two beds by name (`specs/assets.md`), so
 *     "which cue sounded" is what its review items are worded around. Both
 *     probes stand: the package's under `__tcabAudio`, this one under
 *     `__kesslerAudio`, each wrapping the other's wrapper and neither disturbing
 *     what the other counts.
 *   - `image-init.js` logs every `drawImage` with the source's identity, where
 *     it landed under the transform in force, and the quarter turn it was drawn
 *     through. The recorder writes the console player's replay format, in which
 *     an `<img>` argument is a marker naming its CLASS — so two blits of two
 *     different produced sprites are the same pair of operations there, and "the
 *     sprite on this pod is not the sprite on that one" is unanswerable from the
 *     operation log alone.
 *
 * They run AFTER the package's own instrumentation (`extraInitScripts`), which
 * is where anything that only needs to be ahead of the BUILD belongs; neither
 * needs to hold something the recorder replaces.
 */
const KESSLER: CaseConfig<KesslerSnapshot> = {
  slug: "kessler",
  handle: HANDLE,
  requiredOps: REQUIRED_OPS,
  // `step(ticks)`: a number of whole simulation ticks of the build's OWN fixed
  // length. `specs/instrumentation.md` fixes the tick at 1/60 s and never hands
  // the build a duration, which is what makes this a `"count"` step rather than
  // the `advance(seconds, frames)` the cases that fix a frame's length from
  // outside carry.
  step: { kind: "count", op: "step" },
  stage: { width: STAGE_W, height: STAGE_H },
  tickHz: TICK_HZ,
  // A GENUINE browser gesture, so the build's audio can open: a build is free to
  // open its audio context from a real DOM event alone (both are conformant), so
  // a key delivered any other way would leave a perfectly good build silent.
  // `UNBOUND_KEY` is bound to nothing (specs/controls.md), so arming changes no
  // game state — which is why {@link Harness.armAudio} may deliver it at a
  // moment the harness arranged nothing about.
  arm: { kind: "key", code: UNBOUND_KEY },
  surfaceTimeoutMs: SURFACE_TIMEOUT_MS,
  extraInitScripts: ["audio-init.js", "image-init.js"],
  projectRoot: PROJECT_ROOT,
};

/** The kit every check but one is built from: a device with no touchscreen. */
const kit = createCaseHarness<KesslerSnapshot, DrivenSurface>(KESSLER);

/**
 * The same kit on a context that reports a TOUCHSCREEN.
 *
 * Two kits rather than one, because `hasTouch` is a property of the DEVICE the
 * build believes it is running on: with it on `navigator.maxTouchPoints` is
 * non-zero and a contact arrives as `pointerType: "touch"`, so a build that
 * offers touch controls only on a touch device draws a different screen.
 * `specs/controls.md` requires the menus to answer a touch contact, so the one
 * check that is ABOUT touch asks for it and every other check stays on exactly
 * the context its readings were taken at. The package keys a browser context by
 * the case, the window shape, the scripts AND this flag, so the two kits open
 * two contexts of one browser and share everything else.
 */
const touchKit = createCaseHarness<KesslerSnapshot, DrivenSurface>({
  ...KESSLER,
  hasTouch: true,
});

export const { failSurface, SURFACE_REQUIREMENT } = kit;

/**
 * Record the ticks `scenario` drives and keep them as the review item's
 * `outputId` output, handing back whatever the scenario returned.
 *
 * ```ts
 * const after = await captureReplay(h, "bounce", () => h.tick(30));
 * assertEqual(after.balls.length, 1);
 * ```
 *
 * The kit's own, retyped over {@link Harness}. The retype is what {@link Harness}
 * costs: this case spells the drive `tick(n)` where the package's harness spells
 * a counter `tick()`, so its interface is not the package's — but a capture only
 * ever reaches for the page, which is the same page either way.
 */
export function captureReplay<T>(
  h: Harness,
  outputId: string,
  scenario: () => T | Promise<T>,
): Promise<T> {
  return kit.captureReplay(
    h as unknown as BaseHarness<KesslerSnapshot, DrivenSurface>,
    outputId,
    scenario,
  );
}

/**
 * Keep the picture currently on the canvas as the review item's `outputId`
 * output — for a point whose evidence is one PICTURE rather than a stretch of
 * motion. Call it after the frame that poses the thing under test and before the
 * assertions, so a check that fails still leaves the picture that shows why.
 */
export function captureStill(h: Harness, outputId: string): Promise<void> {
  return kit.captureStill(
    h as unknown as BaseHarness<KesslerSnapshot, DrivenSurface>,
    outputId,
  );
}

/** How a window is asked for, plus the one device property a check varies. */
export interface HarnessOptions extends BaseHarnessOptions {
  /**
   * Whether the browser reports a touchscreen. Off by default — see
   * {@link touchKit} for why this is a kit rather than a page option.
   */
  touch?: boolean;
}

/** One bitmap the build blitted, as `image-init.js` logs it. */
export interface Blit {
  /**
   * The source's identity: two blits carry the same one exactly when they
   * painted the same file.
   */
  id: string;
  /** The destination rectangle, in DEVICE pixels, under the transform in force. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Whether image smoothing was on at the moment of this blit. */
  smoothing: boolean;
  /**
   * The quarter turns the blit carried the sprite's own `+x` axis through, or
   * `null` when the transform was not a whole number of quarter turns — which,
   * in a game whose deflector rides any angle, is ordinary rather than a fault.
   */
  quarterTurns: number | null;
}

/** What one tick's render issued: its operations, and its bitmap blits. */
export interface FrameDraw {
  calls: DrawCall[];
  blits: Blit[];
}

/**
 * A cue the build played, and the tick of the drive it played on.
 *
 * NOT THE PACKAGE'S `TimedCue`, and deliberately: that one carries the frame and
 * the time alone, because the shared audio probe observes that a sound was
 * emitted and cannot say which sound it was. This one names it. See
 * `audio-init.js`.
 */
export interface TimedCue {
  /** The driven tick it sounded on, 1-based, as {@link Harness.tickCount} counts. */
  tick: number;
  /** The drive's simulated time at that tick, in milliseconds. */
  t: number;
  /**
   * The cue, named from the file the sound came from, or `null` for a sound
   * whose file could not be named. See `audio-init.js`.
   */
  name: string | null;
  /** Whether the source was asked to loop, which is what a music bed is. */
  loop: boolean;
  /** The URL the sound's bytes came from, where there was one. */
  url: string | null;
}

/**
 * Everything a check reads off one page running this build.
 *
 * The shared harness's interface with Kessler's types on it, minus the two
 * members this case spells its own way, plus the readings the package cannot
 * take. Every suite next door goes on saying `h.tick(30)`, `h.frameBlits()` and
 * `h.looping(MUSIC_PLAY)` exactly as it did.
 *
 * `tick` IS THE ONE NAME THAT COLLIDES, and it is not folded. The package's
 * `Harness.tick()` is a COUNTER — the frames driven so far, its `frame()` under
 * the word a tick-counting suite uses — while this case's `tick(n)` DRIVES `n`
 * ticks and reads what they left. The two are the package's `tick()` and
 * `step(n)` respectively; binding either name to the other's meaning would
 * silently rewrite a hundred and seventy-seven call sites, so the counter is
 * bound here as {@link tickCount} and the drive keeps the name every suite says.
 */
export interface Harness extends Omit<
  BaseHarness<KesslerSnapshot, DrivenSurface>,
  "tick" | "probe"
> {
  /** The ticks this harness has driven, 1-based as a recorded tick counts. */
  tickCount(): number;
  /** Run `ticks` whole simulation ticks, and read what they left. */
  tick(ticks?: number): Promise<KesslerSnapshot>;
  /** Reset to the boot state through the build's `reset`, and read what it left. */
  reset(): Promise<KesslerSnapshot>;
  /** Let the build's own animation loop run at least one frame of its own. */
  settleFrame(): Promise<void>;
  /** Press a key and leave it down, as a player holding it would. */
  keyDown(code: string): Promise<void>;
  /** Release a key held by {@link keyDown}. */
  keyUp(code: string): Promise<void>;
  /** Run exactly one tick and hand back everything its render issued. */
  frameDraw(): Promise<FrameDraw>;
  /** Run exactly one tick and hand back the bitmaps it blitted. */
  frameBlits(): Promise<Blit[]>;
  /** Reflect the surface without invoking it: `typeof` for each name. */
  probe(names: readonly string[]): Promise<Record<string, string>>;
  /**
   * Whether the build has the cue `name` sounding as a loop at this moment.
   *
   * `audio-init.js` holds each looping source from the moment it starts until
   * something ends it, so this is a reading of what is playing NOW rather than
   * of what was once asked for. {@link onCue} records the other thing: the
   * moments a cue was ASKED for.
   */
  looping(name: string): Promise<boolean>;
}

/** Where {@link onCue} attaches, per harness. */
const harnessCues = new WeakMap<Harness, TimedCue[][]>();

/* -------------------------------------------------------------------------- */
/* Opening one                                                                */
/* -------------------------------------------------------------------------- */

/** One sound, as `audio-init.js` logs it. */
interface Sound {
  name: string | null;
  url: string | null;
  loop: boolean;
}

/**
 * Load the built site in a browser, take the game off the wall clock, and hand
 * back everything a check reads.
 *
 * NAMED `openHarness` RATHER THAN ALIASING THE KIT'S `createHarness`, because it
 * is not the kit's: it opens the page through the kit and then wraps what comes
 * back with the readings above. Every suite's `beforeEach` already says
 * `openHarness`, and a re-export under the package's name would be a second name
 * for a function that is not the package's.
 *
 * The default shape is the stage's own size at one device pixel per CSS pixel,
 * so a logical coordinate and a canvas pixel are the same thing and no check but
 * a window-fit one has to think about the fit at all.
 */
export async function openHarness(
  options: HarnessOptions = {},
): Promise<Harness> {
  const { touch = false, ...pageOptions } = options;
  const base = await (touch ? touchKit : kit).createHarness(pageOptions);
  const { page } = base;

  /** Every watch {@link onCue} opened on this harness. */
  const sinks: TimedCue[][] = [];

  /**
   * How many sounds of the page's log have already been attributed.
   *
   * Kept here rather than in the page because it is a fact about what THIS
   * harness has attributed, and because a sound can be played outside every
   * driven tick — see {@link drainCues}.
   */
  let heard = 0;

  /**
   * Hand every sound played since the last look to every watch, stamped with the
   * drive as it now stands.
   *
   * DRAINED AT THE BOUNDARIES A CHECK READS AT rather than inside each tick, and
   * that is exactly as exact as it needs to be: every audio suite here takes its
   * slices between two drives (`audio/cues.ts`), so the ORDER and the CONTENT of
   * a watch are what its assertions are stated over, and both are the page log's
   * own. The stamp is what the shared driven frame cannot supply — its probe
   * counts sounds rather than naming them — and no check in this project reads a
   * cue's tick.
   *
   * A SOUND PLAYED OUTSIDE A DRIVEN TICK IS STILL RECORDED. The build's own
   * animation frame keeps running while the simulation is held off the wall
   * clock — `specs/instrumentation.md` says so, because a menu still has to
   * answer a key press with the game stopped — and the cues those frames play
   * (`menu-move`, `menu-select`, a bed starting) land between two crossings.
   *
   * NEVER RAISES. This is bookkeeping beside a reading, not a reading: a page
   * that could not answer it must not turn the check that was about to read the
   * game's state into a failure about the harness.
   */
  const drainCues = async (): Promise<void> => {
    const read = (await page
      .evaluate((from) => {
        const audio = (
          window as unknown as {
            __kesslerAudio?: { count(): number; since(n: number): unknown[] };
          }
        ).__kesslerAudio;
        if (audio === undefined) return { sounds: [], count: from };
        return { sounds: audio.since(from), count: audio.count() };
      }, heard)
      .catch(() => null)) as { sounds: Sound[]; count: number } | null;
    if (read === null) return;
    heard = read.count;
    if (sinks.length === 0) return;
    const tick = base.frame();
    const t = base.timeMs();
    for (const sound of read.sounds) {
      for (const sink of sinks) sink.push({ tick, t, ...sound });
    }
  };

  const harness: Harness = {
    ...base,

    tickCount: () => base.frame(),

    async snapshot() {
      const snapshot = await base.snapshot();
      await drainCues();
      return snapshot;
    },

    async reset() {
      await base.debug.reset();
      return harness.snapshot();
    },

    async tick(ticks = 1) {
      const snapshot = await base.step(ticks);
      await drainCues();
      return snapshot;
    },

    async until(predicate, untilOptions = {}) {
      const result = await base.until(predicate, {
        maxTicks: DEFAULT_MAX_TICKS,
        ...untilOptions,
      });
      await drainCues();
      return result;
    },

    keyDown: (code) => base.hold(code),
    keyUp: (code) => base.release(code),

    settleFrame: () =>
      // Two animation frames of the build's OWN loop, which keeps running while
      // the simulation is held (`specs/instrumentation.md`): one for a frame
      // that may already be mid-flight, one that is guaranteed to begin after
      // this call. It is how a real key press reaches a build that reads its
      // keyboard on its own frames — a menu answers here, with no tick run.
      page.evaluate(
        () =>
          new Promise<void>((done) => {
            requestAnimationFrame(() => requestAnimationFrame(() => done()));
          }),
      ),

    async frameDraw() {
      const calls = await base.frameCalls();
      const blits = await lastFrameBlits(page);
      await drainCues();
      return { calls, blits };
    },

    async frameBlits() {
      return (await harness.frameDraw()).blits;
    },

    async probe(names) {
      return (await base.probe(names)).ops;
    },

    async armAudio() {
      // Two things, in this order, and each of them is something a build is
      // entitled to make a check wait for.
      //
      // The FILES first. A build fetches and decodes its cues after the page
      // has loaded (`specs/assets.md` puts the produced `.wav`s under `assets/`
      // and has the build load them itself), so a check that drove the game the
      // instant the page settled could reach a bounce before the bounce's own
      // clip had arrived and read silence from a build that is simply still
      // starting up. The wait is BOUNDED and never fails, so a build whose
      // cues never decode reaches its cue points and fails them there, rather
      // than hanging here.
      //
      // Then the GENUINE browser gesture the kit is configured with — a real
      // press of a key `specs/controls.md` binds to nothing — and the frames the
      // build reads it on.
      await page
        .waitForFunction(
          (wanted) => {
            const audio = (
              window as unknown as { __kesslerAudio?: { decoded(): string[] } }
            ).__kesslerAudio;
            if (audio === undefined) return false;
            const held = audio.decoded();
            return wanted.every((name) => held.includes(name));
          },
          [...CUE_NAMES, MUSIC_TITLE, MUSIC_PLAY],
          { timeout: AUDIO_LOAD_TIMEOUT_MS, polling: 25 },
        )
        .catch(() => undefined);
      await base.armAudio();
      await harness.settleFrame();
    },

    async looping(name) {
      const sounding = (await page.evaluate(() => {
        const audio = (
          window as unknown as { __kesslerAudio: { looping(): string[] } }
        ).__kesslerAudio;
        return audio.looping();
      })) as string[];
      return sounding.includes(name);
    },
  };

  harnessCues.set(harness, sinks);
  return harness;
}

/**
 * The bitmaps the last DRIVEN tick blitted, as `image-init.js` bracketed them.
 *
 * BRACKETED IN THE PAGE, not around a crossing. The build's own animation frame
 * keeps rendering while the simulation is held, so a window opened by reading a
 * counter, driving a tick and reading it again would take in whatever those
 * frames drew as well. `image-init.js` therefore brackets on the recorder's own
 * frame — the same `begin`/`end` pair the shared driven frame closes each tick
 * with — which is exactly the window `rec.last()` reports the operations of.
 */
async function lastFrameBlits(page: Page): Promise<Blit[]> {
  return (await page.evaluate(() =>
    (
      window as unknown as { __kesslerImages: { lastFrame(): unknown[] } }
    ).__kesslerImages.lastFrame(),
  )) as Blit[];
}

/* -------------------------------------------------------------------------- */
/* The keyboard                                                               */
/* -------------------------------------------------------------------------- */
//
// Real key events, through Chromium's own input pipeline, because the keyboard
// belongs to the runtime layer the build wrote and `specs/instrumentation.md`
// carries no operation for it: a dispatched key is required to work exactly as
// a player's key does, and these are how a check dispatches one.
//
// WHY A TAP SPANS BOTH A SETTLED FRAME AND A DRIVEN TICK, WHERE THE PACKAGE'S
// `Harness.tap` DRIVES ONE TICK AND NOTHING ELSE. `specs/controls.md` makes
// every action either a held value or a press EDGE, and it deliberately does not
// fix WHERE a build consumes an edge: a menu answers on the build's own
// animation frame even while the simulation is held (the specification requires
// exactly that), while a build is equally free to latch the edge and resolve it
// on the next simulation tick. So a tap gives the press both moments: the key
// goes down, the build's own loop runs a frame with it held (a menu answers
// here), one tick is driven (a latched edge resolves here), and the key comes
// up. Exactly ONE tick passes per tap, whichever design the build chose, so a
// scenario that counts ticks counts the tap as one — and a check that needs a
// position exact to the tick poses it through the surface instead of pressing
// for it.
//
// THEY ARE FREE FUNCTIONS, where the package puts its pair on the harness, and
// that stays: `tap(h, code)` reads at a hundred and thirty call sites in this
// project, and the two are not the same gesture, so binding this one to a
// member's name would put two different presses under one spelling.

/**
 * Press `code`, let the press land, and release it — one action's worth, as
 * `specs/controls.md` reads a press edge. Advances the simulation by exactly
 * one tick.
 */
export async function tap(h: Harness, code: string): Promise<void> {
  await h.keyDown(code);
  await h.settleFrame();
  await h.tick(1);
  await h.keyUp(code);
}

/**
 * Hold `code` down while `ticks` ticks run, then release it — how a check
 * drives the deflector's held rotation, which tick step 1 of `specs/field.md`
 * reads from the held keys. The key is down for every one of the ticks, so a
 * conformant build turns the deflector `ticks / 60` seconds' worth.
 */
export async function hold(
  h: Harness,
  code: string,
  ticks: number,
): Promise<KesslerSnapshot> {
  await h.keyDown(code);
  await h.settleFrame();
  try {
    return await h.tick(ticks);
  } finally {
    await h.keyUp(code);
  }
}

/* -------------------------------------------------------------------------- */
/* Reading one frame's render                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Whether the frame drew `text` as part of some RAW run of text, ignoring case.
 *
 * Substring rather than equality on purpose: the copy a check asserts is the
 * case's own, but how a build presents it is the build's, and a menu entry is
 * commonly drawn with a selection marker or padding around it. Requiring the
 * exact run would fail a screen that shows precisely the right words.
 *
 * KESSLER'S OWN, over the package's `drawnText`. The package ships a `drewText`
 * of its own and it is a different reading: it matches against the LOGICAL runs
 * a frame spells (`drawnTextLines`), which is what a case whose build
 * letter-spaces a heading a glyph per `fillText` needs. Kessler's copy points
 * were all decided against the raw calls, and the two answers coincide only
 * while nothing merges — so this composes the package's raw reading rather than
 * binding a name whose meaning would be the other one.
 */
export function drewText(calls: readonly DrawCall[], text: string): boolean {
  const wanted = text.trim().toLowerCase();
  return drawnText(calls).some((drawn) => drawn.toLowerCase().includes(wanted));
}

/* -------------------------------------------------------------------------- */
/* Cues                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Record every cue the build plays from now on, stamped with the tick of the
 * drive it played on and named by the file it came from.
 *
 * WHAT IS OBSERVED, AND WHY IT IS THE FAIR READING. The specs fix one cue per
 * event, played on the tick its event resolves, and `specs/assets.md` fixes the
 * FILE behind each of the thirteen cues and two beds — so `audio-init.js`
 * carries the file's name from the fetch, through the decode, to the source
 * that plays it, and a check reads WHICH cue sounded, not merely that something
 * did. A sound whose file cannot be named arrives with a `name` of `null` and
 * is still recorded, so a build's own synthesized flourish is never mistaken
 * for one of the thirteen and never silently dropped.
 *
 * NOT THE PACKAGE'S `watchCues`, which collects the shared probe's anonymous
 * firings; a watch opened here fills from `audio-init.js` instead.
 */
export function onCue(h: Harness): TimedCue[] {
  const played: TimedCue[] = [];
  harnessCues.get(h)?.push(played);
  return played;
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
  return cues.filter((cue) => cue.name === name);
}

/** Every recorded play that fell on tick `tick` of the drive. */
export function cuesOnTick(
  cues: readonly TimedCue[],
  tick: number,
): TimedCue[] {
  return cues.filter((cue) => cue.tick === tick);
}

/* -------------------------------------------------------------------------- */
/* Blits                                                                      */
/* -------------------------------------------------------------------------- */

/** Where a blit's centre landed, in device pixels. */
export function blitCenter(blit: Blit): { x: number; y: number } {
  return { x: blit.x + blit.w / 2, y: blit.y + blit.h / 2 };
}

/**
 * Every blit whose centre landed within `within` logical units of the logical
 * point `(x, y)` — how a check asks which sprite was painted on a ball, a pod,
 * or the planet, whose sprites `specs/assets.md` has drawn centered on their
 * objects.
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
  const bound = within * view.scale;
  return blits.filter((blit) => {
    const centre = blitCenter(blit);
    return Math.hypot(centre.x - at.x, centre.y - at.y) <= bound;
  });
}

/**
 * The identity of the sprite painted nearest the logical point `(x, y)` among
 * blits within `within` units of it, or `null` when none landed there.
 *
 * The LAST such blit, because that is the one a player sees: a build that
 * paints a spot twice has shown the second.
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
// ONE PIXEL, NOT A CLUSTER. The package's `sampleColor` and `samplePoints` mean
// the mean of a five-point cluster and of one cluster per point; Kessler's
// readings are of a single device pixel, and every threshold in this project's
// visibility and presentation suites was measured against that. So these keep
// the case's own names and the case's own meaning, over the package's `Rgb`.

/** The colour rendered at the logical point `(x, y)`. */
export async function sampleAt(h: Harness, x: number, y: number): Promise<Rgb> {
  const [r, g, b] = await h.pixel(x, y);
  return { r, g, b };
}

/** The colour rendered at radius `r`, angle `thetaDeg`, under the polar map. */
export async function samplePolar(
  h: Harness,
  r: number,
  thetaDeg: number,
): Promise<Rgb> {
  const point = pointAt(r, thetaDeg);
  return sampleAt(h, point.x, point.y);
}

/** The colours at several logical points, in one crossing into the page. */
export async function samplePoints(
  h: Harness,
  points: readonly { x: number; y: number }[],
): Promise<Rgb[]> {
  const read = await h.pixels(points);
  return read.map(([r, g, b]) => ({ r, g, b }));
}

/* -------------------------------------------------------------------------- */
/* Posing a world                                                             */
/* -------------------------------------------------------------------------- */
//
// The surface is atomic — one field, one read, one clock move — so a scenario
// is several calls in a fixed order, written once, here. The rule the guide
// states is that a validator poses an ISOLATED world: it clears every entity
// the requirement is not about and spawns back exactly what it is about, and it
// holds still the consequences the requirement does not exercise.
// `specs/instrumentation.md` gives Kessler two driver switches for that
// (`waveAdvance`, `podSpawn`) and operations that place and remove each kind of
// thing on the field.

/**
 * Reset the game and stand it on an EMPTY `playing` field with both autonomous
 * consequences held: no targets, no balls, no pods, `waveAdvance` off (so an
 * emptied field does not clear into the interstitial), and `podSpawn` off (so a
 * destruction the scenario stages sheds nothing it did not ask for).
 *
 * The scenario then spawns back exactly what its requirement is about —
 * `spawnTarget` for the one target, `spawnBall` for the one ball, `spawnPod`
 * for the one pod — and turns a switch back on only when the switch's own
 * consequence IS the requirement. A scenario that turns `podSpawn` back on
 * poses the draw's outcome through `setNextPod` first.
 *
 * Every call here is one of the surface's atomic poses, in a deliberate order:
 * the reset first, which is what puts the wave-1 figures in force and stands
 * the deflector at angle `90` with its baseline span, so nothing a previous
 * section left is inherited; then `setScreen("playing")`, which sets the screen
 * and nothing else; then the clears, which take away the full wave the reset
 * laid; then the two switches.
 */
export async function isolate(h: Harness): Promise<KesslerSnapshot> {
  await h.debug.reset();
  await h.debug.setScreen("playing");
  await h.debug.clearTargets();
  await h.debug.clearBalls();
  await h.debug.clearPods();
  await h.debug.setWaveAdvance(false);
  await h.debug.setPodSpawn(false);
  return h.snapshot();
}

/**
 * Start a session the way a player does: reset to the title, and press the
 * `confirm` key on the highlighted START entry. For the checks that are ABOUT
 * the real route into play; everything else enters through
 * `poseScene(h, "playing")` and never touches a menu, so a build with a broken
 * title and a working tick fails the navigation points and passes the rest.
 *
 * `Enter` rather than `Space`, deliberately: both are bound to `confirm`, and
 * `Space` also carries `launch` — a check that is about WHICH key confirms
 * presses its own.
 */
export async function startPlay(h: Harness): Promise<KesslerSnapshot> {
  await h.debug.reset();
  await tap(h, "Enter");
  return h.snapshot();
}

/**
 * Set the screen to `screen` and read what stands, without arranging anything
 * else — `setScreen` sets the screen and nothing else, so this is the direct
 * route to a screen for a check that is about the screen rather than about a
 * scene under it.
 *
 * A check that wants the screen arranged the way the real transition into it
 * arranges it calls the sequence that arranges it: {@link startFreshSession}
 * for a session begun the way confirming START begins one, and
 * {@link poseInterstitial} for the interstitial the clearing event enters.
 */
export async function poseScene(
  h: Harness,
  screen: Screen,
): Promise<KesslerSnapshot> {
  await h.debug.setScreen(screen);
  return h.snapshot();
}

/**
 * Run `n` whole simulation ticks and read what they left — the drive every
 * scenario advances by, so an outcome is always the game's own tick's work.
 */
export async function advanceTicks(
  h: Harness,
  n: number,
): Promise<KesslerSnapshot> {
  return h.tick(n);
}

/**
 * Spawn one unparked ball posed polar-wise: at radius `r` and stage angle
 * `thetaDeg`, moving at `speed` headed `offDeg` degrees from the outward radial
 * (positive toward `+theta`; `offDeg` `180` is straight inward). Sugar over
 * `spawnBall`'s cartesian figures for a game whose every rule is polar.
 */
export async function spawnBallPolar(
  h: Harness,
  r: number,
  thetaDeg: number,
  speed: number,
  offDeg = 0,
): Promise<void> {
  const at = pointAt(r, thetaDeg);
  const v = outwardVelocity(speed, thetaDeg, offDeg);
  await h.debug.spawnBall(at.x, at.y, v.vx, v.vy);
}

/**
 * Spawn one pod of `kind` posed polar-wise, at radius `r` and stage angle
 * `thetaDeg`. It falls radially inward at the fixed fall speed from the call
 * onward, exactly as a drawn pod does, and no draw is made.
 */
export async function spawnPodPolar(
  h: Harness,
  kind: Parameters<KesslerDebugApi["spawnPod"]>[0],
  r: number,
  thetaDeg: number,
): Promise<void> {
  const at = pointAt(r, thetaDeg);
  await h.debug.spawnPod(kind, at.x, at.y);
}

/**
 * Perform `count` pod draws through the build's `drawPod`, one independent
 * draw each, and hand back their outcomes in order: a kind name, or `null`
 * for a draw that shed nothing. The first draw crosses into the page on its
 * own, so a missing or broken surface fails the way every operation fails;
 * the rest run inside the page in one round trip, which is what lets a
 * sampling check make thousands of draws in well under a second.
 */
export async function drawPods(
  h: Harness,
  count: number,
): Promise<(string | null)[]> {
  const first = await h.debug.drawPod();
  if (count <= 1) return [first];
  const rest = await h.page.evaluate(
    ([handle, n]) => {
      const api = (
        window as unknown as Record<string, { drawPod(): string | null }>
      )[handle];
      const out: (string | null)[] = [];
      for (let i = 0; i < n; i += 1) out.push(api.drawPod());
      return out;
    },
    [HANDLE, count - 1] as const,
  );
  return [first, ...rest];
}

/**
 * Start a fresh session the way confirming START starts one, out of atomic
 * poses: the reset lays wave 1 — score `0`, `3` lives, wave `1`, every slot
 * filled, every ring angle at `0`, the wave-1 figures in force, the deflector
 * at angle `90` with its baseline span — `setScreen("playing")` puts the game
 * on the live field, and `parkBall` puts the serve on the deflector.
 *
 * `setScreen` is atomic by specification, so the arrangement is this sequence
 * rather than the call: the guide puts every compound sequence in the harness,
 * and this is the one every check that needs a session in play shares.
 */
export async function startFreshSession(h: Harness): Promise<KesslerSnapshot> {
  await h.debug.reset();
  await h.debug.setScreen("playing");
  await h.debug.parkBall();
  return h.snapshot();
}

/**
 * Enter the interstitial the way the clearing event enters it, out of atomic
 * poses: every ball, every pod, every timed effect and the shield are removed,
 * the interstitial timer is set to the `180` ticks `specs/screens.md` fixes,
 * and the screen becomes `waveclear`.
 *
 * The wave the interstitial is running out belongs to the caller: it poses
 * `setWave` and the ring state it wants before calling this, exactly as it
 * poses any other part of the world.
 */
export async function poseInterstitial(
  h: Harness,
  ticks: number = WAVECLEAR_TICKS,
): Promise<KesslerSnapshot> {
  await h.debug.clearBalls();
  await h.debug.clearPods();
  for (const kind of ["widen", "narrow", "pierce"] as const) {
    await h.debug.setEffectTicks(kind, 0);
  }
  await h.debug.setShield(false);
  await h.debug.setInterstitialTicks(ticks);
  await h.debug.setScreen("waveclear");
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
export async function poseMenu(
  h: Harness,
  screen: Screen,
  index: number,
): Promise<KesslerSnapshot> {
  await h.debug.setScreen(screen);
  await h.debug.setMenuIndex(index);
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
export async function menuRect(
  h: Harness,
  index: number,
): Promise<MenuItemRect | null> {
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
/* The pointer and the finger                                                 */
/* -------------------------------------------------------------------------- */
//
// `specs/controls.md` puts the pointer in the runtime layer the build wrote, so
// the surface carries no operation for it and a check drives Chromium's own
// mouse and Chromium's own touch contact instead — which is the only way a
// build's pointer handling is exercised at all.
//
// EACH PART OF A GESTURE RUNS A FRAME OF THE BUILD'S OWN LOOP, AND DRIVES NO
// TICK. That is where these part company with the package's `mousePress` and
// `touchPress`, which each drive one simulation tick: Kessler's pointer points
// are all about a MENU, which `specs/instrumentation.md` requires to answer
// while the simulation is held, and a gesture that advanced the game would move
// every tick count a scenario around it was written with. A build is free to
// read the pointer once per frame, so a press that ran no frame would never
// reach it and a press released before a frame ran would be invisible to a
// build that compares held state between frames — hence the settled frame.

/** Move the real mouse onto the logical stage point `(x, y)`, and let it land. */
export async function pointerTo(
  h: Harness,
  x: number,
  y: number,
): Promise<void> {
  const at = h.css(x, y);
  await h.page.mouse.move(at.x, at.y);
  await h.settleFrame();
}

/** Press the real mouse's primary button where it stands, and let it land. */
export async function pointerDown(h: Harness): Promise<void> {
  await h.page.mouse.down();
  await h.settleFrame();
}

/** Release the real mouse's primary button, and let the release land. */
export async function pointerUp(h: Harness): Promise<void> {
  await h.page.mouse.up();
  await h.settleFrame();
}

/**
 * Land a real touch contact on the logical stage point `(x, y)`, and let it
 * land. The harness must have been opened with `touch: true`.
 */
export async function touchDown(
  h: Harness,
  x: number,
  y: number,
): Promise<void> {
  await dispatchTouch(h, "touchStart", h.css(x, y));
  await h.settleFrame();
}

/** Lift the held contact, and let the lift land. */
export async function touchUp(h: Harness): Promise<void> {
  await dispatchTouch(h, "touchEnd", null);
  await h.settleFrame();
}

/** The contact identifier every touch gesture here drives: one finger. */
const CONTACT_ID = 1;

/**
 * The CDP session a page's contacts are driven through, opened once and HELD.
 *
 * Chromium tracks live contacts per CDP client, so a session opened for the
 * landing and detached again takes the contact with it and the lift that
 * follows is refused. The session therefore outlives the whole gesture, and the
 * page closing is what closes it.
 */
const touchSessions = new WeakMap<
  Page,
  Promise<import("playwright").CDPSession>
>();

async function dispatchTouch(
  h: Harness,
  type: "touchStart" | "touchMove" | "touchEnd",
  point: { x: number; y: number } | null,
): Promise<void> {
  let session = touchSessions.get(h.page);
  if (session === undefined) {
    session = h.page.context().newCDPSession(h.page);
    touchSessions.set(h.page, session);
  }
  await (
    await session
  ).send("Input.dispatchTouchEvent", {
    type,
    touchPoints:
      point === null ? [] : [{ x: point.x, y: point.y, id: CONTACT_ID }],
  });
}

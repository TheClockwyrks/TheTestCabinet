// Deepcore — the case's half of the validator harness. CASE-PROVIDED.
//
// Every check in this project is an ordinary vitest test that drives the built
// site IN A REAL BROWSER. There is nothing to import: an engineless run seeds no
// `src/` at all, so the build wrote its own frame loop, its own canvas fit, its
// own keyboard, its own audio, its own asset loading, and its own
// `window.__deepcore` — and the only place all of that exists is a page that has
// loaded the bundle and the assets it produced. So the project serves `dist/`,
// loads it in Chromium, and reaches the game the way anything reaches it: over
// the surface `specs/instrumentation.md` told the build to install.
//
// THE MACHINERY THAT DOES THAT IS NOT DEEPCORE'S. Serving the build, connecting
// to the one browser, opening a page per harness, injecting the draw-command
// recorder and the audio probe, bracketing each driven frame around one
// `advance` of the build's surface, reading pixels and draw calls back out, and
// writing the evidence a review item declares — every engineless case needs
// exactly that, and it lives once, in `@clockwyrks/case-harness`, staged beside
// this file as `./case-harness/`. What is left here is what is genuinely
// Deepcore's: the shape of its snapshot, the operations
// `specs/instrumentation.md` requires, the mine's own geometry, and the scene a
// scenario poses.
//
// The seam is one call. `createCaseHarness` takes the case's TYPES as type
// arguments and the case's VALUES as one object, and hands back the machinery
// with Deepcore's names and Deepcore's types on it — so the suites next door go
// on importing `createHarness`, `captureReplay`, `openScene` and the frame
// arithmetic from `../harness` exactly as they did.
//
// FOUR THINGS ARE BOUND ON TOP OF IT, and each is a fact about THIS case rather
// than about the package:
//
//   - `tileAt`, because a cell's state is a reading of Deepcore's own that the
//     specification puts on the surface beside `snapshot`.
//   - `advanceSeconds`, because this case's step operation is
//     `advance(seconds, frames)` and the suite chooses how a span of game time is
//     divided (see The step schedule below). It queues the frame lengths on the
//     harness's own clock, so the frames it drives are the package's driven
//     frames — recorded, cue-bracketed, one `advance` each — and not a second
//     path into the page.
//   - `hold`, `release`, `releaseAll` and `tap`, because
//     `specs/instrumentation.md` puts the keyboard ON THE SURFACE for this case:
//     "Keys reach the game through `keyDown` and `keyUp` below. An injected key
//     flows through the same handling the real keyboard feeds". The package's own
//     trio presses Chromium's keyboard, which is the right driver for a case
//     whose specification names none; here it is the SECOND driver, and it is
//     kept under `browserHold`/`browserRelease`/`browserTap` for the three checks
//     that are about the runtime reading a real `KeyboardEvent.code` off the page
//     at all.
//   - `armAudio`, the one genuine browser gesture, because the checks that read
//     what a build SOUNDED arm it after the harness is built rather than at
//     construction (`audio/probe.ts` says why: waiting for a decode burns real
//     time, and the scene is posed afterwards).
//
// WHAT A CHECK READS. The game's own state (through `window.__deepcore`'s
// `snapshot` and `tileAt`), the frames the harness itself drove, the operations
// the build issued against its 2D context, the pixels those operations left on
// the canvas, and the sounds the build emitted. Nothing here fabricates an
// outcome: the scenario helpers below only ARRANGE the world through the surface,
// and the real update the build wrote is what runs from there.
//
// THE CLOCK IS THE SURFACE'S. Nothing outside an engineless build owns its loop,
// so `specs/instrumentation.md` puts the clock on the surface: `setAutoStep(false)`
// takes the game off real time and `advance(seconds, frames)` runs whole frames of
// a chosen length. Every harness opens by taking the game off the clock, so a
// check asks for a number of frames and gets exactly that number — no polling, no
// waiting, and no measurement of the machine it ran on. A check that is ABOUT the
// loop running itself hands it back with `runFor`.
//
// EVERYTHING CROSSING INTO THE PAGE IS ASYNC. That is the whole of the difference
// between a suite here and its counterpart under an engine: `await h.snapshot()`
// rather than `h.snapshot()`, `await h.debug.setFuel(40)` rather than
// `h.debug.setFuel(40)`. The scenarios, the tolerances, and the assertions are
// the same ones, because they are the case's rather than the runtime's.
//
// AND EVERY COMPOUND SEQUENCE LIVES HERE. The surface is atomic by design: one
// field, one reading, one clock move. Opening a scene, holding a faculty, laying a
// seam, standing the miner on a cell, sinking a shaft, reaching a building — none
// of those is an operation, and each of them is several. They are built once here,
// out of the atomic operations, and shared by every validator; a check that needs
// only part of a sequence calls the operations it needs.

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ConstantClock,
  createCaseHarness,
  sampleColor as sampleColorOf,
  type Clock,
  type Harness as BaseHarness,
  type HarnessOptions,
  type Rgb,
  type UntilOptions,
  type UntilResult as BaseUntilResult,
} from "./case-harness/index";
import { fail } from "./assert";
import {
  ACTIONS,
  BAND_ORDER,
  CAVE_MOUTH_COL,
  CORE_COL,
  DEFAULT_SEED,
  HUD_H,
  MINER_H,
  MINER_W,
  ORES,
  PLAYABLE_COL_MAX,
  PLAYABLE_COL_MIN,
  SPAWN_COL,
  STAGE_H,
  STAGE_W,
  SURFACE_Y,
  TILE,
  UNBOUND_KEY,
  bandIndexAt,
  coreRowFor,
  depthFraction,
  rowAtFraction,
} from "./constants";
import type {
  Action,
  Band,
  Facing,
  ItemId,
  Material,
  Mode,
  Ore,
  Screen,
  TileKind,
  UpgradeTrack,
  WorldSize,
} from "./constants";
import { REQUIRED_OPS } from "./surface";
import type {
  BuildingBox,
  CellRef,
  DeepcoreDebugApi,
  DeepcoreSnapshot,
  MinerView,
  TileRead,
} from "./surface";

export * from "./surface";

/* -------------------------------------------------------------------------- */
/* The contract the build owes                                                */
/* -------------------------------------------------------------------------- */

/** The handle an engineless build installs its surface on. */
export const HANDLE = "__deepcore";

/* -------------------------------------------------------------------------- */
/* The step schedule                                                          */
/* -------------------------------------------------------------------------- */
//
// The suite chooses the size of a frame, because the specification deliberately
// fixes none: every rate in this game is per second and is integrated against the
// elapsed time of the frame, so a build must reach the same place however that
// time was divided. The default is a steady 120 Hz, which makes every duration
// this specification states a whole number of frames — the drill's 0.125 s hit is
// 15 of them, the hurt state's 0.4 s is 48, the notice's 1.5 s delay is 180 — and
// that is the unit the tolerances in this project were established in. The check
// that is ABOUT the step size drives the same scenario under the other schedules
// the package ships.

/** The frame the suite steps in. */
export const TICK_HZ = 120;

/**
 * A clock that hands out lengths a caller queued, and falls back to its own.
 *
 * {@link Harness.advanceSeconds} is the reason it exists. This case's step
 * operation is `advance(seconds, frames)`, so a check that names a span AND a
 * frame count is asking for frames of `span / frames` — a length neither the
 * harness's steady clock nor a per-harness clock can supply, because it changes
 * from call to call. Queuing the lengths here rather than calling
 * `debug.advance` directly is what keeps those frames the PACKAGE's driven
 * frames: each one is opened and closed around a single `advance`, recorded, and
 * bracketed for the audio probe, exactly like a frame from `advance(n)`.
 *
 * A queue rather than a mode, so a queue that runs short simply returns to the
 * base clock instead of leaving the harness in a state a later call has to undo.
 */
class PacedClock implements Clock {
  private readonly queue: number[] = [];
  constructor(private readonly base: Clock) {}
  /** Take the next `frames` frames at `ms` each, ahead of the base clock's. */
  queueFrames(ms: number, frames: number): void {
    for (let i = 0; i < frames; i += 1) this.queue.push(ms);
  }
  delta(): number {
    return this.queue.shift() ?? this.base.delta();
  }
}

/* -------------------------------------------------------------------------- */
/* The harness, bound to this case                                            */
/* -------------------------------------------------------------------------- */

/**
 * The shared harness, with Deepcore's snapshot, Deepcore's surface and
 * Deepcore's figures bound into it.
 *
 * `projectRoot` comes from THIS module and must never come from the package's:
 * the package is staged one directory deeper than this file, and a produced
 * replay or still is addressed by the running suite's path relative to the
 * project root. Taken from the package it would address every output one level
 * too deep — and silently, because a writer that raised on a failed write would
 * be blaming the build for the host's problem, so neither of them raises.
 */
const kit = createCaseHarness<DeepcoreSnapshot, DeepcoreDebugApi>({
  slug: "deepcore",
  handle: HANDLE,
  requiredOps: REQUIRED_OPS,
  // `advance(seconds, frames)`: a span of simulated time divided into whole
  // frames. The suite chooses the division, so the harness's clock supplies the
  // length of each one.
  step: { kind: "seconds-frames", op: "advance" },
  stage: { width: STAGE_W, height: STAGE_H },
  tickHz: TICK_HZ,
  // A TOUCHSCREEN, because `specs/controls.md` requires the menus, the panels and
  // the status bar to answer a touch contact as well as a pointer, and a contact
  // driven on a context without one throws rather than arriving as a mouse. It is
  // a property of the device the build believes it is on, so it is set for the
  // whole project rather than for the checks that drive a finger: a build that
  // draws a different screen on a touch device draws that screen for every check.
  hasTouch: true,
  // A GENUINE browser gesture, so the build's audio can open: a build is free to
  // open its audio context from a real DOM event alone (both are conformant), so
  // a key delivered any other way would leave a perfectly good build silent.
  // `UNBOUND_KEY` is bound to nothing (specs/controls.md), so arming changes no
  // game state. The checks that read sound arm it themselves through
  // {@link Harness.armAudio}, after the harness is built — see `audio/probe.ts`.
  arm: { kind: "key", code: UNBOUND_KEY },
  // The seed the opening `reset` fixes, so a scenario driven from a fresh
  // harness is reproducible from that line on. `specs/instrumentation.md`
  // defaults `options.seed` to `DEFAULT_SEED` itself, and the harness passes it
  // explicitly so the call the build sees is the same one whether or not a check
  // named a seed of its own.
  defaultSeed: DEFAULT_SEED,
  // FIFTEEN SECONDS RATHER THAN THE FIVE A SHORTER CASE ALLOWS, because the
  // ceiling is not really on the build: it is on the host. This project holds
  // several pages of one browser open at once, the machine that runs it is
  // running a model's build under it, and a full-stack build loads the produced
  // art and audio it committed before it is ready. Fifteen costs a healthy build
  // nothing, because the poll returns the instant the global appears.
  surfaceTimeoutMs: 15_000,
  projectRoot: dirname(fileURLToPath(import.meta.url)),
});

export const {
  captureReplay,
  captureStill,
  watchCues,
  fitViewport,
  SURFACE_REQUIREMENT,
  TICK_MS,
  seconds,
  speedOverTicks,
} = kit;

/**
 * Fail the running check on `fault`, the harness's account of what is wrong with
 * the build's surface, paired with what the specification requires.
 *
 * Bound with its type WRITTEN OUT rather than destructured with the rest, because
 * a call to it has to narrow: `generation/mine-scan.ts` reads a surface fault,
 * calls this, and carries on with the reading it could not have. TypeScript only
 * treats a call as unreachable-after when the callee's `never` is reachable
 * through an explicit annotation on the binding, which a destructured const has
 * not got.
 */
export const failSurface: (fault: string) => never = kit.failSurface;

/**
 * Frames of the default clock covering `s` seconds, rounded to the NEAREST.
 *
 * The package's own `ticks` rounds up, and this case's does not: every duration
 * `specs/mining.md`, `specs/character.md` and `specs/ui.md` state is a whole
 * number of frames at 120 Hz, so the two agree wherever it matters — and where a
 * span does not divide, rounding to nearest keeps `advanceSeconds(s)` covering
 * `s` rather than a frame more of it, which is what every duration tolerance in
 * this project was established against. At least one frame, because a span
 * shorter than half a frame still has to run one.
 */
export function ticks(s: number): number {
  return Math.max(1, Math.round(s * TICK_HZ));
}

/**
 * Everything a check reads off one page running this build.
 *
 * The shared harness's interface with Deepcore's snapshot and Deepcore's surface
 * bound into it, plus the members that are the CASE's — the header says why each
 * of them is here rather than in the package.
 */
export interface Harness extends BaseHarness<
  DeepcoreSnapshot,
  DeepcoreDebugApi
> {
  /** One cell's state, through the build's `tileAt`. */
  tileAt(col: number, row: number): Promise<TileRead>;
  /**
   * Run `s` seconds of game time in `frames` whole frames of `s / frames` each.
   *
   * `frames` defaults to the harness clock's own count, so `advanceSeconds(2)` is
   * `advance(240)`. A check about a LONG span names a smaller count instead: the
   * Core Sample's ninety seconds, the notice's eight-second fade, a fuel drain
   * measured over a minute. Every rate in this game is integrated against the
   * frame's delta, so a coarser division reaches the same outcome — and every
   * frame is RENDERED, so asking for ninety frames rather than ten thousand is
   * most of what decides how long such a check takes.
   */
  advanceSeconds(s: number, frames?: number): Promise<void>;
  /**
   * Put a key down through THE SURFACE and leave it down, as a player holding it
   * would. Released by {@link release}, by {@link releaseAll}, or by a `reset`.
   */
  hold(code: string): Promise<void>;
  /** Let a key held by {@link hold} up, through the surface. */
  release(code: string): Promise<void>;
  /** Let up every key this harness put down, in the order it put them down. */
  releaseAll(): Promise<void>;
  /**
   * Put a key down through the surface, run the one frame that delivers it, and
   * let it up.
   *
   * A press that ran no frame would never reach the game, and a press released
   * before a frame ran would be invisible to a build that reads its keyboard by
   * comparing held state between frames — so the frame goes between the two.
   */
  tap(code: string): Promise<DeepcoreSnapshot>;
  /** Hold `code` through the surface for `frames` frames, then let it up. */
  holdFor(code: string, frames: number): Promise<DeepcoreSnapshot>;
  /**
   * Press a key through CHROMIUM'S OWN keyboard rather than through the surface.
   *
   * The surface's `keyDown` is the specified driver and is what every scenario
   * below uses: `specs/instrumentation.md` requires an injected key to flow
   * through the same handling the real keyboard feeds, so driving through it
   * exercises the build's own bindings. What it cannot prove is the sentence
   * BEFORE that one — that the runtime the build wrote reads a real
   * `KeyboardEvent.code` off the page at all. That is what these three are for,
   * and a check about the keyboard layer itself uses them.
   */
  browserHold(code: string): Promise<void>;
  browserRelease(code: string): Promise<void>;
  browserTap(code: string): Promise<void>;
  /** Give the build a real, browser-trusted gesture, so its audio can open. */
  armAudio(): Promise<void>;
}

/**
 * Load the built site in a browser, take the game off the wall clock, and hand
 * back everything a check reads.
 *
 * The default shape is the stage's own size at one device pixel per CSS pixel, so
 * a logical coordinate and a canvas pixel are the same thing and no check but the
 * window-fit one has to think about the fit at all.
 */
export async function createHarness(
  options: HarnessOptions = {},
): Promise<Harness> {
  const paced = new PacedClock(options.clock ?? new ConstantClock(TICK_MS));
  const base = await kit.createHarness({ ...options, clock: paced });

  // Every key this harness put down through the surface and has not let up, in
  // the order it did. `reset` releases them all on the build's side, so the
  // record here has to agree with the game's — which is what the wrapper below
  // is for.
  const held: string[] = [];

  const debug = new Proxy(base.debug, {
    get: (target, property): unknown => {
      const member = Reflect.get(target, property) as unknown;
      if (property !== "reset" || typeof member !== "function") return member;
      return (...args: unknown[]) => {
        held.length = 0;
        return (member as (...a: unknown[]) => unknown)(...args);
      };
    },
  }) as DeepcoreDebugApi;

  /**
   * Let the page's OWN loop run twice.
   *
   * A key delivered through Chromium arrives as a DOM event, and an engineless
   * build is free to act on it in its own frame rather than in the handler — the
   * specification requires the runtime to report whether an action went down THIS
   * FRAME, which is a frame the build's loop opens. `advance` is not that loop, so
   * a browser key followed straight by a read would be read before the page had
   * had a chance to see it. Two animation frames, because the first is the one
   * that may already have been scheduled before the key landed.
   *
   * Nothing here advances the simulation: the game is off its clock, so the
   * build's loop draws and drains its input and steps nothing.
   */
  const settlePage = (): Promise<void> =>
    base.page.evaluate(
      () =>
        new Promise<void>((done) => {
          requestAnimationFrame(() => requestAnimationFrame(() => done()));
        }),
    );

  const harness: Harness = {
    ...base,
    debug,

    tileAt: (col, row) => debug.tileAt(col, row),

    async advanceSeconds(s, frames = ticks(s)) {
      if (frames < 1 || !Number.isInteger(frames)) {
        throw new RangeError(
          `advanceSeconds needs a whole number of frames of at least 1, got ${frames}`,
        );
      }
      paced.queueFrames((s * 1000) / frames, frames);
      await base.advance(frames);
    },

    async hold(code) {
      if (!held.includes(code)) held.push(code);
      await debug.keyDown(code);
    },
    async release(code) {
      const at = held.indexOf(code);
      if (at >= 0) held.splice(at, 1);
      await debug.keyUp(code);
    },
    async releaseAll() {
      for (const code of [...held]) await this.release(code);
    },
    async tap(code) {
      // Down, ONE frame, up. The frame between the two is what makes this a press
      // a build can actually see: an engineless build wrote its own keyboard
      // layer, and the two conformant ways to read a press — latching the edge in
      // the event handler, or comparing held state at the top of each frame —
      // agree only if the key is genuinely held while a frame runs. A down and an
      // up delivered back to back would be invisible to the second, which is a
      // build a real player has no trouble with. Exactly one frame passes either
      // way, so nothing a caller counts moves.
      await this.hold(code);
      await base.advance(1);
      await this.release(code);
      return base.snapshot();
    },

    async holdFor(code, frames) {
      await this.hold(code);
      try {
        await base.advance(frames);
        return await base.snapshot();
      } finally {
        await this.release(code);
      }
    },

    async browserHold(code) {
      await base.page.keyboard.down(code);
      await settlePage();
    },
    browserRelease: (code) => base.page.keyboard.up(code),
    async browserTap(code) {
      await this.browserHold(code);
      await base.advance(1);
      await base.page.keyboard.up(code);
    },

    async armAudio() {
      // A GENUINE browser gesture, not a posed one: a build is free to open its
      // audio context from a real DOM event alone (both are conformant), so a key
      // delivered any other way would leave a perfectly good build silent. The
      // key is bound to nothing (specs/controls.md), so arming changes no game
      // state. It is the same gesture the package's own `arm` config names; the
      // checks that need it deliver it here rather than at construction, because
      // waiting for a full-stack build to decode what it produced burns real time
      // and the scene is posed afterwards (`audio/probe.ts`).
      await base.page.keyboard.press(UNBOUND_KEY);
    },
  };

  return harness;
}

/* -------------------------------------------------------------------------- */
/* What the package supplies, under this case's names                         */
/* -------------------------------------------------------------------------- */
//
// A suite says `from "../harness"` for everything it reads a frame with, and
// that stays true: the readings are the shared harness's, and they arrive here.
// Named one at a time rather than through a star, so this list IS the account of
// what the project takes from the package.

export type {
  Clock,
  DrawCall,
  HarnessOptions,
  ImageDraw,
  ImageRef,
  Pixel,
  PixelRect,
  Point,
  RecordedFrame,
  RecordedOp,
  RecordedPathSegment,
  RecordedResource,
  RecordedState,
  Recording,
  Rgb,
  TextDraw,
  TimedCue,
  UntilOptions,
  Viewport,
} from "./case-harness/index";

export {
  callsTo,
  closeWorkerBrowser,
  colorDistance,
  differingPoints,
  distance,
  drawnPoints,
  drawnText,
  drawnTextLines,
  drawnTextRuns,
  drawOps,
  drewText,
  imageDraws,
  imageRef,
  luminance,
  luminanceMask,
  maskDifference,
  meanColor,
  mouseGlide,
  mousePress,
  mouseRelease,
  pixelsDiffering,
  pointsNear,
  retable,
  samplePatch,
  setsOf,
  textDraws,
  thinReplay,
  touchGlide,
  touchPress,
  touchRelease,
  touchTap,
  ConstantClock,
  JitterClock,
  SequenceClock,
  DRAW_METHODS,
  MAX_REPLAY_FRAMES,
  DEFAULT_REPLAY_BACKGROUND as REPLAY_BACKGROUND,
  RECORDER_GLOBAL,
} from "./case-harness/index";

/** What a sweep found: whether the predicate ever held, and where it stopped. */
export type UntilResult = BaseUntilResult<DeepcoreSnapshot>;
/* -------------------------------------------------------------------------- */
/* World geometry                                                             */
/* -------------------------------------------------------------------------- */
//
// The mine has a coordinate space of its own, in the same logical units as the
// stage, and the viewport is a window onto it. Nothing here reads the build: each
// is the arithmetic `specs/world.md` states, so a check that samples a pixel over
// a tile is sampling where the specification says that tile is drawn.

/** The world-space rectangle a cell occupies. */
export function cellRect(
  col: number,
  row: number,
): { x: number; y: number; w: number; h: number } {
  return { x: col * TILE, y: row * TILE, w: TILE, h: TILE };
}

/** The world-space centre of a cell. */
export function cellCenter(col: number, row: number): { x: number; y: number } {
  return { x: col * TILE + TILE / 2, y: row * TILE + TILE / 2 };
}

/** The cell a world point falls in. */
export function cellAt(x: number, y: number): CellRef {
  return { col: Math.floor(x / TILE), row: Math.floor(y / TILE) };
}

/** The world-space centre of the miner's box. */
export function minerCenter(miner: MinerView): { x: number; y: number } {
  return { x: miner.x + MINER_W / 2, y: miner.y + MINER_H / 2 };
}

/** The world `y` of the bottom of the miner's box: its feet. */
export function minerFeet(miner: MinerView): number {
  return miner.y + MINER_H;
}

/** The box `x` that centres the miner on `col`. */
export function minerXOn(col: number): number {
  return col * TILE + (TILE - MINER_W) / 2;
}

/** The box `y` of a miner standing on top of `row`. */
export function minerYOn(row: number): number {
  return row * TILE - MINER_H;
}

/** The box `y` of a miner standing on the camp ground. */
export const CAMP_MINER_Y = SURFACE_Y - MINER_H;

/**
 * Where a world point is drawn on the stage: `(wx - camX, wy - camY + HUD_H)`.
 *
 * The camera is read off the snapshot the caller already has, so the mapping is
 * the one in force at the frame that was sampled.
 */
export function worldToStage(
  snapshot: DeepcoreSnapshot,
  wx: number,
  wy: number,
): { x: number; y: number } {
  return {
    x: wx - snapshot.camera.x,
    y: wy - snapshot.camera.y + HUD_H,
  };
}

/** Whether a stage point falls inside the mine viewport rather than the status bar. */
export function inViewport(x: number, y: number): boolean {
  return x >= 0 && x <= STAGE_W && y >= HUD_H && y <= STAGE_H;
}

/** The band a row falls in, at the mine the snapshot describes. */
export function bandOfRow(snapshot: DeepcoreSnapshot, row: number): Band {
  return BAND_ORDER[bandIndexAt(depthFraction(row, snapshot.coreRow))];
}

/** A row well inside `band`, at a mine of `coreRow` rows: the band's midpoint. */
export function rowInBand(band: Band, coreRow: number): number {
  const index = BAND_ORDER.indexOf(band);
  return rowAtFraction((index + 0.5) / 4, coreRow);
}

/** The load fraction the snapshot reports: `loadKg / liftLimitKg`. */
export function loadFraction(snapshot: DeepcoreSnapshot): number {
  return snapshot.cargo.loadKg / snapshot.cargo.liftLimitKg;
}

/* -------------------------------------------------------------------------- */
/* Isolation: opening a scene                                                 */
/* -------------------------------------------------------------------------- */
//
// A validator poses an isolated world: it clears every entity its requirement is
// not about and puts back exactly what it is. In Deepcore that means an empty
// mine — no ore to bank by accident, no gas to detonate under the miner, no lava
// to drain hull while a fuel check runs — and a miner carrying only the faculties
// the requirement exercises. `reset` already leaves the mine empty, the cargo
// empty, the satchel empty and no supplies held, so a scene is that plus the
// screen, the size, and the faculties.

/** How a scene opens. Everything is optional; the defaults are the resting world. */
export interface SceneOptions {
  /** The generator's seed. Defaults to `DEFAULT_SEED`. */
  seed?: number;
  /**
   * The world size.
   *
   * `setWorldSize` RESIZES the mine rather than emptying it
   * (`specs/instrumentation.md`, Resizing the mine): every cell the two depths
   * share comes through untouched, and rows the old depth did not reach open as
   * an empty mine holds them. A `reset` has just left the grid empty, so what
   * comes through is empty too — but the clear below is what makes the scene's
   * emptiness a fact rather than an inference, and it is what a size named after
   * anything else has to lean on.
   */
  size?: WorldSize;
  /** The expedition's mode. Defaults to `standard`, as a `reset` leaves it. */
  mode?: Mode;
  /** The screen to open on. Defaults to `in-mine`. */
  screen?: Screen;
  /** Whether the miner's body moves. Defaults to on, as a `reset` leaves it. */
  travel?: boolean;
  /** Whether the miner's drill cuts. Defaults to on, as a `reset` leaves it. */
  drill?: boolean;
}

/**
 * The opening every posed check shares: the game off the clock, the world back at
 * its resting value on a named seed, and the screen the check is about.
 *
 * What it leaves is an EMPTY mine — `reset` restores the grid to what `clearMine`
 * leaves — with the miner standing at the camp, tier 1 everywhere, a full tank and
 * hull, no Credits, nothing held, and no notice fired. A check then places exactly
 * what its requirement is about.
 *
 * `muted` and the save slot are deliberately outside this, because `reset` leaves
 * both alone: a fresh page is what clears them, and every harness opens one.
 */
export async function openScene(
  h: Harness,
  options: SceneOptions = {},
): Promise<void> {
  await h.debug.setAutoStep(false);
  await h.debug.reset({ seed: options.seed ?? DEFAULT_SEED });
  if (options.size !== undefined) {
    await h.debug.setWorldSize(options.size);
    await h.debug.clearMine();
  }
  if (options.mode !== undefined) await h.debug.setMode(options.mode);
  await h.debug.setScreen(options.screen ?? "in-mine");
  if (options.travel !== undefined)
    await h.debug.setMinerTravel(options.travel);
  if (options.drill !== undefined) await h.debug.setMinerDrill(options.drill);
}

/**
 * Hold the miner's body still for what follows: gravity, walking, thrust,
 * knockback and collision displacement all move it nowhere.
 *
 * The faculty gate `specs/instrumentation.md` fixes, named for what it is FOR. A
 * check about the drill, about fuel burn, about a hazard's damage or about the
 * cargo does not want the miner falling out of the scenario it was posed in, and
 * everything else about the miner carries on: it still reads as grounded, still
 * starts and holds a cut, still spends fuel, still takes damage, and the camera
 * still follows it.
 */
export function pinMiner(h: Harness): Promise<void> {
  return h.debug.setMinerTravel(false);
}

/**
 * Hold the miner's drill for what follows: no cut starts, none progresses, no
 * cell loses health, nothing is banked, and no drill hit spends fuel.
 *
 * The companion gate. A check about movement, about the camera, about fall
 * impact or about fuel's other drains holds this, so a key held to steer the
 * miner cannot quietly bore a hole through the scenario.
 */
export function pinDrill(h: Harness): Promise<void> {
  return h.debug.setMinerDrill(false);
}

/* -------------------------------------------------------------------------- */
/* Isolation: laying the terrain a check is about                             */
/* -------------------------------------------------------------------------- */

/** Fill a run of cells down one column with one kind. */
export async function fillColumn(
  h: Harness,
  col: number,
  fromRow: number,
  toRow: number,
  kind: TileKind,
): Promise<void> {
  for (let row = fromRow; row <= toRow; row += 1) {
    await h.debug.setTile(col, row, kind);
  }
}

/** Fill a run of cells across one row with one kind. */
export async function fillRow(
  h: Harness,
  row: number,
  fromCol: number,
  toCol: number,
  kind: TileKind,
): Promise<void> {
  for (let col = fromCol; col <= toCol; col += 1) {
    await h.debug.setTile(col, row, kind);
  }
}

/** Fill a rectangular block of cells with one kind. */
export async function fillBlock(
  h: Harness,
  block: { fromCol: number; toCol: number; fromRow: number; toRow: number },
  kind: TileKind,
): Promise<void> {
  for (let row = block.fromRow; row <= block.toRow; row += 1) {
    await fillRow(h, row, block.fromCol, block.toCol, kind);
  }
}

/**
 * A floor across the whole playable width at `row`, so a miner anywhere above it
 * lands rather than falling out of the scenario.
 *
 * `rock` by default, because rock is the kind that yields nothing: a floor of ore
 * would bank a unit the moment a check drilled it, and a floor of gas would end
 * the check in a detonation.
 */
export function layFloor(
  h: Harness,
  row: number,
  kind: TileKind = "rock",
): Promise<void> {
  return fillRow(h, row, PLAYABLE_COL_MIN, PLAYABLE_COL_MAX, kind);
}

/**
 * Lay the camp's ground: `row 1` solid across the playable width, with the cave
 * mouth left open, exactly as generation leaves it.
 *
 * An empty mine is open everywhere, `row 0` included, so a miner posed at the
 * camp falls the moment the first frame runs. Generation leaves `row 1` minable
 * apart from `(CAVE_MOUTH_COL, 1)`, and that is what holds the miner up while it
 * walks the camp — so a scene about the surface, the buildings, or a panel lays
 * it back rather than posing the miner in mid-air and pinning it.
 */
export async function layCamp(
  h: Harness,
  kind: TileKind = "rock",
): Promise<void> {
  await layFloor(h, 1, kind);
  await h.debug.setTile(CAVE_MOUTH_COL, 1, "tunnel");
}

/**
 * Open every cell of a block, so a scenario has room to move through it.
 *
 * A cleared mine is already open everywhere, so this is for a scene that laid
 * terrain and now wants a pocket back — the run-up in front of a wall, the space
 * under a miner that must fall.
 */
export function openBlock(
  h: Harness,
  block: { fromCol: number; toCol: number; fromRow: number; toRow: number },
): Promise<void> {
  return fillBlock(h, block, "tunnel");
}

/**
 * Stand the miner on top of the cell `(col, row)`, centred on its column, at rest.
 *
 * THAT CELL IS THE FLOOR UNDERFOOT, and so the cell a held down cut bites into —
 * not the one below it. A check that wants a gas pocket under the drill poses it
 * at `(col, row)` and stands the miner here with the same `row`.
 *
 * The cell the miner's BOX occupies is the one above, so a scene lays its floor
 * at `row` and leaves `row - 1` open.
 */
export async function standOn(
  h: Harness,
  col: number,
  row: number,
  facing?: Facing,
): Promise<void> {
  await h.debug.setMinerPosition(minerXOn(col), minerYOn(row));
  await h.debug.setMinerVelocity(0, 0);
  if (facing !== undefined) await h.debug.setFacing(facing);
}

/** Put the miner's box at a world position, at rest. */
export async function placeAt(h: Harness, x: number, y: number): Promise<void> {
  await h.debug.setMinerPosition(x, y);
  await h.debug.setMinerVelocity(0, 0);
}

/** Stand the miner on the camp ground at `col`, where it spawns by default. */
export function standAtCamp(
  h: Harness,
  col: number = SPAWN_COL,
  facing?: Facing,
): Promise<void> {
  return standOn(h, col, 1, facing);
}

/**
 * A one-tile shaft down `col`, open from `fromRow` to `toRow`, standing on the
 * solid cell beneath it, with solid walls either side.
 *
 * The scene a climb, a fall, or a sink is measured in: the walls are what stop a
 * miner drifting laterally out of the column, and the floor is what a fall lands
 * on and a down cut bites into.
 */
export async function digShaft(
  h: Harness,
  col: number,
  fromRow: number,
  toRow: number,
  wall: TileKind = "rock",
): Promise<void> {
  await fillColumn(h, col, fromRow, toRow, "tunnel");
  await fillColumn(h, col - 1, fromRow, toRow, wall);
  await fillColumn(h, col + 1, fromRow, toRow, wall);
  await h.debug.setTile(col, toRow + 1, wall);
}

/** Put an ore vein at a cell, at its band's full health. */
export function layOre(
  h: Harness,
  col: number,
  row: number,
  ore: Ore,
): Promise<void> {
  return h.debug.setOreTile(col, row, ore);
}

/** Put a material node at a cell, at its band's full health. */
export function layMaterial(
  h: Harness,
  col: number,
  row: number,
  material: Material,
): Promise<void> {
  return h.debug.setMaterialTile(col, row, material);
}

/* -------------------------------------------------------------------------- */
/* Isolation: posing the expedition's holdings                                */
/* -------------------------------------------------------------------------- */

/**
 * Pose the cargo bay as exactly the ore listed, and nothing else.
 *
 * `setCargo` sets one ore's count and leaves the rest, so a scene that wants a
 * known load clears the bay first — otherwise it is posing a load on top of
 * whatever the check before it banked.
 */
export async function stageCargo(
  h: Harness,
  ore: Partial<Record<Ore, number>>,
): Promise<void> {
  await h.debug.clearCargo();
  for (const [id, count] of Object.entries(ore)) {
    await h.debug.setCargo(id as Ore, count as number);
  }
}

/**
 * Load the bay with `ore` until the load fraction is at least `fraction`, and
 * report the fraction reached.
 *
 * One unit of one ore at a time, because the load is whole units of whole ores:
 * a fraction is reached by the unit that crosses it rather than exactly, which is
 * the point of the overload wall — the flag flips on the unit that crosses the
 * limit. The count is derived from the lift limit the snapshot reports, so it
 * follows the jetpack tier the scene posed rather than assuming tier 1.
 */
export async function loadToFraction(
  h: Harness,
  fraction: number,
  ore: Ore = "ferron",
): Promise<{ count: number; fraction: number }> {
  await h.debug.clearCargo();
  const { cargo } = await h.snapshot();
  const weight = ORES[ore].weight;
  const count = Math.ceil((fraction * cargo.liftLimitKg) / weight);
  await h.debug.setCargo(ore, count);
  const after = await h.snapshot();
  return { count, fraction: loadFraction(after) };
}

/** Pose the six field-supply counts as exactly what is listed, and nothing else. */
export async function stageItems(
  h: Harness,
  items: Partial<Record<ItemId, number>>,
): Promise<void> {
  await h.debug.clearItems();
  for (const [id, count] of Object.entries(items)) {
    await h.debug.setItemCount(id as ItemId, count as number);
  }
}

/** Pose every upgrade track at one tier, so a check reads one configuration. */
export async function stageTiers(
  h: Harness,
  tiers: Partial<Record<UpgradeTrack, number>>,
): Promise<void> {
  for (const [track, tier] of Object.entries(tiers)) {
    await h.debug.setTier(track as UpgradeTrack, tier as number);
  }
}

/* -------------------------------------------------------------------------- */
/* Compound sequences                                                         */
/* -------------------------------------------------------------------------- */
//
// Each of these poses a situation through `window.__deepcore` and then lets the
// real simulation run. The geometry and the tolerances they encode are the ones
// the specification established, and they are the same in the engine-backed
// projects next door.

/**
 * One key per action, for the sequences that press one.
 *
 * The FIRST code `specs/controls.md` binds to each action, because an action
 * bound to several is satisfied by any of them and a scenario needs one. It is
 * DERIVED from `ACTIONS` rather than restated, so the bindings are stated once,
 * in `constants.ts`, where they were transcribed from the specification. A check
 * about the bindings presses each of an action's codes itself.
 */
export const ACTION_KEY = Object.fromEntries(
  Object.entries(ACTIONS).map(([action, codes]) => [action, codes[0]]),
) as Record<Action, string>;

/**
 * Open an expedition through the SURFACE alone: the mode, the size, a mine
 * generated from the seed, and the miner standing at the spawn.
 *
 * This is how a check about the MINE reaches its ground without driving the
 * menus — a build with a broken menu and a working world must fail the navigation
 * checks and pass the generation ones. A check about the menus enters with
 * {@link startWithKeys} instead.
 */
export async function openExpedition(
  h: Harness,
  options: { seed?: number; size?: WorldSize; mode?: Mode } = {},
): Promise<void> {
  await h.debug.setAutoStep(false);
  await h.debug.reset({ seed: options.seed ?? DEFAULT_SEED });
  if (options.mode !== undefined) await h.debug.setMode(options.mode);
  if (options.size !== undefined) await h.debug.setWorldSize(options.size);
  await h.debug.generateMine();
  await h.debug.setScreen("in-mine");
  await standAtCamp(h);
}

/**
 * Start an expedition from the title the way a player does: menu keys only.
 *
 * The title menu leads with `CONTINUE` only while a save exists, so this clears
 * the slot first — otherwise the index every step below counts from moves under
 * it, and a check about the menus would be reading a menu it did not mean to
 * open. `NEW EXPEDITION` then leads, the mode is one step down for Hardcore, and
 * the size is however many steps down its entry sits.
 */
export async function startWithKeys(
  h: Harness,
  options: { mode?: Mode; size?: WorldSize } = {},
): Promise<void> {
  const mode = options.mode ?? "standard";
  const size = options.size ?? "standard";
  await h.debug.clearSave();
  await h.debug.reset();
  await h.debug.setScreen("title");

  const down = ACTION_KEY.down;
  const confirm = ACTION_KEY.activate;

  // title -> mode-select, on `NEW EXPEDITION`, which leads with no save banked.
  await h.tap(confirm);
  // mode-select: STANDARD leads, HARDCORE is one down.
  if (mode === "hardcore") await h.tap(down);
  await h.tap(confirm);
  // size-select: QUICK, STANDARD, MARATHON, in that order.
  const steps = { quick: 0, standard: 1, marathon: 2 }[size];
  for (let i = 0; i < steps; i += 1) await h.tap(down);
  await h.tap(confirm);
}

/**
 * Stand the miner at the building `id`, on the camp ground, and report its
 * footprint.
 *
 * The footprints are the BUILD'S — `specs/world.md` fixes only that each sits on
 * the ground line inside the playable columns, spaced apart — so a check that
 * activates one asks the surface where it is rather than assuming a layout. The
 * miner is centred on the footprint, which is the one spot inside it whatever
 * reach the build gives its buildings.
 */
export async function standAtBuilding(
  h: Harness,
  id: string,
): Promise<BuildingBox> {
  const boxes = await h.debug.buildings();
  const box = boxes.find((b) => b.id === id);
  if (box === undefined) {
    fail(
      `a surface building with id "${id}" among the six specs/world.md fixes`,
      `buildings() reported ${boxes.length === 0 ? "none" : boxes.map((b) => b.id).join(", ")}`,
    );
  }
  await placeAt(h, box.x + box.w / 2 - MINER_W / 2, CAMP_MINER_Y);
  return box;
}

/** What a driven cut did. */
export interface CutResult {
  /** Whether the target cell broke inside the sweep. */
  broke: boolean;
  /** Frames driven before the sample that saw it break. */
  frames: number;
  /** The cell as it stands at the end of the sweep. */
  tile: TileRead;
  snapshot: DeepcoreSnapshot;
}

/**
 * Hold a direction until the cell it cuts breaks, and report the instant it did.
 *
 * The real drill: the key goes down through the surface's own input, the game's
 * update lands the hits at its own interval and spends its own fuel, and the
 * sweep watches the cell rather than the clock. Sampled every frame, because the
 * frame the cell breaks on is what several checks read.
 *
 * The key is released before this returns, so a caller reads a settled miner
 * rather than one still boring into whatever was behind the cell.
 */
export async function driveCut(
  h: Harness,
  direction: "down" | "left" | "right",
  target: CellRef,
  options: UntilOptions = {},
): Promise<CutResult> {
  const code = ACTION_KEY[direction];
  await h.hold(code);
  try {
    // The sweep is over the CELL rather than the snapshot, which is what
    // `until` reads, so the loop is written out here rather than borrowed.
    const maxFrames = options.maxFrames ?? 600;
    const poll = Math.max(1, options.poll ?? 1);
    let frames = 0;
    let tile = await h.tileAt(target.col, target.row);
    while (frames < maxFrames && tile.kind !== "tunnel") {
      const step = Math.min(poll, maxFrames - frames);
      await h.advance(step);
      frames += step;
      tile = await h.tileAt(target.col, target.row);
    }
    return {
      broke: tile.kind === "tunnel",
      frames,
      tile,
      snapshot: await h.snapshot(),
    };
  } finally {
    await h.release(code);
  }
}

/** What a held movement did. */
export interface MoveResult {
  /** The miner's box position before the measured window. */
  start: { x: number; y: number };
  /** And after it. */
  end: { x: number; y: number };
  dx: number;
  dy: number;
  snapshot: DeepcoreSnapshot;
}

/**
 * Hold a key for `frames` frames and report how far the miner's box travelled.
 *
 * Nothing here poses a velocity: the key goes down and the game's own movement
 * code moves the miner, so what is measured is the build's walk, thrust or fall
 * rather than an integration the harness did.
 */
export async function driveHold(
  h: Harness,
  code: string,
  frames: number,
  options: { leadFrames?: number } = {},
): Promise<MoveResult> {
  await h.hold(code);
  try {
    // With a lead, the key is already down for `leadFrames` before the measured
    // window opens, so the window reads a miner in steady travel rather than the
    // frame the press was first seen on.
    if (options.leadFrames) await h.advance(options.leadFrames);
    const before = (await h.snapshot()).miner;
    await h.advance(frames);
    const after = await h.snapshot();
    return {
      start: { x: before.x, y: before.y },
      end: { x: after.miner.x, y: after.miner.y },
      dx: after.miner.x - before.x,
      dy: after.miner.y - before.y,
      snapshot: after,
    };
  } finally {
    await h.release(code);
  }
}

/**
 * Drop the miner from `height` world units above the floor at `(col, floorRow)`
 * and run the real physics until it lands, reporting the speed it landed at and
 * the hull it cost.
 *
 * The fall is the game's own: gravity, the terminal speed the load sets, and the
 * impact rule all run from a miner posed at rest in open air.
 */
export async function driveFall(
  h: Harness,
  col: number,
  floorRow: number,
  height: number,
  options: UntilOptions = {},
): Promise<{
  landed: boolean;
  impactSpeed: number;
  hullBefore: number;
  hullAfter: number;
  snapshot: DeepcoreSnapshot;
}> {
  await placeAt(h, minerXOn(col), minerYOn(floorRow) - height);
  const before = (await h.snapshot()).miner;
  let fastest = 0;
  const swept = await h.until(
    (s) => {
      if (s.miner.vy > fastest) fastest = s.miner.vy;
      return s.miner.grounded;
    },
    { maxFrames: options.maxFrames ?? 900, poll: options.poll ?? 1 },
  );
  // One frame past the first that reads as grounded. A build is free to report a
  // miner about to touch down as grounded — the flag says it is resting on solid
  // ground, and a probe a unit or two ahead of the box is a conformant way to
  // answer that — so the frame the flag first turns on is not necessarily the
  // frame the contact was resolved and the hull was billed on. The extra frame
  // costs a settled miner nothing and is what makes the reading the LANDING
  // rather than the approach to it. The speed is the fastest the sweep saw, which
  // is the speed it arrived at whichever frame resolved it.
  if (swept.hit) await h.advance(1);
  const settled = await h.snapshot();
  return {
    landed: swept.hit,
    impactSpeed: fastest,
    hullBefore: before.hull,
    hullAfter: settled.miner.hull,
    snapshot: settled,
  };
}

/* -------------------------------------------------------------------------- */
/* Rendering and colour                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The RGB distance two sampled colours must exceed to count as "clearly apart".
 *
 * `specs/overview.md` requires that a player tells one band's rock from the next,
 * an ore vein from plain rock, a gemstone from an ore, and lava from safe ground,
 * and it deliberately fixes no palette — so distinguishability is the whole of
 * what a visibility check can read, and a number is the only way to read it. 50
 * of the 441 the RGB cube spans: comfortably crossed by two colours a player
 * would call different, and not by two shades of the same one.
 */
export const DISTINCT_MIN = 50;

/**
 * How far out a colour sample's four neighbours sit, in logical units.
 *
 * Six, which at an 80-unit tile stays well inside the cell whatever the build
 * drew there, so one stray anti-aliased or glowing pixel cannot swing the
 * reading. The package's own default is four, because how far "comfortably
 * inside the body" reaches is the case's geometry rather than the harness's.
 */
const SAMPLE_RADIUS = 6;

/**
 * The rendered colour at a logical stage point, averaged over a small cluster:
 * the centre pixel plus four neighbours {@link SAMPLE_RADIUS} units out.
 */
export function sampleColor(h: Harness, x: number, y: number): Promise<Rgb> {
  return sampleColorOf(h, x, y, SAMPLE_RADIUS);
}

/**
 * The rendered colour over the centre of a WORLD cell, through the camera the
 * snapshot reports.
 *
 * The reading a terrain check takes: pose one cell, drive a frame, and sample
 * where the specification says that cell is drawn.
 */
export async function sampleCell(
  h: Harness,
  snapshot: DeepcoreSnapshot,
  col: number,
  row: number,
): Promise<Rgb> {
  const centre = cellCenter(col, row);
  const at = worldToStage(snapshot, centre.x, centre.y);
  return sampleColor(h, at.x, at.y);
}

/* -------------------------------------------------------------------------- */
/* Small shared readings                                                      */
/* -------------------------------------------------------------------------- */

/** The Core tile's cell at a size, without asking the build where it is. */
export function coreCell(size: WorldSize): CellRef {
  return { col: CORE_COL, row: coreRowFor(size) };
}

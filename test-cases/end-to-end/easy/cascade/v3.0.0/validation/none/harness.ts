// Cascade — the shared validator harness. CASE-PROVIDED.
//
// Every check in this suite is an ordinary vitest test that drives the built site
// IN A REAL BROWSER. There is nothing to import: an engineless run seeds no
// `src/` at all, so the build wrote its own frame loop, its own canvas fit, its
// own pointer input, its own audio, its own debug overlay, and its own
// `window.__cascade` — and the only place any of that exists is a page that has
// loaded the bundle. So the project serves `dist/`, loads it in Chromium, and
// reaches the game the way anything reaches it: over the surface
// `specs/instrumentation.md` told the build to install.
//
// IT IS STILL A VITEST PROJECT, AND THAT IS DELIBERATE. The runner locates the
// build output before it chooses between the vitest and browser paths, so `dist/`
// is on disk by the time this project runs. Staying a vitest project is what lets
// the case name ONE script per review item and have it resolve under all three
// engines — `validation/deal/full-deck.test.ts` is the same path whichever engine
// the run selected — and what keeps `format = 2` resolution passing.
//
// WHAT A CHECK READS. The game's own state (through `window.__cascade`'s
// `snapshot`), the frames the harness itself drove, the operations the build
// issued against its 2D context, the pixels they left on the canvas, and the
// sounds it emitted. Nothing here fabricates an outcome: the scenario helpers
// below only ARRANGE the table through the surface, and the real update the build
// wrote is what runs from there.
//
// THE HARNESS OWNS EVERY COMPOUND SEQUENCE. The debug surface is atomic by
// design — each operation sets one field, reads the state, moves the clock, or is
// one of the game's own events (`specs/instrumentation.md`) — so "a live table
// with a King on column 0 and the Ace of spades home" is a helper here, built out
// of those atomic operations, and never an operation on the surface. There is no
// `setBoard` and there must not be: a patch operation would impose the case's own
// state layout on the build. A CHECK TAKES ONLY THE PART IT ASKS FOR: nothing
// below does anything a caller did not ask for, and a check that needs half a
// sequence calls the operations it needs.
//
// AND THE HELPERS FIX GEOMETRY, NEVER THRESHOLDS. A helper poses a table, drives
// a gesture, or reads a value out of a snapshot. Every tolerance a check
// asserts — a percentage, a colour distance, a number of units — is stated in
// that check, next to the figure `specs/` fixes for it, because a helper that
// carried the tolerance would hide what the check is really asserting. Look for a
// threshold in this file and you will not find one. The FIGURES themselves live in
// `./constants.ts`, restated from `specs/` because there is no `src/` to import
// them from, and the geometry section below derives positions from them and
// nothing else.
//
// AND NONE OF THEM ASSERTS A VERDICT. A helper fails only when the game is not
// even in the situation the caller's scenario needs — a press that lifted nothing
// when the caller asked to drag a run — and then with what it needed named,
// through {@link failSurface} or `fail` from `./assert`.
//
// THE CLOCK IS THE SURFACE'S. Nothing outside an engineless build owns its loop,
// so `specs/instrumentation.md` puts the clock on the surface: `setAutoStep(false)`
// takes the game off real time and `advance(seconds, frames)` runs whole frames of
// a chosen length. Every harness opens by taking the game off the clock, so a
// check asks for a number of frames and gets exactly that number — no polling, no
// waiting, and no measurement of the machine it ran on. Under the two engines
// those two operations do not exist and the clock is the engine's; this is the one
// part of a check that reads differently here.
//
// A MISSING SURFACE NEVER THROWS FROM A HOOK. Every suite builds its harness in a
// `beforeEach`, and a throw there would bury the real verdict under a hook
// failure that names nothing. So {@link createHarness} always comes back: a build
// with no usable surface comes back as a {@link Harness.surfaceFault} over a
// surface whose every access fails BY ASSERTION at the moment a check first
// reaches for an operation.
//
// EVERYTHING CROSSING INTO THE PAGE IS ASYNC. That is the whole of the difference
// between a suite here and its counterpart under an engine: `await h.snapshot()`
// rather than `h.snapshot()`, `await h.debug.setScreen(...)` rather than
// `h.debug.setScreen(...)`. The scenarios, the tolerances, and the assertions are
// the same ones, because they are the case's rather than the runtime's.
//
// ONE SERVER, ONE BROWSER, ONE PAGE PER HARNESS. `globalSetup.ts` starts the
// server and the browser once for the whole project; this module connects to
// them from inside each suite's worker and opens a page per harness, so every
// check drives a build that has just started and no check can be affected by
// what the one before it pressed, dealt or muted.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { expect, inject } from "vitest";
import type { Browser, BrowserContext, Page } from "playwright";
import { connectChromium } from "./chromium";
import { fail } from "./assert";
import {
  CARD_H,
  CARD_W,
  COLUMN_BOTTOM_LIMIT,
  COLUMN_X,
  FACE_DOWN_OFFSET,
  FACE_UP_OFFSET,
  FACE_UP_OFFSET_MIN,
  FOUNDATION_X,
  OVERLAY_KEY,
  RANK_MAX,
  RANK_MIN,
  STAGE_H,
  STAGE_W,
  STOCK_X,
  SUITS,
  TABLEAU_Y,
  TOP_ROW_Y,
  UNBOUND_KEY,
  WASTE_X,
  type CardColor,
  type Rect,
  type Suit,
} from "./constants";

export type { CardColor, Rect, Suit } from "./constants";

declare module "vitest" {
  export interface ProvidedContext {
    /** Where the built site is served, from `globalSetup.ts`. */
    cascadeUrl: string;
    /** The one Chromium every suite worker connects to. */
    cascadeBrowserWs: string;
  }
}

/* -------------------------------------------------------------------------- */
/* The contract the build owes                                                */
/* -------------------------------------------------------------------------- */

/** The handle an engineless build installs its surface on. */
export const HANDLE = "__cascade";

/**
 * Every operation `specs/instrumentation.md` requires on the surface under this
 * engine, including the two clock operations that exist only here.
 *
 * The list is the whole of it, in the order the specification states them, so
 * `instrumentation/surface-present` can assert completeness by naming this one
 * constant and a build missing anything is named for exactly what it is missing.
 */
export const REQUIRED_OPS = [
  // The clock (this engine alone).
  "setAutoStep",
  "advance",
  // The core.
  "reset",
  "snapshot",
  // The screen.
  "setScreen",
  // The cards.
  "addCard",
  "removeCard",
  "setCardFaceUp",
  "clearPile",
  "clearTable",
  // The waste's sets.
  "addWasteSet",
  "clearWasteSets",
  // The game's own events.
  "deal",
  "turnStock",
  "move",
  "autoMove",
  // The pointer.
  "pointerDown",
  "pointerMove",
  "pointerUp",
  // The faculty gates.
  "setAutoFlip",
  "setWinDetect",
  "setLaunching",
  "setTrailPainting",
  // The cascade.
  "addFlyer",
  "setFlyerPosition",
  "setFlyerVelocity",
  "removeFlyer",
  "clearFlyers",
  "setLaunchClock",
  "clearTrail",
] as const;

/** The four screens the game moves between (`specs/screens.md`). */
export type Screen = "title" | "howto" | "playing" | "won";

/** How the surface names one of the thirteen piles (`specs/instrumentation.md`). */
export type PileName = "stock" | "waste" | "foundation" | "tableau";

/** A pile a run may be lifted from. The stock is never a source. */
export type SourcePile = "waste" | "foundation" | "tableau";

/** A pile a run may land on. */
export type TargetPile = "foundation" | "tableau";

/** One card, as a snapshot reports it. `rank` runs 1 (Ace) to 13 (King). */
export interface CardView {
  id: number;
  suit: Suit;
  rank: number;
  color: CardColor;
  faceUp: boolean;
}

/** The run in hand, as a snapshot reports it. */
export interface DragView {
  /** Bottom to top, so `cards[0]` is the grabbed card and leads the run. */
  cards: CardView[];
  fromPile: SourcePile;
  fromIndex: number;
  /** The TOP-LEFT of `cards[0]`. */
  x: number;
  y: number;
}

/** The pile a release would land the held run on. */
export interface DropTargetView {
  pile: TargetPile;
  index: number;
}

/** A card in flight, as a snapshot reports it. `x`/`y` is its TOP-LEFT. */
export interface FlyerView {
  id: number;
  suit: Suit;
  rank: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/**
 * The state as `snapshot()` reports it (`specs/instrumentation.md`).
 *
 * Every field an operation can set is here, so every operation is verifiable by
 * setting a value and reading it back. Every `x` and `y` is a card's TOP-LEFT in
 * logical stage units, matching the anchors `specs/table.md` fixes; this is the
 * opposite convention from Wireworm's centres and it is deliberate.
 */
export interface CascadeSnapshot {
  version: number;
  screen: Screen;
  /** This build's `DEAL_MODE`. */
  dealMode: string;
  /** This build's `TURN_COUNT`. A COMMON CHECK SIZES ITSELF TO THIS. */
  turnCount: number;
  /** This build's `DEAL_MODE_LABEL`, the text it draws. */
  dealModeLabel: string;
  /** The game's copy of the runtime's mute bit, refreshed in every update. */
  muted: boolean;

  autoFlip: boolean;
  winDetect: boolean;
  launching: boolean;
  trailPainting: boolean;

  /** Each pile is ordered BOTTOM TO TOP, so the last entry is the card on top. */
  stock: CardView[];
  waste: CardView[];
  /** Cards on each turned set, oldest first. */
  wasteSets: number[];
  /** The newest entry of `wasteSets`, and `0` when the memory is empty. */
  wasteVisibleCount: number;
  foundations: CardView[][];
  tableau: CardView[][];

  drag: DragView | null;
  dropTarget: DropTargetView | null;

  pointer: { x: number; y: number; down: boolean };
  /** The most recent press, which the double-click rule is measured against. */
  lastPress: { x: number; y: number; at: number } | null;

  launchClock: number;
  /** Cards the cascade has counted out, 0 to 52. NOT derived from the piles. */
  launched: number;
  flyers: FlyerView[];
  cascadeDone: boolean;
  /** Stamps on the painted layer since it was last cleared. */
  trailStamps: number;

  simTime: number;
}

/**
 * The operations a check poses the game through. Every one crosses into the page,
 * so every one is awaited.
 *
 * `advance` here is the SURFACE's own clock operation, taking seconds and a frame
 * count. It is not {@link Harness.advance}, which takes a number of frames of the
 * harness's own clock and is what almost every check wants. Calling this one
 * directly runs frames the harness did not count and no recorder frame boundary
 * was opened around, which is exactly what `instrumentation/advances-in-frames`
 * needs and what nothing else does.
 */
export interface CascadeDebugApi {
  reset(options?: { seed?: number }): Promise<void>;
  snapshot(): Promise<CascadeSnapshot>;

  setAutoStep(enabled: boolean): Promise<void>;
  advance(seconds: number, frames?: number): Promise<void>;

  setScreen(screen: Screen): Promise<void>;

  addCard(
    pile: PileName,
    index: number,
    suit: Suit,
    rank: number,
    faceUp: boolean,
  ): Promise<void>;
  removeCard(id: number): Promise<void>;
  setCardFaceUp(id: number, faceUp: boolean): Promise<void>;
  clearPile(pile: PileName, index: number): Promise<void>;
  clearTable(): Promise<void>;

  addWasteSet(count: number): Promise<void>;
  clearWasteSets(): Promise<void>;

  deal(): Promise<void>;
  turnStock(): Promise<void>;
  /** `true` when the game's own rules accepted the move. */
  move(
    fromPile: PileName,
    fromIndex: number,
    fromRow: number,
    toPile: PileName,
    toIndex: number,
  ): Promise<boolean>;
  /** `true` when the named pile's playable card went home. */
  autoMove(pile: PileName, index: number): Promise<boolean>;

  pointerDown(x: number, y: number): Promise<void>;
  pointerMove(x: number, y: number): Promise<void>;
  pointerUp(x: number, y: number): Promise<void>;

  setAutoFlip(enabled: boolean): Promise<void>;
  setWinDetect(enabled: boolean): Promise<void>;
  setLaunching(enabled: boolean): Promise<void>;
  setTrailPainting(enabled: boolean): Promise<void>;

  addFlyer(
    suit: Suit,
    rank: number,
    x: number,
    y: number,
    vx: number,
    vy: number,
  ): Promise<void>;
  setFlyerPosition(id: number, x: number, y: number): Promise<void>;
  setFlyerVelocity(id: number, vx: number, vy: number): Promise<void>;
  removeFlyer(id: number): Promise<void>;
  clearFlyers(): Promise<void>;
  setLaunchClock(seconds: number): Promise<void>;
  clearTrail(): Promise<void>;
}

/* -------------------------------------------------------------------------- */
/* The step schedule                                                          */
/* -------------------------------------------------------------------------- */
//
// WHY 240 Hz IS THE DEFAULT FRAME. Cascade runs on no fixed timestep: every rate
// is per second and integrated against the delta the frame supplies
// (`specs/overview.md`, `specs/victory.md`), so there is no case-wide step size
// and the manifest declares no `tick_hz`. What is left is the harness's own
// choice of how finely to divide the game time a check asks for, and every figure
// the case fixes falls on a whole number of frames at 240 Hz: `DOUBLE_CLICK_WINDOW`
// 0.30 s is 72 frames, the double-click checks' 0.1 s and 0.4 s are 24 and 96, and
// half a second and a second are 120 and 240.
//
// It is also the step the `cascade` group is written against. Under the
// semi-implicit Euler integration `specs/victory.md` fixes, a quantity UNDER
// ACCELERATION depends on how an interval was divided into frames — one second as
// one frame and as sixty frames put a flyer some 885 units apart, and that is the
// correct behaviour of the stated integration rather than a defect to tolerance
// away — so the group states its step once and every timing item in it uses the
// same one. A `1/60` s step makes the cadence figures unmeetable; do not vary it
// item by item.
//
// `LAUNCH_INTERVAL` (0.18 s) is the one figure that is NOT a whole number of
// frames at 240 Hz, and no item needs it to be: `launch-cadence` advances three
// seconds and reads the count and the mean gap, and the launch clock carries its
// remainder so the cadence does not drift.

/** A source of frame deltas, in milliseconds. */
export interface Clock {
  /** The next frame's delta, in ms. */
  delta(): number;
}

/** The frame the suite steps in, in milliseconds. */
export const TICK_HZ = 240;
export const TICK_MS = 1000 / TICK_HZ;

/** Every frame the same length. */
export class ConstantClock implements Clock {
  constructor(private readonly ms: number) {}
  delta(): number {
    return this.ms;
  }
}

/** A repeating pattern of steps: what an uneven but predictable display gives. */
export class SequenceClock implements Clock {
  private index = 0;
  constructor(private readonly stepsMs: readonly number[]) {
    if (stepsMs.length === 0) {
      throw new RangeError("SequenceClock needs at least one step, got none");
    }
  }
  delta(): number {
    const step = this.stepsMs[this.index % this.stepsMs.length];
    this.index += 1;
    return step;
  }
}

/**
 * A hash of the seed and the frame index, avalanched so that neighbouring
 * indices — which is all a frame counter ever produces — do not yield
 * neighbouring outputs. The constants and the order are the engine's
 * (`packages/simple-2d/src/clocks.ts`), so a seed means the same thing here as
 * it does in the two engine-backed projects next door.
 */
function hash32(seed: number, index: number): number {
  let h =
    (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(index | 0, 0x85ebca6b)) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  h = Math.imul(h, 0x21f0aaad) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h, 0x735a2d97) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  return h >>> 0;
}

/**
 * A seeded draw from a range, indexed by frame: the clock that stands in for a
 * real machine under load. The seed is mandatory, because a claim that a build is
 * delta-time independent is worth making only when the failing case replays.
 */
export class JitterClock implements Clock {
  private index = 0;
  private readonly spanMs: number;
  constructor(
    private readonly minMs: number,
    maxMs: number,
    private readonly seed: number,
  ) {
    if (maxMs < minMs) {
      throw new RangeError(
        `JitterClock needs maxMs >= minMs, got minMs ${minMs} and maxMs ${maxMs}`,
      );
    }
    this.spanMs = maxMs - minMs;
  }
  delta(): number {
    const index = this.index;
    this.index += 1;
    return (
      this.minMs + (hash32(this.seed, index) / 0x1_0000_0000) * this.spanMs
    );
  }
}

/** Seconds of simulated time in `frames` frames of the default clock. */
export function seconds(frames: number): number {
  return frames / TICK_HZ;
}

/** Frames of the default clock covering `duration` seconds. */
export function framesFor(duration: number): number {
  return Math.round(duration * TICK_HZ);
}

/**
 * The frames per second of game time a WAIT is run at.
 *
 * Several checks have to sit through a stretch of the victory cascade before they
 * can read anything — the whole run-out for `cascade/cascade-completes`,
 * `screens/won-shows-message` and `cascade/trail-survives-completion`, and twenty
 * launches for `presentation/overlay-shows-cascade`. Twelve and a half seconds of
 * game time at {@link TICK_HZ} is three thousand frames, and every one of them is
 * a full update and render of up to fifty-two cards inside a real browser. The
 * WAIT, and not the reading, is what those checks cost — and what they cost is
 * what a busy host turns into a timeout against a build that did nothing wrong.
 *
 * NOTHING IS READ DURING A WAIT. What the checks read afterwards is where the
 * cascade ENDED: the build's own end flag, the launched count, the flight being
 * empty, the text the next frame drew, how much of the table is still painted.
 * None of it is quantised to a frame, which is what the fine step above exists
 * for. `specs/instrumentation.md` has the game integrate whatever delta a frame
 * supplies and `instrumentation/advances-in-frames` is the point that grades
 * exactly that, so a wait taken in coarser frames arrives at the same place — the
 * references were measured at 240, 120, 60 and 30 Hz and end `cascadeDone` with
 * all fifty-two launched and nothing in flight at the same `12.57` s of game time
 * at every one of them.
 *
 * Sixty is also what a browser gives a game on an ordinary display, so it is the
 * rate the ending a player sees really runs at. A check reads at {@link TICK_HZ}
 * either side of the wait; only the wait itself is coarse.
 */
export const RUNOUT_HZ = 60;

/**
 * How many frames a SWEEP drives per crossing into the page.
 *
 * A sweep runs frames until something happens and then reads the frame it
 * happened on. Driving one frame per crossing made the reading cost a round trip
 * per frame — tens of milliseconds on an idle host and hundreds on a loaded one —
 * so a sweep of a second of game time spent a minute of a busy machine's time
 * arriving at an answer that was decided in the first two hundred frames.
 *
 * IT CHANGES NO READING. {@link Harness.until} applies its predicate to every
 * frame of the batch it drives and reports the frame the predicate first held on
 * and the state that frame left, so a batched sweep answers exactly what a
 * frame-at-a-time one answers. What it changes is where the harness STANDS
 * afterwards: up to `chunk - 1` frames past the frame it reported. Fifty
 * milliseconds of game time is the size chosen for that — small against every
 * span these sweeps end on, and large enough that a sweep is a dozen crossings
 * rather than hundreds.
 *
 * So it belongs only to a sweep whose next act is not a reading of the moment it
 * stopped on. A sweep that has to leave the game exactly where it found the
 * event — every audio point, which counts what sounded on which frame — takes
 * the default of one instead and says so.
 */
export const SWEEP_CHUNK_FRAMES = framesFor(0.05);

/* -------------------------------------------------------------------------- */
/* The harness                                                                */
/* -------------------------------------------------------------------------- */

/** One recorded operation on the 2D context, in the order the render made it. */
export type DrawCall =
  | {
      kind: "call";
      method: string;
      args: unknown[];
      /**
       * For `fillText` and `strokeText`, the run's measured width in the
       * context's own units and the alignment in force, both read off the
       * context at the call. Only that context can say how wide a run is: the
       * width follows from the font, the letter spacing and the direction, none
       * of which the call itself carries. {@link textDraws} turns the pair into
       * the run's span.
       */
      width?: number;
      textAlign?: string;
    }
  | { kind: "set"; property: string; value: unknown };

/** A sound the build emitted, and the frame of the drive it emitted it on. */
export interface TimedCue {
  /** The frame it sounded on, 1-based, as {@link Harness.frame} reports. */
  frame: number;
  /** The frame loop's simulated time at that frame, in milliseconds. */
  t: number;
}

/** How the stage is mapped onto the canvas: one uniform scale and a letterbox. */
export interface Viewport {
  width: number;
  height: number;
  scale: number;
  offsetX: number;
  offsetY: number;
}

export interface HarnessOptions {
  /** The clock each frame takes its delta from. Defaults to 240 Hz. */
  clock?: Clock;
  /** The window's CSS width. Defaults to the logical stage width. */
  cssWidth?: number;
  /** The window's CSS height. Defaults to the logical stage height. */
  cssHeight?: number;
  /** Device pixels per CSS pixel. Defaults to 1, so one device pixel is one unit. */
  dpr?: number;
  /**
   * Whether to call `reset()` on the way in. Defaults to `true`.
   *
   * A harness normally resets, so a check starts from the state
   * `specs/instrumentation.md` fixes rather than from whatever the build chose to
   * initialize with. Pass `false` only where the requirement IS what the build
   * initialized with, since `reset` would overwrite the very reading — today that
   * is `screens/opens-on-title` and nothing else. The clock is stopped either
   * way, so a build handed over this way still changes only when the harness says
   * so.
   */
  reset?: boolean;
}

/**
 * One operation on the build's surface: the name the specification gives it, and
 * the arguments it takes.
 *
 * What {@link Harness.pose} performs. A pose is a run of surface calls with
 * nothing to decide between them — thirteen `addCard`s that lay a foundation, say
 * — and performing them one await at a time costs a round trip into the page
 * each, which is a cost of the HOST rather than of the build.
 */
export interface SurfaceCall {
  op: string;
  args: readonly unknown[];
}

/** How far a sweep may run, and how many frames it drives per crossing. */
export interface UntilOptions {
  maxFrames?: number;
  /**
   * How many frames one crossing into the page runs. Defaults to `1`.
   *
   * IT DOES NOT CHANGE WHAT IS READ. The predicate is applied to EVERY frame
   * whatever this is, because the whole series comes back, so the frame reported
   * and the state reported are the frame and the state the predicate first held
   * on, exactly as they are at `1`. What it changes is the harness's own
   * position: a sweep that batches has already run the rest of its last batch by
   * the time it knows, so it stands up to `chunk - 1` frames past the frame it
   * reports.
   *
   * So `1` is the default and is what a check whose NEXT act is a reading of the
   * moment the sweep stopped on wants — every audio point, which counts what
   * sounded on which frame. A check that only reads what the sweep hands back
   * passes {@link SWEEP_CHUNK_FRAMES}, where the size and the reason for it are
   * stated once.
   */
  chunk?: number;
}

/** What a sweep found: whether the predicate ever held, and where it held. */
export interface UntilResult {
  hit: boolean;
  /** Frames advanced before the sample the predicate first held on. */
  frames: number;
  /**
   * That sample's frame, as {@link Harness.frame} counts them.
   *
   * The frame the predicate held on, and NOT where the harness now stands: a
   * batched sweep ({@link UntilOptions.chunk}) has run the rest of its last
   * batch. A check that names the frame an event happened on reads this rather
   * than `Harness.frame()`.
   */
  at: number;
  snapshot: CascadeSnapshot;
}

/** How far a coarse sweep may run, and how much game time separates two samples. */
export interface SkipOptions {
  maxSeconds?: number;
  pollSeconds?: number;
  /** Frames per second of game time inside each poll. Defaults to {@link TICK_HZ}. */
  hz?: number;
}

/** What a coarse sweep found. */
export interface SkipResult {
  hit: boolean;
  /** Seconds of game time covered before the sample that ended the sweep. */
  elapsed: number;
  snapshot: CascadeSnapshot;
}

export interface Harness {
  /** The page the build is running in. For a check that needs Playwright itself. */
  readonly page: Page;
  /**
   * The surface the BUILD installed, as operations that cross into the page.
   *
   * Read off `window.__cascade` and never constructed here — see
   * {@link unexposedSurface}.
   */
  readonly debug: CascadeDebugApi;
  /**
   * Why the build's surface cannot be driven, or `null` when it can.
   *
   * A fault here is the build's: the surface is missing, or it is missing an
   * operation the specification requires. It says what was found
   * (`window.__cascade was still absent 10s after the page loaded`), and
   * {@link failSurface} pairs it with what the specification requires. Every
   * operation fails BY ASSERTION with that pair rather than throwing, so a
   * missing surface lands as the verdict of every point that reaches for it —
   * and, crucially, a harness built in a `beforeEach` still comes back, so the
   * fault is reported by the check rather than buried in a hook.
   */
  readonly surfaceFault: string | null;
  /** Everything the page logged to `console.error`, or threw, oldest first. */
  readonly pageErrors: string[];

  /** The frames this harness has driven, 1-based, as a recorded frame counts them. */
  frame(): number;
  /** The simulated time those frames covered, in milliseconds. */
  timeMs(): number;

  /** A fresh read of the game's state through the build's `snapshot`. */
  snapshot(): Promise<CascadeSnapshot>;
  /**
   * Perform surface operations back to back, in one crossing, and hand back what
   * each of them returned.
   *
   * The SAME operations in the SAME order a run of awaits performs, and the build
   * cannot tell the difference: nothing advances between them either way, because
   * every pose operation `specs/instrumentation.md` names resolves the moment it
   * is called. What it spares is a round trip per operation. An operation that
   * throws stops the run there, exactly as an awaited one does.
   */
  pose(calls: readonly SurfaceCall[]): Promise<unknown[]>;
  /** Run `frames` frames back to back, each the length the clock says. */
  advance(frames: number): Promise<void>;
  /** Advance until `predicate` holds, reading the state every frame left. */
  until(
    predicate: (snapshot: CascadeSnapshot) => boolean,
    options?: UntilOptions,
  ): Promise<UntilResult>;
  /**
   * Run `frames` frames one at a time and hand back the state each one left.
   *
   * `samples[0]` is the state after the first frame. The frames are the frames
   * {@link advance} runs — one `advance(dt, 1)` inside one recorded frame
   * boundary — and the reading is the reading a per-frame `advance` then
   * `snapshot` pair takes; what it does not do is pay a round trip into the page
   * for each of them.
   */
  sample(frames: number): Promise<CascadeSnapshot[]>;
  /**
   * Run `duration` seconds of game time WITHOUT opening a recorded frame.
   *
   * The same real update the loop runs, `hz` frames per second of it, but off
   * camera: no frame boundary is closed, so a capture running across it keeps
   * nothing, and a section that has to sit through nine seconds of a cascade
   * launching costs a replay nothing. Use it for the wait; use {@link advance}
   * for the part a check is about.
   */
  skip(duration: number, hz?: number): Promise<void>;
  /** {@link skip} until `predicate` holds, sampling every `pollSeconds`. */
  skipUntil(
    predicate: (snapshot: CascadeSnapshot) => boolean,
    options?: SkipOptions,
  ): Promise<SkipResult>;
  /**
   * Hand the game back to its own frame loop for `ms` of real time, then take it
   * back.
   *
   * No review item names this. It is here because `setAutoStep(true)` is
   * otherwise unobservable — the flag is the loop's rather than the game's, and
   * `snapshot()` deliberately reports no field for it — so this is the only way
   * to confirm that the half of the clock operation a build starts up in still
   * works. `harness.test.ts` uses it; a validator should not need to.
   */
  runFor(ms: number): Promise<void>;

  /**
   * Press a key, run the one frame that delivers it, and release it.
   *
   * Cascade fixes exactly one key binding, `OVERLAY_KEY` (`Backquote`), which
   * `toggleOverlay` uses. The frame between the down and the up is what makes
   * this a press a build can actually see: an engineless build wrote its own
   * keyboard layer, and the two conformant ways to read a press — latching the
   * edge in the event handler, or comparing held state at the top of each
   * frame — agree only if the key is genuinely held while a frame runs.
   */
  tap(code: string): Promise<void>;

  /** Run exactly one frame and hand back every operation its render issued. */
  frameCalls(): Promise<DrawCall[]>;
  /** Reflect the surface without invoking it: `typeof` for each name, and the version. */
  probe(
    names: readonly string[],
  ): Promise<{ version: unknown; ops: Record<string, string> }>;

  /** How the stage is mapped onto this harness's canvas. */
  viewport(): Viewport;
  /** Where a logical point lands in the canvas's backing store. */
  device(x: number, y: number): { x: number; y: number };
  /** Where a logical point lands in CSS pixels, for a real mouse. */
  css(x: number, y: number): { x: number; y: number };
  /** The device pixel under a logical point, as `[r, g, b, a]`. */
  pixel(x: number, y: number): Promise<[number, number, number, number]>;
  /** Many logical points at once, in one crossing into the page. */
  pixels(
    points: readonly { x: number; y: number }[],
  ): Promise<[number, number, number, number][]>;
  /** A pixel addressed in the canvas's own backing store, past the fit. */
  devicePixel(x: number, y: number): Promise<[number, number, number, number]>;
  /** The canvas's backing store size, as the build sized it. */
  surface(): Promise<{ width: number; height: number; dpr: number }>;

  /** Give the build a real, browser-trusted gesture, so its audio can open. */
  armAudio(): Promise<void>;
  /** How many sounds the build has emitted since the page loaded, in total. */
  sounds(): Promise<number>;

  /** Release anything held, and let the page go. */
  dispose(): Promise<void>;
}
/* ---- The page ------------------------------------------------------------- */

/** The init scripts injected before any of the build's own script runs. */
const INIT_SCRIPTS = ["recorder-init.js", "audio-init.js"] as const;

/** This module's directory: the validator project's root. */
const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * How many of the PAGE'S OWN rendered frames the surface is waited for before the
 * build is called non-conformant.
 *
 * `specs/instrumentation.md` requires the surface "as soon as the game has
 * initialized", and the honest reading of that deadline is counted in the frames
 * the page renders, not in seconds of this machine's time. Cascade seeds no art
 * and declares no assets, so a conformant build installs its surface while its own
 * module evaluates — before `page.goto(waitUntil: "load")` has even returned — and
 * is found on the first poll. The grace below is for a build that finishes
 * initializing asynchronously, and three hundred frames is five seconds of one
 * that renders at an ordinary rate.
 *
 * WHY NOT A NUMBER OF SECONDS, WHICH IS WHAT THIS USED TO BE. A wall-clock
 * deadline here does not measure the build at all. Playwright polls this
 * predicate once per animation frame, so on a host with nothing left to give,
 * BOTH the build's script and the poll that looks for its surface are starved
 * together — and a ten-second ceiling then reported "this build installs no debug
 * surface" against a build whose surface was there all along, losing every point
 * in the checklist to how busy the machine was. Counted in frames, the deadline
 * stretches with the host exactly as the build does: a page given a tenth of a
 * core takes a tenth of the frames per second and gets the same three hundred
 * frames to install its surface in.
 */
const SURFACE_GRACE_FRAMES = 300;

/**
 * The wall-clock ceiling on any one crossing into the page.
 *
 * NOT A DEADLINE ANY READING RESTS ON. A ceiling exists because a page that has
 * wedged must cost a check this much and no more; it is drawn where no loaded
 * host reaches it, so that what ends a wait is the thing being waited for. Two
 * minutes: the navigation this harness makes is a static bundle off a local
 * server, and the surface wait under it reaches its {@link SURFACE_GRACE_FRAMES}
 * long inside two minutes however loaded the host is.
 *
 * WHAT IT REPLACES. Playwright's own default is thirty seconds on every crossing
 * — a navigation, a key press, a click, a `waitForFunction` — and thirty seconds
 * is generous on an idle host and crossed by a page load on one running many
 * times its own number of cores. What a crossed deadline costs is not a point but
 * a check: the harness throws inside `beforeEach`, and the verdict that reaches
 * the reviewer names nothing the build did.
 */
const PAGE_CEILING_MS = 120_000;

/**
 * What a frame-counted wait is waiting for: the two things a page installs that a
 * harness cannot begin without.
 *
 * `"surface"` is the build's own `window.__cascade`. `"recorder"` is the injected
 * recorder having a 2D context to record, which a build is free to ask for on the
 * frame it first draws rather than while it initializes.
 */
type PageArrival = "surface" | "recorder";

/**
 * Wait, in frames of the page's own rendering, for something a page installs.
 *
 * Playwright polls a `waitForFunction` predicate once per animation frame, so the
 * predicate counts its own polls and answers in the PAGE'S frames rather than in
 * the HOST'S seconds — which is the whole point (see
 * {@link SURFACE_GRACE_FRAMES}). It resolves `true` on the frame the thing is
 * first there, and `false` once {@link SURFACE_GRACE_FRAMES} frames have gone by
 * without it — or if the page renders nothing at all for
 * {@link PAGE_CEILING_MS}, which is the one case no frame count can end.
 *
 * The count is kept on the page under a key of the arrival's own name, so the two
 * waits a harness makes do not share a deadline.
 */
async function waitInPageFrames(
  page: Page,
  arrival: PageArrival,
  handleName: string,
): Promise<boolean> {
  try {
    const found = await page.waitForFunction(
      ([kind, handle, grace]) => {
        const scope = window as unknown as Record<string, unknown>;
        const there =
          kind === "surface"
            ? typeof scope[handle] === "object" && scope[handle] !== null
            : (
                scope.__cascadeRec as { ready(): boolean } | undefined
              )?.ready() === true;
        if (there) return "there";
        const key = `__cascadeWaited_${kind}`;
        const seen = ((scope[key] as number | undefined) ?? 0) + 1;
        scope[key] = seen;
        // Neither `null` nor `false` ends a `waitForFunction`, so a frame that
        // has not answered yet returns one of them and the poll comes round
        // again on the next frame; only the two strings end the wait.
        return seen >= grace ? "never" : null;
      },
      [arrival, handleName, SURFACE_GRACE_FRAMES] as const,
      { timeout: PAGE_CEILING_MS },
    );
    return (await found.jsonValue()) === "there";
  } catch {
    return false;
  }
}

/**
 * The most frames one crossing carries a per-frame series back for.
 *
 * A series is a snapshot per frame, and a Cascade snapshot is a few hundred
 * bytes, so a thousand frames is well under a megabyte — small enough that the
 * crossing costs no more than an empty one and large enough that the sweeps this
 * project runs are one or two crossings rather than thousands. It bounds the
 * payload of a single crossing and nothing else: a longer run is simply several
 * crossings, and the frames it drives are identical either way.
 */
const SERIES_CHUNK_FRAMES = 1_000;

/**
 * The key a non-finite number is carried across in.
 *
 * A series crosses back as ONE JSON string rather than as an array of objects,
 * because Playwright's own value protocol walks every property of everything it
 * returns and that walk costs tens of milliseconds per snapshot — a cost of the
 * transport, paid per frame read, that has nothing to do with the build. A string
 * crosses as a single value and is parsed here.
 *
 * The one thing plain JSON would lose is a number that is not finite, and a
 * validator must not lose it: `NaN` in a flyer's velocity is a build's defect and
 * has to reach the check that grades it rather than arriving as `null`. So a
 * non-finite number is written as `{ "__cascadeNumber": "NaN" }` on the way out
 * and read back as the number it names, which leaves every reading identical to
 * the one Playwright's protocol would have delivered.
 */
const NON_FINITE_KEY = "__cascadeNumber";

/** Read a crossing back, restoring the numbers plain JSON cannot carry. */
function parseCrossing<T>(text: string): T {
  return JSON.parse(text, (_key, value: unknown) => {
    if (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      Object.keys(value).length === 1 &&
      NON_FINITE_KEY in value
    ) {
      return Number((value as Record<string, string>)[NON_FINITE_KEY]);
    }
    return value;
  }) as T;
}

let browserPromise: Promise<Browser> | null = null;

async function sharedBrowser(): Promise<Browser> {
  browserPromise ??= connectChromium(inject("cascadeBrowserWs"));
  return browserPromise;
}

/**
 * One browser context per WINDOW SHAPE, shared by every harness of that shape in
 * this file, and one PAGE per harness inside it.
 *
 * The split is what the init scripts force and what correctness wants. The
 * recorder and the audio probe are installed on the CONTEXT, so every page it
 * opens is instrumented before a line of the build's script runs, and a context
 * is also where the viewport and the device pixel ratio are fixed — which is the
 * one thing `table/stage-fit` varies. Everything else about a harness is the
 * page: a fresh one opens on a build that has just started, with nothing held, no
 * audio context opened, and the mute preference back off, which is a stronger
 * guarantee than any reset the surface offers, since `reset()` deliberately
 * leaves muting alone.
 *
 * A page per harness rather than a page reused between them, because a check may
 * legitimately hold two harnesses at once — `instrumentation/advances-in-frames`
 * runs the same second under two frame divisions, and
 * `instrumentation/deterministic-cascade` replays one seed twice — and a harness
 * whose page had been taken over by a later one would read someone else's game
 * while looking exactly like it worked.
 */
const contexts = new Map<string, BrowserContext>();

/** Every page this worker opened, so none is left behind in the shared browser. */
const openPages = new Set<Page>();

function shapeKey(cssWidth: number, cssHeight: number, dpr: number): string {
  return `${cssWidth}x${cssHeight}@${dpr}`;
}

/** The context for a window of this shape, opened and instrumented on demand. */
async function contextFor(
  cssWidth: number,
  cssHeight: number,
  dpr: number,
): Promise<BrowserContext> {
  const key = shapeKey(cssWidth, cssHeight, dpr);
  const existing = contexts.get(key);
  if (existing !== undefined) return existing;

  const browser = await sharedBrowser();
  const context = await browser.newContext({
    viewport: { width: cssWidth, height: cssHeight },
    deviceScaleFactor: dpr,
  });
  for (const name of INIT_SCRIPTS) {
    await context.addInitScript(readFileSync(join(PROJECT_ROOT, name), "utf8"));
  }
  contexts.set(key, context);
  return context;
}

/**
 * Shut everything this worker opened.
 *
 * Registered from `setup.ts` as an `afterAll`, so a suite file never has to think
 * about it and a worker cannot leave a page behind in the shared browser.
 */
export async function closeWorkerBrowser(): Promise<void> {
  for (const page of openPages) await page.close().catch(() => undefined);
  openPages.clear();
  for (const context of contexts.values()) {
    await context.close().catch(() => undefined);
  }
  contexts.clear();
  const browser = browserPromise;
  browserPromise = null;
  if (browser !== null) await (await browser).close().catch(() => undefined);
}

/* ---- The surface a build never installed ---------------------------------- */

/**
 * A stand-in for a surface that is missing or incomplete: every operation on it
 * fails the check that reached for it, with the fault named.
 *
 * A proxy rather than a hand-written stub, so that an operation a build was
 * supposed to add but this file never listed still fails as the consequence of
 * the missing install rather than as an undefined that throws a `TypeError`
 * several frames later, in a place that names nothing.
 *
 * Keys that belong to the MACHINERY rather than to a check are answered with
 * `undefined` instead: awaiting a value probes `then`, and vitest's own error
 * formatting probes symbols and `constructor`. Failing those would replace the
 * verdict below with noise from the machinery that was trying to report it.
 */
function unexposedSurface(reason: string): CascadeDebugApi {
  return new Proxy({} as CascadeDebugApi, {
    get: (_target, property): unknown => {
      if (typeof property === "symbol") return undefined;
      if (property === "then" || property === "constructor") return undefined;
      return () => failSurface(reason);
    },
  });
}

/**
 * What `specs/instrumentation.md` requires of the surface: the `Expected:` line
 * of the failure a build with no usable surface lands on every check that
 * reaches for it, beside the {@link Harness.surfaceFault} that says what was
 * found.
 */
export const SURFACE_REQUIREMENT =
  `a usable debug and automation surface on window.${HANDLE} as soon as the ` +
  `game has initialized, carrying every operation specs/instrumentation.md ` +
  `requires`;

/**
 * Fail the running check on `fault`, the harness's account of what is wrong
 * with the build's surface, paired with what the specification requires.
 */
export function failSurface(fault: string): never {
  return fail(SURFACE_REQUIREMENT, fault);
}

/**
 * What is wrong with the surface this page installed, or `null` when nothing
 * is: the surface never appeared, or it appeared without an operation the
 * specification requires.
 */
async function readSurfaceFault(page: Page): Promise<string | null> {
  if (!(await waitInPageFrames(page, "surface", HANDLE))) {
    return `window.${HANDLE} was still absent ${SURFACE_GRACE_FRAMES} rendered frames after the page loaded`;
  }
  const missing = await page.evaluate(
    ([handle, ops]) => {
      const target = (
        window as unknown as Record<string, Record<string, unknown>>
      )[handle];
      return ops.filter((op) => typeof target[op] !== "function");
    },
    [HANDLE, [...REQUIRED_OPS]] as const,
  );
  if (missing.length > 0) {
    return `window.${HANDLE} is installed but carries no ${missing
      .map((op) => `${op}()`)
      .join(", ")}`;
  }
  return null;
}

/* ---- Building one --------------------------------------------------------- */

/**
 * Load the built site in a browser, take the game off the wall clock, and hand
 * back everything a check reads.
 *
 * The default shape is the stage's own size at one device pixel per CSS pixel,
 * so a logical coordinate and a canvas pixel are the same thing and no check but
 * `table/stage-fit` has to think about the fit at all.
 *
 * IT NEVER THROWS FOR A BUILD'S FAULT. A missing or incomplete surface comes
 * back as {@link Harness.surfaceFault} over a surface whose every operation
 * fails by assertion, so a suite that builds its harness in a `beforeEach` gets
 * its real verdict from the check rather than a hook failure that names nothing.
 */
export async function createHarness(
  options: HarnessOptions = {},
): Promise<Harness> {
  const cssWidth = options.cssWidth ?? STAGE_W;
  const cssHeight = options.cssHeight ?? STAGE_H;
  const dpr = options.dpr ?? 1;
  const clock = options.clock ?? new ConstantClock(TICK_MS);
  const context = await contextFor(cssWidth, cssHeight, dpr);
  const page = await context.newPage();
  openPages.add(page);
  // Off Playwright's own thirty seconds and onto this project's ceiling, for
  // every crossing the harness makes: the navigation below, a key press, a
  // click, a frame driven inside the page. See `PAGE_CEILING_MS`; the waits whose
  // deadline belongs in the page's own frames count those instead, and say so.
  page.setDefaultTimeout(PAGE_CEILING_MS);
  page.setDefaultNavigationTimeout(PAGE_CEILING_MS);

  // Whatever this page throws or logs as an error while THIS harness drives it.
  // The page belongs to one harness, so the log cannot pick up what some other
  // check provoked.
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => {
    pageErrors.push(String(error.message || error));
  });
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(message.text());
  });

  await page.goto(inject("cascadeUrl"), { waitUntil: "load" });

  const surfaceFault = await readSurfaceFault(page);
  const refuse = (): never => failSurface(surfaceFault ?? "");

  const call = async (operation: string, args: unknown[]): Promise<unknown> => {
    if (surfaceFault !== null) refuse();
    return page.evaluate(
      ([handle, name, rest]) =>
        (
          window as unknown as Record<
            string,
            Record<string, (...a: unknown[]) => unknown>
          >
        )[handle][name](...rest),
      [HANDLE, operation, args] as const,
    );
  };

  const debug =
    surfaceFault !== null
      ? unexposedSurface(surfaceFault)
      : (new Proxy({} as CascadeDebugApi, {
          get: (_target, property): unknown => {
            if (typeof property === "symbol") return undefined;
            if (property === "then" || property === "constructor")
              return undefined;
            const name = String(property);
            return (...args: unknown[]) => call(name, args);
          },
        }) as CascadeDebugApi);

  if (surfaceFault === null) {
    // Off the wall clock and back to the title before a check touches anything:
    // from here the game changes only when this harness says so. The reset is
    // skipped only for a check whose subject is the state the build initialized
    // with, which a reset would erase (`HarnessOptions.reset`).
    await call("setAutoStep", [false]);
    if (options.reset ?? true) await call("reset", []);
    // And a recorder over the surface before a check can arm one. A build is
    // free to ask for its 2D context on the frame it first draws rather than
    // while it initializes, so the surface can be installed and answering
    // before any context exists to record — and a `captureReplay` armed in that
    // window arms nothing and writes no evidence for a section that drew.
    await waitInPageFrames(page, "recorder", HANDLE);
  }

  const view = fitViewport(cssWidth, cssHeight, dpr);
  const cueSinks: TimedCue[][] = [];
  let frameCount = 0;
  let timeMs = 0;

  /**
   * Run `frames` frames and read what they left, in as few crossings as the
   * series asked for allows.
   *
   * Each frame is opened and closed around a single `advance(dt, 1)`, all inside
   * one synchronous evaluation, so nothing the page's own animation frame renders
   * can land inside a recorded frame — and so a frame the recorder keeps is
   * exactly one frame the game ran.
   *
   * `series` decides what comes back: `false` reads the state the LAST frame left
   * and `true` reads the state EVERY frame left, which is the reading a check
   * that has to catch the frame something happened on needs. The frames are the
   * same either way — the flag changes what crosses back, never what ran.
   *
   * WHY THE LOOP IS INSIDE THE PAGE AND NOT OUT HERE. A crossing costs a round
   * trip, and a round trip is a property of how busy the HOST is: tens of
   * milliseconds on an idle machine and hundreds on a loaded one. A sweep that
   * paid one per frame therefore took a length of time nothing about the build
   * decided, and the vitest allowance it ran against is wall clock — so the same
   * build passed on a quiet host and timed out on a busy one. Driving the frames
   * inside the page removes the host from the reading: the check still steps one
   * frame at a time and still reads every frame, and what it costs is now the
   * build's own work.
   */
  const runFrames = async (
    frames: number,
    series: boolean,
  ): Promise<CascadeSnapshot[]> => {
    if (surfaceFault !== null) refuse();
    const wanted = Math.max(0, Math.trunc(frames));
    const collected: CascadeSnapshot[] = [];
    let left = wanted;
    while (left > 0) {
      const step = series ? Math.min(left, SERIES_CHUNK_FRAMES) : left;
      const deltas: number[] = [];
      for (let i = 0; i < step; i += 1) deltas.push(clock.delta());
      const raw = await page.evaluate(
        ([handle, dts, all, nonFinite]) => {
          const api = (
            window as unknown as Record<
              string,
              Record<string, (...a: unknown[]) => unknown>
            >
          )[handle];
          const rec = (
            window as unknown as {
              __cascadeRec: Record<string, (...a: unknown[]) => unknown>;
            }
          ).__cascadeRec;
          const audio = (
            window as unknown as { __cascadeAudio: { started(): number } }
          ).__cascadeAudio;
          const sounds: number[] = [];
          const snapshots: unknown[] = [];
          for (const dt of dts) {
            const before = audio.started();
            rec.begin();
            api.advance(dt / 1000, 1);
            rec.end(dt);
            sounds.push(audio.started() - before);
            if (all) snapshots.push(api.snapshot());
          }
          if (!all) snapshots.push(api.snapshot());
          return JSON.stringify({ snapshots, sounds }, (_key, value: unknown) =>
            typeof value === "number" && !Number.isFinite(value)
              ? { [nonFinite]: String(value) }
              : value,
          );
        },
        [HANDLE, deltas, series, NON_FINITE_KEY] as const,
      );
      const result = parseCrossing<{
        snapshots: CascadeSnapshot[];
        sounds: number[];
      }>(raw);

      for (const [index, delta] of deltas.entries()) {
        frameCount += 1;
        timeMs += delta;
        for (let n = 0; n < result.sounds[index]; n += 1) {
          for (const sink of cueSinks)
            sink.push({ frame: frameCount, t: timeMs });
        }
      }
      if (series) collected.push(...result.snapshots);
      else {
        collected.length = 0;
        collected.push(result.snapshots[0]);
      }
      left -= step;
    }
    return collected;
  };

  /** Run `frames` frames and read the state the last of them left. */
  const drive = async (frames: number): Promise<CascadeSnapshot> => {
    const [last] = await runFrames(frames, false);
    return last ?? (await debug.snapshot());
  };

  /**
   * Run `duration` seconds of game time in `frames` frames, off camera.
   *
   * The same real update, and the same one crossing, but with no frame boundary
   * opened or closed: a capture running across a skip keeps nothing of it. Every
   * sound the skip produced is attributed to the frame it ended on, which is the
   * whole of what a skip can honestly say about when a sound happened.
   */
  const coast = async (
    duration: number,
    frames: number,
  ): Promise<CascadeSnapshot> => {
    if (surfaceFault !== null) refuse();
    const whole = Math.max(1, Math.round(frames));
    const result = (await page.evaluate(
      ([handle, sec, count]) => {
        const api = (
          window as unknown as Record<
            string,
            Record<string, (...a: unknown[]) => unknown>
          >
        )[handle];
        const audio = (
          window as unknown as { __cascadeAudio: { started(): number } }
        ).__cascadeAudio;
        const before = audio.started();
        api.advance(sec, count);
        return {
          snapshot: api.snapshot(),
          sounds: audio.started() - before,
        };
      },
      [HANDLE, duration, whole] as const,
    )) as { snapshot: CascadeSnapshot; sounds: number };

    frameCount += whole;
    timeMs += duration * 1000;
    for (let n = 0; n < result.sounds; n += 1) {
      for (const sink of cueSinks) sink.push({ frame: frameCount, t: timeMs });
    }
    return result.snapshot;
  };

  const readPixels = async (
    devicePoints: readonly { x: number; y: number }[],
  ): Promise<[number, number, number, number][]> =>
    page.evaluate(
      (points) => {
        const canvases = Array.from(document.querySelectorAll("canvas"));
        if (canvases.length === 0)
          throw new Error("cascade: the page has no <canvas>");
        let canvas = canvases[0];
        for (const other of canvases) {
          if (other.width * other.height > canvas.width * canvas.height)
            canvas = other;
        }
        const ctx = canvas.getContext("2d");
        if (ctx === null)
          throw new Error("cascade: the canvas has no 2D context");
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
          return [data[0], data[1], data[2], data[3]] as [
            number,
            number,
            number,
            number,
          ];
        });
      },
      devicePoints as { x: number; y: number }[],
    );

  const harness: Harness = {
    page,
    debug,
    surfaceFault,
    pageErrors,

    frame: () => frameCount,
    timeMs: () => timeMs,

    snapshot: () => debug.snapshot(),

    advance: async (frames) => {
      await drive(frames);
    },

    sample: (frames) => runFrames(frames, true),

    async pose(calls) {
      if (surfaceFault !== null) refuse();
      if (calls.length === 0) return [];
      const raw = await page.evaluate(
        ([handle, ops, nonFinite]) => {
          const api = (
            window as unknown as Record<
              string,
              Record<string, (...a: unknown[]) => unknown>
            >
          )[handle];
          const results = ops.map((call) => api[call.op](...call.args));
          return JSON.stringify(results, (_key, value: unknown) =>
            typeof value === "number" && !Number.isFinite(value)
              ? { [nonFinite]: String(value) }
              : value,
          );
        },
        [
          HANDLE,
          calls.map((call) => ({ op: call.op, args: [...call.args] })),
          NON_FINITE_KEY,
        ] as const,
      );
      return parseCrossing<unknown[]>(raw);
    },

    async until(predicate, untilOptions = {}) {
      const maxFrames = untilOptions.maxFrames ?? framesFor(5);
      const chunk = Math.max(1, untilOptions.chunk ?? 1);

      let snapshot = await this.snapshot();
      if (predicate(snapshot))
        return { hit: true, frames: 0, at: frameCount, snapshot };

      let frames = 0;
      while (frames < maxFrames) {
        const step = Math.min(chunk, maxFrames - frames);
        const opened = frameCount;
        const series = await runFrames(step, true);
        for (const [index, sampled] of series.entries()) {
          if (predicate(sampled)) {
            return {
              hit: true,
              frames: frames + index + 1,
              at: opened + index + 1,
              snapshot: sampled,
            };
          }
        }
        frames += step;
        snapshot = series[series.length - 1] ?? snapshot;
      }
      return { hit: false, frames, at: frameCount, snapshot };
    },

    async skip(duration, hz = TICK_HZ) {
      await coast(duration, Math.ceil(duration * hz));
    },

    async skipUntil(predicate, skipOptions = {}) {
      const maxSeconds = skipOptions.maxSeconds ?? 60;
      const pollSeconds = Math.max(1e-3, skipOptions.pollSeconds ?? 0.5);
      const hz = skipOptions.hz ?? TICK_HZ;

      let snapshot = await this.snapshot();
      if (predicate(snapshot)) return { hit: true, elapsed: 0, snapshot };

      let elapsed = 0;
      while (elapsed < maxSeconds) {
        const step = Math.min(pollSeconds, maxSeconds - elapsed);
        snapshot = await coast(step, Math.ceil(step * hz));
        elapsed += step;
        if (predicate(snapshot)) return { hit: true, elapsed, snapshot };
      }
      return { hit: false, elapsed, snapshot };
    },

    async runFor(ms) {
      if (surfaceFault !== null) refuse();
      // The one thing here that depends on real elapsed time, so the one thing a
      // browser's own idea of which page matters can distort. The launch already
      // turns the throttling off; bringing the page forward as well means this
      // does not rest on a flag alone.
      await page.bringToFront().catch(() => undefined);
      await page.evaluate(
        ([handle]) => {
          (
            window as unknown as { __cascadeRec: { setMode(m: string): void } }
          ).__cascadeRec.setMode("raf");
          (
            window as unknown as Record<
              string,
              { setAutoStep(on: boolean): void }
            >
          )[handle].setAutoStep(true);
        },
        [HANDLE] as const,
      );
      await page.waitForTimeout(ms);
      await page.evaluate(
        ([handle]) => {
          (
            window as unknown as Record<
              string,
              { setAutoStep(on: boolean): void }
            >
          )[handle].setAutoStep(false);
          (
            window as unknown as { __cascadeRec: { setMode(m: string): void } }
          ).__cascadeRec.setMode("manual");
        },
        [HANDLE] as const,
      );
    },

    async tap(code) {
      await page.keyboard.down(code);
      await drive(1);
      await page.keyboard.up(code);
    },

    async frameCalls() {
      await drive(1);
      const ops = (await page.evaluate(() =>
        (
          window as unknown as { __cascadeRec: { last(): unknown[] } }
        ).__cascadeRec.last(),
      )) as RecordedOp[];
      return ops.map(toDrawCall);
    },

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
        [HANDLE, [...names]] as const,
      ),

    viewport: () => ({ ...view }),
    device: (x, y) => toDevice(view, x, y),
    css: (x, y) => {
      const at = toDevice(view, x, y);
      return { x: at.x / dpr, y: at.y / dpr };
    },
    pixel: async (x, y) => (await readPixels([toDevice(view, x, y)]))[0],
    pixels: (points) => readPixels(points.map((p) => toDevice(view, p.x, p.y))),
    devicePixel: async (x, y) => (await readPixels([{ x, y }]))[0],

    surface: () =>
      page.evaluate(() => {
        const canvases = Array.from(document.querySelectorAll("canvas"));
        if (canvases.length === 0) {
          throw new Error(
            "cascade: the page has no <canvas>, so the build drew nowhere — " +
              "index.html supplies one and the build is asked not to edit it " +
              "(specs/overview.md)",
          );
        }
        let canvas = canvases[0];
        for (const other of canvases) {
          if (other.width * other.height > canvas.width * canvas.height)
            canvas = other;
        }
        return {
          width: canvas.width,
          height: canvas.height,
          dpr: window.devicePixelRatio,
        };
      }),

    async armAudio() {
      // A GENUINE browser gesture, not a posed one: a build is free to open its
      // audio context from a real DOM event alone (both are conformant), so a
      // gesture delivered any other way would leave a perfectly good build
      // silent. `specs/controls.md` binds exactly one key, the overlay's
      // Backquote, so a press of UNBOUND_KEY is inert — it changes no game
      // state, opens no panel, and records no press for the double-click rule,
      // which a real pointer press would.
      await page.keyboard.press(UNBOUND_KEY);
    },

    sounds: () =>
      page.evaluate(() =>
        (
          window as unknown as { __cascadeAudio: { started(): number } }
        ).__cascadeAudio.started(),
      ),

    async dispose() {
      // The context stays: it holds the init scripts and the window shape, and the
      // next harness of this shape wants both. The page goes, so nothing this
      // check pressed, dealt or muted can reach the next one.
      openPages.delete(page);
      await page.close().catch(() => undefined);
    },
  };

  harnessCues.set(harness, cueSinks);
  return harness;
}

/** Where {@link watchCues} attaches, per harness. */
const harnessCues = new WeakMap<Harness, TimedCue[][]>();
/* ---- The fit -------------------------------------------------------------- */

/**
 * How the stage maps onto a surface of this shape, as `specs/overview.md` fixes
 * it: one uniform scale, the whole stage inside, centred, with the leftover
 * split evenly into two letterbox bars.
 *
 * Computed rather than read from the build, deliberately. Under an engine the
 * fit is the engine's and a check can ask it what it derived; here the fit is
 * the build's own work, so asking it would be asking a build to grade itself.
 * Every check but `table/stage-fit` runs at the stage's own size, where this is
 * the identity and the question does not arise; that one check runs at other
 * shapes and reads the pixels against what the specification says should be
 * there.
 */
export function fitViewport(
  cssWidth: number,
  cssHeight: number,
  dpr: number,
): Viewport {
  const deviceWidth = Math.round(cssWidth * dpr);
  const deviceHeight = Math.round(cssHeight * dpr);
  const scale = Math.min(cssWidth / STAGE_W, cssHeight / STAGE_H) * dpr;
  return {
    width: STAGE_W,
    height: STAGE_H,
    scale,
    offsetX: (deviceWidth - STAGE_W * scale) / 2,
    offsetY: (deviceHeight - STAGE_H * scale) / 2,
  };
}

function toDevice(
  view: Viewport,
  x: number,
  y: number,
): { x: number; y: number } {
  return {
    x: Math.round(view.offsetX + x * view.scale),
    y: Math.round(view.offsetY + y * view.scale),
  };
}
/* ---- Draw calls ----------------------------------------------------------- */

/** One operation as the injected recorder writes it. */
export type RecordedOp =
  | {
      op: "call";
      method: string;
      args: unknown[];
      width?: number;
      textAlign?: string;
    }
  | { op: "set"; property: string; value: unknown };

function toDrawCall(op: RecordedOp): DrawCall {
  return op.op === "call"
    ? {
        kind: "call",
        method: op.method,
        args: op.args,
        width: op.width,
        textAlign: op.textAlign,
      }
    : { kind: "set", property: op.property, value: op.value };
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

/* -------------------------------------------------------------------------- */
/* Evidence capture                                                           */
/* -------------------------------------------------------------------------- */
//
// A review item may declare a `replay` OUTPUT beside its verdict: the frames the
// build itself drew while a check drove it, kept as evidence a reviewer can
// scrub and compare against the reference implementation's. `captureReplay` is
// how a check produces one.
//
// Four properties are what make it usable, and each is deliberate:
//
// 1. IT RECORDS THE SECTION, NOT THE RUN. The recorder is armed around the
//    caller's scenario and disarmed the moment that scenario returns, so what is
//    kept is the part the check is ABOUT and never the setup that got there.
//    Cascade gives that its sharpest form, and it is the reason ARMING NARROWLY
//    IS A RULE HERE RATHER THAN AN ECONOMY. The victory cascade blits a
//    full-screen painted layer once per frame, the recorder captures a source
//    whose content can change at every use, and capture stops once a recording
//    holds 16 MB of image bytes — after which a further new capture records an
//    opaque marker instead of the picture. A cascade replay recorded with the
//    trail painting on therefore degrades within a handful of frames. So arm
//    around the section the point is about —
//    `captureReplay(h, "id", () => h.advance(framesFor(1)))` — put the setup
//    outside it, or off camera entirely with {@link Harness.skip}, which closes
//    no frame at all, and TURN THE PAINTING OFF for every replay in the
//    `cascade` group: `setTrailPainting(false)` leaves the flyers in the frames
//    and takes the blit out of them. The three items whose requirement IS the
//    trail declare `image` outputs and read the canvas pixels instead, and the
//    three cascade replays in the `winning` group record with painting left on,
//    because each covers only the win and the cascade's first frames.
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

/** The environment variable the runner names the media directory in. */
const MEDIA_DIR_ENV = "TCAB_VALIDATION_MEDIA_DIR";

/**
 * The directory the runner stages this project to inside the build's tree.
 *
 * A recording is addressed by the STAGED path of the suite that produced it —
 * `validation/deal/full-deck.test.ts` — because that is the path the
 * review item's declared script resolves to, and so the only name the case's
 * manifest and the runner both already agree on. Stating the prefix here is what
 * keeps that address the same when this suite is run in place against a
 * reference implementation, where the project root is `validation/none/` instead.
 */
const STAGED_PROJECT_DIR = "validation";

/**
 * The most frames a written recording holds.
 *
 * The injected recorder already holds the page's side to twice this, decimating
 * as it fills, so what arrives here is at most a few hundred frames however long
 * the section ran. This is the same cap the engine-backed harnesses write under,
 * so a replay recorded under any of the three engines is the same size of thing.
 */
const MAX_REPLAY_FRAMES = 300;

/**
 * The ground the console's player paints behind a recorded frame.
 *
 * The specification fixes no board colour: the build paints its own background
 * each frame, and the recorded frames carry that paint. What the player needs is
 * a colour for the canvas under them, and the page the build is served on is
 * painted `#000` by the case's own `index.html`, so that is what a replay says.
 */
export const REPLAY_BACKGROUND = "#000";

/** One frame of a recording, as the console's player reads it. */
export interface RecordedFrame {
  count: number;
  timeMs: number;
  deltaMs: number;
  surface: { width: number; height: number };
  /** Index into the recording's `states` of the state this frame inherited. */
  state: number;
  /**
   * Indices into the recording's `states` of the states saved under this frame,
   * outermost first.
   */
  stack: number[];
  /** Indices into the recording's `ops`, in the order the frame issued them. */
  ops: number[];
  /**
   * Whether part of what this frame inherited was too large for the format to
   * carry, and was cut down to the bound. Present only on a frame that was.
   */
  truncated?: boolean;
}

/** The context state a frame is drawn from, before its own operations. */
export interface RecordedState {
  properties: Record<string, unknown>;
  /** The transform in force, as the canvas's `[a, b, c, d, e, f]`. */
  transform: number[] | null;
  lineDash: number[] | null;
  /** The clip region in force, as the segments that built it, in order. */
  clip: RecordedPathSegment[];
  /** The current path, as the operations issued since the last `beginPath`. */
  path: RecordedPathSegment[];
}

/**
 * One run of path operations, and the transform they were issued under.
 *
 * A path is given in user space, so both the clip and the current path are split
 * into one segment per transform and a player replays each under its own.
 */
export interface RecordedPathSegment {
  transform: number[] | null;
  ops: RecordedOp[];
}

/** A value the context produced, as the recipe that rebuilds it. */
export interface RecordedResource {
  make: { method: string; args: unknown[] };
  then: RecordedOp[];
}

/** One bitmap the recording captured, as the player reads it. */
export interface RecordedImage {
  width: number;
  height: number;
  /** A data URL of the bitmap's pixels, absent when the budget degraded it. */
  src?: string;
}

/**
 * A recording, as the console's player reads it.
 *
 * A frame names its state and its operations by index, and the values those
 * operations draw with — the gradients, the captured images — live in tables the
 * whole recording shares. So every reference a frame makes resolves at whichever
 * frame a reviewer lands on, and each distinct thing is written once.
 */
export interface Recording {
  format: number;
  width: number;
  height: number;
  background: string | null;
  images: RecordedImage[];
  resources: RecordedResource[];
  ops: RecordedOp[];
  states: RecordedState[];
  frames: RecordedFrame[];
}

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
 * DROPPING A FRAME DROPS THE LAST REFERENCE TO WHATEVER ONLY THAT FRAME DREW
 * WITH. Tables carried over whole would put operations, gradients and images in
 * the file that no frame asks for — dead weight in a document whose whole point
 * is to say each thing once, and the bulk of it in a game that draws
 * procedurally and so repeats almost nothing between frames.
 *
 * Every entry here is reached from a kept frame, and every reference inside one
 * is rewritten as it is reached, transitively. What is deduplicated is the
 * rewritten entry, so an operation two hundred frames issue identically is
 * written once and named two hundred times.
 *
 * Exported for the suite beside this file, which drives it over a recording a
 * browser cannot deliver: Playwright's serializer drops an own field named
 * `__proto__` on the way out of the page, so handing one to this directly is the
 * only way to check that the rewrite carries it.
 */
export function retable(
  recording: Recording,
  frames: RecordedFrame[],
): Recording {
  const images: RecordedImage[] = [];
  const imageAt = new Map<number, number>();
  const resources: RecordedResource[] = [];
  const resourceAt = new Map<number, number>();
  const ops: RecordedOp[] = [];
  const opAt = new Map<string, number>();
  const states: RecordedState[] = [];
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
    // A recipe's own arguments can only name values made before it, so rewriting
    // it terminates and cannot re-enter this resource.
    const rebuilt: RecordedResource = {
      make: { method: recipe.make.method, args: recipe.make.args.map(value) },
      then: recipe.then.map(operation),
    };
    const index = resources.length;
    resources.push(rebuilt);
    resourceAt.set(source, index);
    return index;
  };

  const value = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(value);
    if (entry === null || typeof entry !== "object") return entry;
    const record = entry as Record<string, unknown>;
    if (typeof record.$img === "number")
      return { $img: takeImage(record.$img) };
    if (typeof record.$res === "number")
      return { $res: takeResource(record.$res) };
    const rewritten: Record<string, unknown> = {};
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

  const operation = (op: RecordedOp): RecordedOp =>
    op.op === "call"
      ? { op: "call", method: op.method, args: op.args.map(value) }
      : { op: "set", property: op.property, value: value(op.value) };

  const segments = (list: RecordedPathSegment[]): RecordedPathSegment[] =>
    list.map((segment) => ({
      transform: segment.transform,
      ops: segment.ops.map(operation),
    }));

  const stateOf = (state: RecordedState): RecordedState => {
    const properties: Record<string, unknown> = {};
    for (const [name, held] of Object.entries(state.properties)) {
      Object.defineProperty(properties, name, {
        value: value(held),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return {
      properties,
      transform: state.transform,
      lineDash: state.lineDash,
      clip: segments(state.clip),
      path: segments(state.path),
    };
  };

  const takeState = (source: number): number =>
    intern(states, stateAt, stateOf(recording.states[source]));

  return {
    ...recording,
    images,
    resources,
    ops,
    states,
    frames: frames.map((frame) => ({
      ...frame,
      state: takeState(frame.state),
      stack: frame.stack.map(takeState),
      ops: frame.ops.map((op) =>
        intern(ops, opAt, operation(recording.ops[op])),
      ),
    })),
  };
}

/**
 * A recording of at most {@link MAX_REPLAY_FRAMES} frames, covering the whole of
 * what was captured, with each kept frame's `deltaMs` restated as the time since
 * the frame kept before it.
 *
 * The restatement is what makes a decimated recording play at the speed the game
 * really ran at: the deltas still sum to the section's elapsed time. The frame
 * `count` is left as it was recorded, so a reader can see that frames were
 * skipped rather than being told a smooth lie. The last frame is always kept
 * whatever the stride lands on — it is the frame the check's sweep stopped at,
 * and the one a reviewer looks at first.
 *
 * Keeping it costs a frame rather than the cap. The stride rounds up, so a
 * section whose length is an exact multiple of the cap strides over exactly that
 * many frames and stops one stride short of the end: the last frame still has to
 * come in, and the cap is a ceiling rather than a target. It takes the place of
 * the final strided frame — the frame nearest it, so the swap opens the smallest
 * gap available anywhere in the section — and is measured from where that frame
 * was measured from, which is what keeps the kept deltas summing to the elapsed
 * time.
 *
 * Exported for the suite beside this file, which reaches it over frame counts a
 * driven section cannot hand it.
 */
export function thinReplay(recording: Recording): Recording {
  const { frames } = recording;
  if (frames.length === 0) return recording;

  const stride = Math.max(1, Math.ceil(frames.length / MAX_REPLAY_FRAMES));
  const kept: RecordedFrame[] = [];
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
 * A capture that closed no frames writes nothing: a file holding an empty frame
 * list would be collected as an output that turned up, and the run would tell the
 * reviewer there is a replay to watch and then open the player on nothing.
 *
 * What lands on disk is gzip rather than raw JSON. A recording is text made
 * almost entirely of numbers and repeated field names, which gzip takes down to a
 * fraction of its size, and every host that serves one declares the encoding so
 * the browser inflates it before the player sees it.
 *
 * Never throws. A file that cannot be written says something about the machine
 * the validators ran on, and failing the point over it would blame the build for
 * the host's problem.
 */
function writeReplay(destination: string, recording: Recording | null): void {
  if (recording === null || recording.frames.length === 0) return;
  try {
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, gzipSync(JSON.stringify(thinReplay(recording))));
  } catch (error) {
    console.warn(`cascade: could not write ${destination}: ${String(error)}`);
  }
}

/**
 * Record the frames `scenario` drives and keep them as the review item's
 * `outputId` output, handing back whatever the scenario returned.
 *
 * Wrap the drive, not the arrangement:
 *
 * ```ts
 * await h.debug.setTrailPainting(false);
 * await captureReplay(h, "bounce", () => h.advance(framesFor(1)));
 * ```
 *
 * The assertions stay exactly where they were and read exactly what they did.
 */
export async function captureReplay<T>(
  h: Harness,
  outputId: string,
  scenario: () => T | Promise<T>,
): Promise<T> {
  const destination = mediaDestination(outputId, "json.gz");
  if (destination === null) return scenario();

  await h.page.evaluate(
    (design) =>
      (
        window as unknown as { __cascadeRec: { arm(d: unknown): boolean } }
      ).__cascadeRec.arm(design),
    { width: STAGE_W, height: STAGE_H, background: REPLAY_BACKGROUND },
  );
  try {
    return await scenario();
  } finally {
    // In a `finally`, so a scenario that failed still leaves its evidence behind.
    const recording = (await h.page.evaluate(() =>
      (
        window as unknown as { __cascadeRec: { disarm(): unknown } }
      ).__cascadeRec.disarm(),
    )) as Recording | null;
    writeReplay(destination, recording);
  }
}

/**
 * Keep the picture currently on the canvas as the review item's `outputId`
 * output.
 *
 * The companion to {@link captureReplay}, for a point whose evidence is one
 * PICTURE rather than a stretch of motion: which screen the game opened on, how
 * a build drew a red suit against a black one, where the letterbox bars fell.
 *
 * What is written is whatever the last frame that RAN left behind, so call it
 * after the frame that poses the thing under test and before the assertions, so
 * a check that fails still leaves the picture that shows why. Nothing here can
 * change a verdict: outside a run this is a no-op, and a still that cannot be
 * written is reported as an output that never turned up.
 */
export async function captureStill(
  h: Harness,
  outputId: string,
): Promise<void> {
  const destination = mediaDestination(outputId, "png");
  if (destination === null) return;
  try {
    mkdirSync(dirname(destination), { recursive: true });
    await h.page.screenshot({ path: destination, type: "png" });
  } catch (error) {
    console.warn(`cascade: could not write ${destination}: ${String(error)}`);
  }
}

/* -------------------------------------------------------------------------- */
/* Cues                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Record every sound the build emits from now on, stamped with the frame of the
 * drive it sounded on.
 *
 * WHAT IS OBSERVED, AND WHY IT IS THE FAIR READING. `specs/audio.md` requires
 * one cue per event, played on the frame its event happens, and says nothing at
 * all about how a build makes a sound — under this engine the whole audio layer is
 * the build's. So `audio-init.js` watches the two doors a browser can emit sound
 * through (a Web Audio source being `start()`ed, whatever kind it is, and an
 * `<audio>` element being played) and counts what goes through them; the harness
 * brackets each driven frame around that count, so a sound is attributed to the
 * frame that produced it. A blip made of two oscillators counts as two, which is
 * why a check asserts that a frame sounded rather than how many times: the number
 * of sources is the build's business and the specification never fixed it.
 *
 * WHAT IS LOST HERE THAT AN ENGINE GIVES. The cue's NAME. Under an engine the
 * game asks the bus for `CUES.home` by name and the bus announces it, so a build
 * that plays its reject blip on every card sent home is caught. There is no bus here to ask,
 * so these checks confirm that a sound was emitted and on which frame, and a
 * reviewer decides by ear whether the ten are told apart. That is a real
 * reduction, and the alternative — inferring the cue from the waveform the
 * reference happens to use — would grade builds against an implementation rather
 * than against the specification. NO CHECK IN THIS PROJECT MAY ASSERT A CUE NAME.
 *
 * A sound emitted inside {@link Harness.skip} is attributed to the frame the skip
 * ended on, since a skip closes no frames of its own: run the frames a cue check
 * reads with {@link Harness.advance}.
 */
export function watchCues(h: Harness): TimedCue[] {
  const played: TimedCue[] = [];
  harnessCues.get(h)?.push(played);
  return played;
}

/* -------------------------------------------------------------------------- */
/* Reading one frame's render                                                 */
/* -------------------------------------------------------------------------- */

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
 * case's own, but how a build presents it is the build's, and a menu entry is
 * commonly drawn with a selection marker or padding around it. Requiring the
 * exact run would fail a screen that shows precisely the right words.
 */
export function drewText(calls: readonly DrawCall[], text: string): boolean {
  const wanted = text.trim().toLowerCase();
  return drawnText(calls).some((drawn) => drawn.toLowerCase().includes(wanted));
}

/**
 * Whether the frame drew `word` as a STANDALONE token, ignoring case.
 *
 * The stricter sibling of {@link drewText}, for the copy `specs/screens.md`
 * requires as a word rather than as a substring — the how-to screen's `ACE`,
 * `KING`, `STOCK` and `DOUBLE-CLICK`, which `HOWTO_TOKENS` holds. A screen
 * reading "restocking" contains `stock` and does not name the pile the
 * specification named.
 */
export function drewWord(calls: readonly DrawCall[], word: string): boolean {
  const pattern = new RegExp(
    `(^|[^A-Za-z0-9])${word.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z0-9]|$)`,
    "i",
  );
  return drawnText(calls).some((drawn) => pattern.test(drawn));
}

/** One run of text a frame drew, and where it drew it in logical stage units. */
export interface TextDraw {
  text: string;
  /** The anchor the run was drawn at, mapped through the transform in force. */
  x: number;
  y: number;
  /**
   * The horizontal extent of the run's glyphs, in logical stage units.
   *
   * The width the context measured at the call, scaled by the transform in force
   * and laid out about the anchor as the alignment then in force places it. A
   * run whose width the recorder could not read spans its anchor alone, so
   * `left` and `right` are both `x`.
   */
  left: number;
  right: number;
}

/** A 2D affine transform, in the canvas's `[a, b, c, d, e, f]` order. */
export type Matrix = [number, number, number, number, number, number];

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

function numbers(args: unknown[], count: number): number[] | null {
  const taken = args.slice(0, count);
  return taken.length === count && taken.every((v) => typeof v === "number")
    ? (taken as number[])
    : null;
}

/** Where a user-space point lands once `m` is applied. */
export function applyMatrix(
  m: Matrix,
  x: number,
  y: number,
): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

/**
 * Walk a frame's operations, handing `visit` each one with the transform in
 * force at it.
 *
 * A build is free to draw under a transform — to translate to a tile and draw at
 * the origin, or to flip a leftward worm with a negative x scale — so the
 * position and the orientation a call names are only what they mean once the
 * transform at that call is applied. This carries `save`/`restore`, `translate`,
 * `scale`, `rotate`, `transform`, `setTransform` and `resetTransform`, starting
 * from `start` (the state the frame inherited) over `stack` (the states saved
 * under it, outermost first).
 */
export function walkTransforms(
  calls: readonly DrawCall[],
  visit: (call: DrawCall, m: Matrix) => void,
  start: Matrix = IDENTITY,
  stack: readonly Matrix[] = [],
): void {
  const saved: Matrix[] = [...stack];
  let current: Matrix = start;
  for (const call of calls) {
    if (call.kind !== "call") {
      visit(call, current);
      continue;
    }
    const { method, args } = call;
    if (method === "save") {
      saved.push(current);
    } else if (method === "restore") {
      current = saved.pop() ?? IDENTITY;
    } else if (method === "translate") {
      const v = numbers(args, 2);
      if (v) current = multiply(current, [1, 0, 0, 1, v[0], v[1]]);
    } else if (method === "scale") {
      const v = numbers(args, 2);
      if (v) current = multiply(current, [v[0], 0, 0, v[1], 0, 0]);
    } else if (method === "rotate") {
      const v = numbers(args, 1);
      if (v) {
        const c = Math.cos(v[0]);
        const sn = Math.sin(v[0]);
        current = multiply(current, [c, sn, -sn, c, 0, 0]);
      }
    } else if (method === "transform") {
      const v = numbers(args, 6);
      if (v) current = multiply(current, v as Matrix);
    } else if (method === "setTransform") {
      const v = numbers(args, 6);
      if (v) current = v as Matrix;
      else if (args.length === 0) current = IDENTITY;
      else if (typeof args[0] === "object" && args[0] !== null) {
        const m = args[0] as Record<string, unknown>;
        const parts = [m.a, m.b, m.c, m.d, m.e, m.f];
        if (parts.every((p) => typeof p === "number"))
          current = parts as Matrix;
      }
    } else if (method === "resetTransform") {
      current = IDENTITY;
    }
    visit(call, current);
  }
}

/**
 * Every run of text the frame drew, with its anchor in logical stage units.
 *
 * At the harness's default shape the canvas is the stage at one pixel per unit,
 * so what comes back is directly comparable with the figures `specs/table.md`
 * and `specs/controls.md` fix — which is how `screens/hud-shows-mode-label` reads
 * where a label landed and `presentation/hud-labels-drawn` reads whether each one
 * is inside its own rectangle.
 */
export function textDraws(calls: readonly DrawCall[]): TextDraw[] {
  const draws: TextDraw[] = [];
  walkTransforms(calls, (call, m) => {
    if (call.kind !== "call") return;
    if (call.method !== "fillText" && call.method !== "strokeText") return;
    const [text] = call.args;
    const at = numbers(call.args.slice(1), 2);
    if (typeof text !== "string" || at === null) return;
    const anchor = applyMatrix(m, at[0], at[1]);
    // The run's width under the same horizontal scale the anchor took, laid out
    // about the anchor the way the alignment in force places it.
    const width =
      typeof call.width === "number" && Number.isFinite(call.width)
        ? call.width * Math.hypot(m[0], m[1])
        : 0;
    const before =
      call.textAlign === "center"
        ? width / 2
        : call.textAlign === "right" || call.textAlign === "end"
          ? width
          : 0;
    draws.push({
      text,
      ...anchor,
      left: anchor.x - before,
      right: anchor.x - before + width,
    });
  });
  return draws;
}

/** The geometry calls a frame made, by name. */
export const DRAW_METHODS: readonly string[] = [
  "arc",
  "ellipse",
  "rect",
  "roundRect",
  "fillRect",
  "strokeRect",
  "moveTo",
  "lineTo",
  "quadraticCurveTo",
  "bezierCurveTo",
  "fill",
  "stroke",
  "drawImage",
];

/** How many drawing operations the frame issued. */
export function drawOps(calls: readonly DrawCall[]): number {
  return calls.filter(
    (call) => call.kind === "call" && DRAW_METHODS.includes(call.method),
  ).length;
}

/**
 * Every logical point a frame's drawing calls named, mapped through the
 * transform in force at each.
 *
 * The leading pair of arguments is the position for every method listed, except
 * the curve calls, whose control points come first and whose endpoint is the
 * last pair.
 */
export function drawnPoints(
  calls: readonly DrawCall[],
): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  walkTransforms(calls, (call, m) => {
    if (call.kind !== "call") return;
    const { method, args } = call;
    const push = (x: unknown, y: unknown): void => {
      if (typeof x === "number" && typeof y === "number") {
        points.push(applyMatrix(m, x, y));
      }
    };
    if (
      method === "arc" ||
      method === "ellipse" ||
      method === "rect" ||
      method === "roundRect" ||
      method === "fillRect" ||
      method === "strokeRect" ||
      method === "moveTo" ||
      method === "lineTo"
    ) {
      push(args[0], args[1]);
    } else if (method === "drawImage") {
      // The source comes first, so the destination is the pair after it — or,
      // in the nine-argument form, the pair after the source sub-rect.
      if (args.length >= 9) push(args[5], args[6]);
      else push(args[1], args[2]);
    } else if (method === "quadraticCurveTo") {
      push(args[0], args[1]);
      push(args[2], args[3]);
    } else if (method === "bezierCurveTo") {
      push(args[0], args[1]);
      push(args[2], args[3]);
      push(args[4], args[5]);
    }
  });
  return points;
}

/* -------------------------------------------------------------------------- */
/* Colour                                                                     */
/* -------------------------------------------------------------------------- */
//
// `specs/screens.md` and `specs/table.md` fix NO PALETTE and no type — the
// colours, the fonts and the card art are the build's — and state instead what a
// player must read at a glance: a red suit apart from a black one, a card back
// apart from a card face and from the table, a card face apart from the table, an
// empty slot apart from the table, a highlighted drop target apart from the same
// pile unhighlighted, and every string apart from what sits behind it. So every
// colour check is a comparison between two things the build drew, never against a
// hex value, and the DISTANCE it demands is the check's own figure, stated in the
// check beside the figure `specs/` fixes for it. Nothing here fixes one.

/** A sampled colour, each channel 0–255. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Euclidean distance between two colours, 0 to about 441. */
export function colorDistance(a: Rgb, b: Rgb): number {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

/** A colour's luminance: the reading a ramp brightens along. */
export function luminance(c: Rgb): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/**
 * The five offsets a colour sample is averaged over, in logical units.
 *
 * The centre plus four neighbours six units out. A card is `100 x 140`, so a
 * cluster this size sits well inside one wherever it is sampled, and one stray
 * anti-aliased edge, rounded corner or drop shadow cannot swing the reading.
 * Sample a card away from its own rank and suit glyphs when the reading is meant
 * to be of the card's ground rather than of its marks.
 */
const SAMPLE_OFFSETS: readonly (readonly [number, number])[] = [
  [0, 0],
  [6, 0],
  [-6, 0],
  [0, 6],
  [0, -6],
];

/** The rendered colour at a logical point, averaged over that small cluster. */
export async function sampleColor(
  h: Harness,
  x: number,
  y: number,
): Promise<Rgb> {
  const read = await h.pixels(
    SAMPLE_OFFSETS.map(([dx, dy]) => ({ x: x + dx, y: y + dy })),
  );
  let r = 0;
  let g = 0;
  let b = 0;
  for (const [pr, pg, pb] of read) {
    r += pr;
    g += pg;
    b += pb;
  }
  return { r: r / read.length, g: g / read.length, b: b / read.length };
}

/* -------------------------------------------------------------------------- */
/* Geometry                                                                   */
/* -------------------------------------------------------------------------- */
//
// Every function here is pure arithmetic over the figures `./constants.ts`
// restates from `specs/table.md`. NOT ONE OF THEM IS A TOLERANCE: they answer
// where the specification says a thing is drawn, and a check that measures how
// far a build may miss by states that distance itself.
//
// Positions are TOP-LEFT corners in logical stage units, which is the convention
// `specs/overview.md` fixes for the whole case and the one the debug surface
// takes and reports. A centre is only ever produced by asking for one.

/** A point in logical stage units. */
export interface Point {
  x: number;
  y: number;
}

/**
 * The anchor of one of the thirteen piles: the top-left a squared pile's cards
 * sit at, and the top-left of a column's first card.
 *
 * `index` is `0` for the stock and the waste, `0..3` for a foundation, and
 * `0..6` for a tableau column, exactly as the surface addresses them.
 */
export function pileTopLeft(pile: PileName, index = 0): Point {
  switch (pile) {
    case "stock":
      return { x: STOCK_X, y: TOP_ROW_Y };
    case "waste":
      return { x: WASTE_X, y: TOP_ROW_Y };
    case "foundation":
      return {
        x: requireSlot(FOUNDATION_X, index, "foundation"),
        y: TOP_ROW_Y,
      };
    case "tableau":
      return { x: requireSlot(COLUMN_X, index, "tableau"), y: TABLEAU_Y };
  }
}

function requireSlot(
  anchors: readonly number[],
  index: number,
  what: string,
): number {
  const x = anchors[index];
  if (x === undefined) {
    throw new RangeError(
      `cascade: there is no ${what} ${index}; the case has ${anchors.length}`,
    );
  }
  return x;
}

/** The centre of a card whose top-left is `(x, y)`. */
export function cardCenter(x: number, y: number): Point {
  return { x: x + CARD_W / 2, y: y + CARD_H / 2 };
}

/** The centre of a rectangle. */
export function rectCenter(r: Rect): Point {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

/** Whether a point lies inside a rectangle, half-open on the far edges. */
export function pointInRect(x: number, y: number, r: Rect): boolean {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

/** The faces of a pile, oldest first, as the column layout functions take them. */
export function facesOf(pile: readonly CardView[]): boolean[] {
  return pile.map((c) => c.faceUp);
}

/**
 * The uniform face-up offset a column of these faces is drawn with, by the
 * compression rule `specs/table.md` fixes.
 *
 * The natural offset is `FACE_UP_OFFSET` (`34`). A column whose natural extent
 * would carry its lowest card's bottom edge past `COLUMN_BOTTOM_LIMIT` (`676`)
 * has that offset reduced uniformly to the largest value that fits, and never
 * below `FACE_UP_OFFSET_MIN` (`14`). The face-down offset stays at `24` however
 * far a column is compressed.
 *
 * The value is a real number, because `specs/table.md` fixes no rounding. A check
 * on a compressed offset therefore compares against this with a tolerance OF ITS
 * OWN, wide enough to admit a build that rounded to whole units; a check on an
 * UNCOMPRESSED column is comparing against the exact figure `34` and needs none.
 */
export function columnFaceUpOffset(faces: readonly boolean[]): number {
  // The offsets sit BETWEEN cards, so the lowest card contributes none.
  const above = faces.slice(0, Math.max(faces.length - 1, 0));
  const faceUp = above.filter((up) => up).length;
  if (faceUp === 0) return FACE_UP_OFFSET;
  const faceDown = above.length - faceUp;
  const room =
    COLUMN_BOTTOM_LIMIT - CARD_H - TABLEAU_Y - FACE_DOWN_OFFSET * faceDown;
  return Math.max(FACE_UP_OFFSET_MIN, Math.min(FACE_UP_OFFSET, room / faceUp));
}

/** The top edge of each card of a column of these faces, oldest first. */
export function columnCardTops(faces: readonly boolean[]): number[] {
  const faceUp = columnFaceUpOffset(faces);
  const tops: number[] = [];
  let y = TABLEAU_Y;
  for (const [i, up] of faces.entries()) {
    tops.push(y);
    if (i < faces.length - 1) y += up ? faceUp : FACE_DOWN_OFFSET;
  }
  return tops;
}

/**
 * The top-left of the card at `row` in column `col`, `row` counted from the
 * column's first card, whose faces are `faces`.
 *
 * The faces are what decide the layout, so they are given rather than looked up:
 * a check reads them off the snapshot with {@link facesOf}, and a check that
 * poses a column already knows them.
 */
export function columnCardTopLeft(
  col: number,
  row: number,
  faces: readonly boolean[],
): Point {
  const tops = columnCardTops(faces);
  const y = tops[row];
  if (y === undefined) {
    throw new RangeError(
      `cascade: there is no row ${row} in a column of ${faces.length}`,
    );
  }
  return { x: pileTopLeft("tableau", col).x, y };
}

/** The bottom edge of the lowest drawn card of a column of these faces. */
export function columnBottom(faces: readonly boolean[]): number {
  const tops = columnCardTops(faces);
  return (tops[tops.length - 1] ?? TABLEAU_Y) + CARD_H;
}

/**
 * The rectangle a pile answers a release inside, as `specs/table.md` fixes them.
 *
 * A column HOLDING CARDS is the one rectangle that is not a card footprint: it is
 * `CARD_W` wide and runs from `TABLEAU_Y` down to the bottom edge of the column's
 * lowest drawn card, so `faces` is what says how far. Pass the faces of the
 * column as it stands at the moment of the release — which, for a run that has
 * already been lifted, is the column WITHOUT the run, because the run left its
 * pile as it entered the hand (`specs/controls.md`).
 *
 * The thirteen rectangles do not overlap, so a point lies in at most one.
 */
export function dropRect(
  pile: PileName,
  index = 0,
  faces: readonly boolean[] = [],
): Rect {
  const at = pileTopLeft(pile, index);
  if (pile === "tableau" && faces.length > 0) {
    return {
      x: at.x,
      y: TABLEAU_Y,
      w: CARD_W,
      h: columnBottom(faces) - TABLEAU_Y,
    };
  }
  return { x: at.x, y: at.y, w: CARD_W, h: CARD_H };
}

/**
 * A regular grid of sample points over a rectangle, `cols` by `rows`, each at the
 * centre of its own cell so none sits on an edge.
 *
 * For the handful of checks that read a REGION rather than a point — how much of
 * the table the cascade has painted, whether a highlight changed a pile anywhere
 * inside its rectangle. Feed it to {@link Harness.pixels}, which reads the whole
 * grid in one crossing.
 */
export function gridPoints(r: Rect, cols: number, rows: number): Point[] {
  const points: Point[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      points.push({
        x: r.x + ((col + 0.5) * r.w) / cols,
        y: r.y + ((row + 0.5) * r.h) / rows,
      });
    }
  }
  return points;
}

/** The whole stage, as a rectangle. */
export const STAGE_RECT: Rect = { x: 0, y: 0, w: STAGE_W, h: STAGE_H };

/* ---- What a frame drew, as boxes ------------------------------------------ */

/**
 * The axis-aligned box of every shape the frame PAINTED, in the order it painted
 * them, in logical stage units.
 *
 * A `fillRect` or a `strokeRect` is one box on its own. Everything else is one
 * box per path: the points named between a `beginPath` and the `fill` or
 * `stroke` that paints it, mapped through the transform in force at each. A path
 * filled and then stroked is one box, not two.
 *
 * WHY A BOX AND NOT A RECTANGLE CALL. `specs/table.md` fixes a card's footprint
 * and says nothing about how it is drawn, and the case's own two engineless
 * reference implementations already differ: one draws each card as a `fillRect`
 * with an inset `roundRect` over it, the other traces the whole card as a path of
 * lines and quadratic corners, with no rectangle call anywhere. A reading that
 * looked for `fillRect` would fail the second one for a choice the specification
 * never made. The corner points a traced rounded rectangle names are its true
 * corners, so its box is the footprint exactly.
 *
 * The extents come from the call's own numbers scaled by the transform's axis
 * scales, rather than from the difference of two mapped corners, so at the
 * harness's default shape a card comes back as exactly `100 x 140` where
 * subtracting corners would hand back `139.99999999999997`.
 *
 * TWO KINDS OF SHAPE ARE OUT OF SCOPE, and neither is reachable in this case. A
 * path built only from `arc` or `ellipse` names centres rather than extents, so
 * its box is not reported; and a rotated or mirrored frame would give the
 * bounding box rather than the shape. Cascade draws every pile axis-aligned and
 * every card as a rectangle (`specs/table.md`).
 */
export function paintedBoxes(calls: readonly DrawCall[]): Rect[] {
  const boxes: Rect[] = [];
  let points: Point[] = [];
  let painted = false;

  walkTransforms(calls, (call, m) => {
    if (call.kind !== "call") return;
    const { method, args } = call;
    const num = (i: number): number | null =>
      typeof args[i] === "number" ? (args[i] as number) : null;
    const trace = (i: number, j: number): void => {
      const x = num(i);
      const y = num(j);
      if (x !== null && y !== null) points.push(applyMatrix(m, x, y));
    };

    if (method === "beginPath") {
      points = [];
      painted = false;
      return;
    }
    if (method === "fillRect" || method === "strokeRect") {
      const box = boxOfRect(m, num(0), num(1), num(2), num(3));
      if (box !== null) boxes.push(box);
      return;
    }
    if (method === "rect" || method === "roundRect") {
      const x = num(0);
      const y = num(1);
      const w = num(2);
      const height = num(3);
      if (x !== null && y !== null && w !== null && height !== null) {
        points.push(applyMatrix(m, x, y), applyMatrix(m, x + w, y + height));
      }
      return;
    }
    if (method === "moveTo" || method === "lineTo" || method === "arcTo") {
      trace(0, 1);
      if (method === "arcTo") trace(2, 3);
      return;
    }
    if (method === "quadraticCurveTo") {
      trace(0, 1);
      trace(2, 3);
      return;
    }
    if (method === "bezierCurveTo") {
      trace(0, 1);
      trace(2, 3);
      trace(4, 5);
      return;
    }
    if (method === "fill" || method === "stroke") {
      if (!painted && points.length > 0) {
        boxes.push(boxOfPoints(points));
        painted = true;
      }
    }
  });

  return boxes;
}

function boxOfRect(
  m: Matrix,
  x: number | null,
  y: number | null,
  w: number | null,
  h: number | null,
): Rect | null {
  if (x === null || y === null || w === null || h === null) return null;
  const origin = applyMatrix(m, Math.min(x, x + w), Math.min(y, y + h));
  return {
    x: origin.x,
    y: origin.y,
    w: Math.abs(w) * Math.hypot(m[0], m[1]),
    h: Math.abs(h) * Math.hypot(m[2], m[3]),
  };
}

function boxOfPoints(points: readonly Point[]): Rect {
  let left = points[0].x;
  let right = points[0].x;
  let top = points[0].y;
  let bottom = points[0].y;
  for (const p of points) {
    left = Math.min(left, p.x);
    right = Math.max(right, p.x);
    top = Math.min(top, p.y);
    bottom = Math.max(bottom, p.y);
  }
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/**
 * The precision of the reading itself, in logical units.
 *
 * The injected recorder writes each coordinate rounded to six decimal places, so
 * a box reconstructed from two of them can miss its true extent by up to a
 * millionth of a unit — which is why a shape a build painted at exactly
 * `100 x 140` comes back as `139.99999999999997` and an exact comparison would
 * never hold. This is the channel's noise floor and NOT a tolerance on the build:
 * it is five orders of magnitude below the smallest figure the case fixes
 * (`FACE_UP_OFFSET_MIN`, `14`), so it can admit nothing a check means to catch.
 */
const READ_EPSILON = 1e-5;

/**
 * The top-left of every card-sized shape the frame painted: where the build put a
 * card, or an empty pile's card-sized mark.
 *
 * The reading behind most of the `table` group. A card's footprint is
 * `CARD_W x CARD_H` wherever it sits (`specs/table.md`), so a shape of that size
 * is a card, and its corner is the position the specification fixes.
 *
 * `tolerance` DEFAULTS TO EXACT, and it is the caller's figure rather than the
 * harness's. Zero finds the shape a build painted at exactly `100 x 140`, which
 * is what `table/card-size` is about. A check that only wants to know WHERE the
 * cards are, and that means to admit a build whose outer plate is a unit or two
 * either way, passes a few units and says in the check why that many. Keep it
 * well under `FACE_UP_OFFSET_MIN` (`14`), so two cards of a compressed column
 * never merge into one reading.
 */
export function cardFootprints(
  calls: readonly DrawCall[],
  tolerance = 0,
): Point[] {
  const slack = tolerance + READ_EPSILON;
  return paintedBoxes(calls)
    .filter(
      (r) => Math.abs(r.w - CARD_W) <= slack && Math.abs(r.h - CARD_H) <= slack,
    )
    .map((r) => ({ x: r.x, y: r.y }));
}

/**
 * The card-sized shapes a frame painted in one tableau column, highest first.
 *
 * The `y` bound is load-bearing, not tidiness: `COLUMN_X` and `FOUNDATION_X`
 * share four anchors (`590`, `712`, `834`, `956`), so a filter on `x` alone would
 * pick up the top row's pile as well. The columns begin at `TABLEAU_Y` (`180`)
 * and the top row's rectangles end at `164`, so the two never mix.
 *
 * An EMPTY column's card-sized slot mark is card-sized too, and it is reported
 * here, because from the outside a slot mark and a card are the same shape. A
 * check that means one and not the other poses the column it is reading.
 */
export function columnCardsDrawn(
  calls: readonly DrawCall[],
  col: number,
  tolerance = 0,
): Point[] {
  const anchor = pileTopLeft("tableau", col).x;
  return cardFootprints(calls, tolerance)
    .filter(
      (p) =>
        Math.abs(p.x - anchor) <= tolerance + READ_EPSILON &&
        p.y >= TABLEAU_Y - READ_EPSILON,
    )
    .sort((a, b) => a.y - b.y);
}

/**
 * The distinct rows one tableau column's cards were drawn on, highest first.
 *
 * {@link columnCardsDrawn} reports one entry per card-sized SHAPE, and a build is
 * free to draw one card as more than one of them: an outer plate filled and the
 * same rectangle stroked over it is two shapes at one corner. A column's layout,
 * though, is a list of ROWS — `specs/table.md` fixes the offset from each card to
 * the one below it — so shapes closer together than `tolerance` are one row here.
 *
 * The whole `table` group's offset and compression readings come off this: a
 * column's gaps are the differences between consecutive rows, and a gap is
 * comparable with the figure the specification fixes for it without ever knowing
 * how many shapes the build spent on a card.
 *
 * `tolerance` is the caller's figure, exactly as it is for
 * {@link cardFootprints}, and it has to stay well under `FACE_UP_OFFSET_MIN`
 * (`14`) so that two cards of a compressed column are never merged into one row.
 */
export function columnRowTops(
  calls: readonly DrawCall[],
  col: number,
  tolerance = 0,
): number[] {
  const rows: number[] = [];
  for (const { y } of columnCardsDrawn(calls, col, tolerance)) {
    const last = rows[rows.length - 1];
    if (last === undefined || y - last > tolerance + READ_EPSILON) rows.push(y);
  }
  return rows;
}

/* -------------------------------------------------------------------------- */
/* Reading a snapshot                                                         */
/* -------------------------------------------------------------------------- */
//
// Plain functions over the object `snapshot()` returned. They pull a card, a
// pile, a flyer or an identity out of it and nothing more; none of them crosses
// into the page and none of them decides anything.
//
// THE ORDER OF A PILE IS THE SPECIFICATION'S: bottom card first, top card last.
// In a tableau column the last entry is the card drawn LOWEST on the table, which
// is the exposed card — the one a run stacks onto and the one a grab takes first.
// Getting that backwards is the easiest mistake to make in this case, so read a
// column's playable card with {@link lowestFaceUp} rather than by index.

/** The pile the surface addresses as `(pile, index)`. */
export function pileOf(
  snapshot: CascadeSnapshot,
  pile: PileName,
  index = 0,
): CardView[] {
  switch (pile) {
    case "stock":
      return snapshot.stock;
    case "waste":
      return snapshot.waste;
    case "foundation":
      return requirePile(snapshot.foundations, index, "foundation");
    case "tableau":
      return requirePile(snapshot.tableau, index, "tableau");
  }
}

function requirePile(
  piles: readonly CardView[][],
  index: number,
  what: string,
): CardView[] {
  const pile = piles[index];
  if (pile === undefined) {
    throw new RangeError(
      `cascade: the snapshot reports no ${what} ${index}; it reports ${piles.length}`,
    );
  }
  return pile;
}

/** The card on top of a pile, or `undefined` when the pile is empty. */
export function topOf(pile: readonly CardView[]): CardView | undefined {
  return pile[pile.length - 1];
}

/** The card at the bottom of a pile, or `undefined` when the pile is empty. */
export function bottomOf(pile: readonly CardView[]): CardView | undefined {
  return pile[0];
}

/** Every card on the table, whichever of the thirteen piles holds it. */
export function everyCard(snapshot: CascadeSnapshot): CardView[] {
  return [
    ...snapshot.stock,
    ...snapshot.waste,
    ...snapshot.foundations.flat(),
    ...snapshot.tableau.flat(),
  ];
}

/** The card with that id, wherever it is, or `undefined`. */
export function cardById(
  snapshot: CascadeSnapshot,
  id: number,
): CardView | undefined {
  return everyCard(snapshot).find((card) => card.id === id);
}

/** Where the card with that id sits, or `null` when no pile holds it. */
export function whereIs(
  snapshot: CascadeSnapshot,
  id: number,
): { pile: PileName; index: number; row: number } | null {
  const places: { pile: PileName; index: number; cards: CardView[] }[] = [
    { pile: "stock", index: 0, cards: snapshot.stock },
    { pile: "waste", index: 0, cards: snapshot.waste },
    ...snapshot.foundations.map((cards, index) => ({
      pile: "foundation" as PileName,
      index,
      cards,
    })),
    ...snapshot.tableau.map((cards, index) => ({
      pile: "tableau" as PileName,
      index,
      cards,
    })),
  ];
  for (const place of places) {
    const row = place.cards.findIndex((card) => card.id === id);
    if (row >= 0) return { pile: place.pile, index: place.index, row };
  }
  return null;
}

/**
 * A card's suit and rank as one string, `"spades-13"`.
 *
 * The key an identity comparison over a whole deck is made on: `deal/full-deck`
 * asks whether the fifty-two dealt are one of each pair, which is a question
 * about suits and ranks rather than about ids.
 */
export function cardKey(card: Pick<CardView, "suit" | "rank">): string {
  return `${card.suit}-${card.rank}`;
}

/** Whether two cards are the same suit and rank. Ids are compared directly. */
export function sameCard(
  a: Pick<CardView, "suit" | "rank">,
  b: Pick<CardView, "suit" | "rank">,
): boolean {
  return a.suit === b.suit && a.rank === b.rank;
}

/** Which colour a suit is drawn in (`specs/deal.md`). */
export function colorOf(suit: Suit): CardColor {
  return suit === "hearts" || suit === "diamonds" ? "red" : "black";
}

/** The other colour. */
export function oppositeColor(color: CardColor): CardColor {
  return color === "red" ? "black" : "red";
}

/**
 * The cards the waste is SHOWING, oldest first, by the set rule
 * `specs/stock.md` fixes: the cards still on the newest set that holds any.
 *
 * They are the last `wasteVisibleCount` cards of the waste, because the sets
 * partition it from the bottom up. A waste whose set memory is empty shows none,
 * whatever cards it holds.
 */
export function wasteShown(snapshot: CascadeSnapshot): CardView[] {
  const count = Math.max(
    0,
    Math.min(snapshot.wasteVisibleCount, snapshot.waste.length),
  );
  return count === 0 ? [] : snapshot.waste.slice(snapshot.waste.length - count);
}

/**
 * The waste's top card: the last of the cards it shows, and the only one that
 * may be played.
 *
 * `undefined` when the waste shows nothing, which includes a waste holding cards
 * with an empty set memory — a defined state `specs/stock.md` closes, not an
 * accident.
 */
export function wasteTop(snapshot: CascadeSnapshot): CardView | undefined {
  return topOf(wasteShown(snapshot));
}

/**
 * A column's exposed card — the one drawn lowest — when it is face-up, and
 * `undefined` when the column is empty or its lowest card is face-down.
 *
 * This is the column's playable card: what a press lifts, what an auto-move
 * sends, and what a run is stacked onto.
 */
export function lowestFaceUp(
  snapshot: CascadeSnapshot,
  col: number,
): CardView | undefined {
  const card = topOf(pileOf(snapshot, "tableau", col));
  return card !== undefined && card.faceUp ? card : undefined;
}

/**
 * The unbroken tail of face-up cards at the bottom of a column, in pile order.
 *
 * The cards a press on the topmost of them would lift together, before the
 * ordered-run rule `specs/tableau.md` fixes is applied to them.
 */
export function faceUpRun(snapshot: CascadeSnapshot, col: number): CardView[] {
  const column = pileOf(snapshot, "tableau", col);
  let start = column.length;
  while (start > 0 && column[start - 1].faceUp) start -= 1;
  return column.slice(start);
}

/** The flyer with that id, or `undefined`. */
export function flyerById(
  snapshot: CascadeSnapshot,
  id: number,
): FlyerView | undefined {
  return snapshot.flyers.find((flyer) => flyer.id === id);
}

/** The flyer added last, which is the one {@link poseFlyer} just appended. */
export function lastFlyer(snapshot: CascadeSnapshot): FlyerView | undefined {
  return snapshot.flyers[snapshot.flyers.length - 1];
}

/**
 * The flyer with that id, failing the check with the scenario it needed.
 *
 * For the point in a check where the flyer's absence is not the thing being
 * decided: a check reading a bounce needs the flyer to still be in flight to have
 * anything to read, and a build that retired it early should fail with THAT said
 * rather than with a `TypeError` on `undefined`.
 */
export function requireFlyer(
  snapshot: CascadeSnapshot,
  id: number,
  doing: string,
): FlyerView {
  const flyer = flyerById(snapshot, id);
  if (flyer === undefined) {
    fail(
      `the flyer ${id} to still be in flight (${doing})`,
      `the flight holds ${snapshot.flyers.length} card(s), none of them ${id}`,
    );
  }
  return flyer;
}

/**
 * The card with that id, failing the check with the scenario it needed.
 *
 * The companion to {@link requireFlyer}, for a check following one card across a
 * move.
 */
export function requireCard(
  snapshot: CascadeSnapshot,
  id: number,
  doing: string,
): CardView {
  const card = cardById(snapshot, id);
  if (card === undefined) {
    fail(
      `the card ${id} to still be on the table (${doing})`,
      `no pile holds it; the table holds ${everyCard(snapshot).length} card(s)`,
    );
  }
  return card;
}

/* -------------------------------------------------------------------------- */
/* Scenario helpers                                                           */
/* -------------------------------------------------------------------------- */
//
// EVERY COMPOUND SEQUENCE IN THIS PROJECT LIVES HERE. The debug surface is atomic
// — `specs/instrumentation.md` gives it one operation per field — so there is no
// `setBoard`, no `newGame` and no `dealAndPlay` to reach for, and there must not
// be: a patch operation would impose the case's own state layout on the build.
// What a check wants instead is a helper, built out of those atomic operations,
// that poses the table and then lets the build's own rules run from there.
//
// A CHECK TAKES ONLY THE PART IT ASKS FOR. `openTable` resets, poses the
// `playing` screen and empties the thirteen piles, and a check that wants a
// column asks for one. A check that needs half a sequence calls the operations it
// needs.
//
// THE FOUR GATES STAY ON. `openTable` leaves `autoFlip`, `winDetect`, `launching`
// and `trailPainting` at their reset defaults, which are all on. A CHECK TURNS A
// GATE OFF ONLY WHERE THE GATE IS ITS OWN REQUIREMENT, or where its requirement
// would otherwise be entangled with another rule — the `cascade` group's
// `setTrailPainting(false)`, and the single-flyer checks' `setLaunching(false)`.
// Cascade needs no world gates at all: nothing here arrives uninvited, the game
// moves only when the player moves it, and an empty posed table is already an
// isolated world.
//
// AND NONE OF THEM ASSERTS A VERDICT. A helper fails only when the game is not
// even in the situation the caller's scenario needs — a press that lifted
// nothing, a win path the build refused — and then with what it needed named.

/** One card to pose: a suit, a rank of 1 (Ace) to 13 (King), and a face. */
export interface CardSpec {
  suit: Suit;
  rank: number;
  /** Defaults to face-up, which is what almost every posed card wants. */
  faceUp?: boolean;
}

const RANK_LETTERS: Readonly<Record<string, number>> = {
  A: 1,
  J: 11,
  Q: 12,
  K: 13,
};

const SUIT_LETTERS: Readonly<Record<string, Suit>> = {
  S: "spades",
  H: "hearts",
  D: "diamonds",
  C: "clubs",
};

/**
 * One card written the way a player says it: `"AS"`, `"10H"`, `"QD"`, `"2C"`.
 *
 * Sugar over {@link CardSpec} and nothing more. A scenario that names six cards
 * reads as six cards this way and as a wall of object literals otherwise, and a
 * transposed suit is visible at a glance. The long form is equally welcome
 * wherever it reads better, and a rank the surface takes is always the number.
 *
 * Throws on anything it cannot read, because a mistyped card in a scenario is a
 * defect in the check rather than in the build.
 */
export function card(text: string, faceUp = true): CardSpec {
  const match = /^(10|[2-9]|[AJQK])([SHDC])$/.exec(text);
  if (match === null) {
    throw new RangeError(
      `cascade: "${text}" is not a card; write a rank (A, 2-10, J, Q, K) then a suit (S, H, D, C), as in "QH"`,
    );
  }
  const [, rank, suit] = match;
  return {
    suit: SUIT_LETTERS[suit],
    rank: RANK_LETTERS[rank] ?? Number(rank),
    faceUp,
  };
}

/** {@link card} over a list, in the order given. */
export function cards(...texts: readonly string[]): CardSpec[] {
  return texts.map((text) => card(text));
}

/** The same, face-down. */
export function faceDown(...texts: readonly string[]): CardSpec[] {
  return texts.map((text) => card(text, false));
}

/**
 * A descending run of alternating colour, `length` cards long, headed by `top`
 * and returned IN PILE ORDER — `top` first, the lowest rank last.
 *
 * Which is the order {@link poseColumn} takes and the order a column is drawn in:
 * the last card of the run is the one drawn lowest and the one a grab takes
 * first. `runDown(card("KS"), 3)` is the King of spades, the Queen of hearts and
 * the Jack of spades.
 *
 * The two suits it alternates between default to spades and hearts, and the
 * heading card always keeps its own suit. Name others where a scenario needs a
 * particular pair.
 */
export function runDown(
  top: CardSpec,
  length: number,
  suits: { black?: Suit; red?: Suit } = {},
): CardSpec[] {
  const black = suits.black ?? "spades";
  const red = suits.red ?? "hearts";
  const run: CardSpec[] = [];
  for (let i = 0; i < length; i += 1) {
    const rank = top.rank - i;
    if (rank < RANK_MIN) {
      throw new RangeError(
        `cascade: a run of ${length} from rank ${top.rank} would run past the Ace`,
      );
    }
    const color =
      i % 2 === 0 ? colorOf(top.suit) : oppositeColor(colorOf(top.suit));
    run.push({
      suit: i === 0 ? top.suit : color === "red" ? red : black,
      rank,
      faceUp: top.faceUp ?? true,
    });
  }
  return run;
}

/**
 * A column of `count` distinct cards, the first `downCount` of them face-down and
 * every one after them face-up.
 *
 * A column's layout follows from its FACES alone (`specs/table.md`): the offset
 * under a card is decided by whether that card is face-up or face-down, and a
 * card's suit and rank decide nothing about where it is drawn. So the long
 * columns the `table` group poses for the compression rule say only how many
 * cards they hold and how many of those are face-down, and the cards themselves
 * are dealt out of one deck in order so that no pose puts the same card on the
 * table twice.
 *
 * Throws past a deck, because a scenario that asked for fifty-three cards has a
 * defect in it rather than in the build.
 */
export function columnOfCards(count: number, downCount = 0): CardSpec[] {
  const deck = SUITS.length * RANK_MAX;
  if (count > deck) {
    throw new RangeError(
      `cascade: a column of ${count} cards would need more than the ${deck} of one deck`,
    );
  }
  return Array.from({ length: count }, (_, i) => ({
    suit: SUITS[Math.floor(i / RANK_MAX)],
    rank: (i % RANK_MAX) + 1,
    faceUp: i >= downCount,
  }));
}

/**
 * Open an empty table, live and at rest, ready for a scenario.
 *
 * `reset()`, then `setScreen("playing")`, then `clearTable()`. Reset already
 * empties every pile, and the clear is here so the helper says what it leaves
 * rather than resting on the build having reset correctly: a build whose `reset`
 * missed a pile fails `instrumentation/reset-restores-title` and nothing else.
 *
 * AN EMPTY TABLE IS AN ISOLATED WORLD ON ITS OWN. Cascade has no autonomous
 * entity: no card is dealt, turned, moved or launched unless something asks for
 * it, so there is nothing to gate and no spawner to shut. The four faculty gates
 * are left ON, at their reset defaults, and a check turns one off only where the
 * gate is its own requirement.
 *
 * It leaves the mute bit exactly as it stands, because `reset` does
 * (`specs/instrumentation.md`) and muting is the player's.
 *
 * IT READS BACK WHAT IT POSED, and fails here rather than letting a check read a
 * board it never reached. `specs/controls.md` has a control answer only on the
 * screen it belongs to, so a build that never left the title would answer none of
 * the HUD's controls — and a point asking whether the HUD's MENU RETURNS to the
 * title would read `title` back off a game that had never left it and call that a
 * pass. Every scenario in this project opens through here, so one reading buys
 * that guarantee for all of them, and the failure names the pose rather than the
 * requirement the check went on to read.
 */
export async function openTable(h: Harness): Promise<void> {
  await h.debug.reset();
  await h.debug.setScreen("playing");
  await h.debug.clearTable();

  const opened = await h.snapshot();
  if (opened.screen !== "playing") {
    fail(
      'posing: setScreen("playing") to put the game on the live table, which ' +
        "is the screen every scenario here is driven on " +
        "(specs/instrumentation.md)",
      `snapshot().screen reports ${JSON.stringify(opened.screen)}`,
    );
  }
}

/**
 * Add cards to the top of a pile, first given first, and hand back their ids in
 * the same order.
 *
 * A run of `addCard`, which is the atomic operation: the surface takes no layout,
 * so a pile is built one card at a time. They go over in one crossing
 * ({@link Harness.pose}) because nothing decides anything between them and a
 * round trip each is a cost the host sets. The ids come from a single snapshot
 * afterwards rather than one per card, and they are the pile's last entries
 * because `addCard` appends (`specs/instrumentation.md`).
 */
async function addCards(
  h: Harness,
  pile: PileName,
  index: number,
  specs: readonly CardSpec[],
): Promise<number[]> {
  await h.pose(
    specs.map((spec) => ({
      op: "addCard",
      args: [pile, index, spec.suit, spec.rank, spec.faceUp ?? true],
    })),
  );
  if (specs.length === 0) return [];
  const placed = pileOf(await h.snapshot(), pile, index);
  if (placed.length < specs.length) {
    fail(
      `addCard to append ${specs.length} card(s) to the ${pile} (specs/instrumentation.md)`,
      `the ${pile} holds ${placed.length} card(s) after the adds`,
    );
  }
  return placed.slice(placed.length - specs.length).map((c) => c.id);
}

/**
 * Lay a tableau column, FIRST CARD FIRST, and hand back the ids in that order.
 *
 * The first card given is the column's first card, drawn highest on the table at
 * `TABLEAU_Y`; the last is the one drawn lowest, which is the column's exposed
 * card and the one a grab takes first. That is the order a snapshot reports the
 * column in, so the ids come back aligned with what a later read will show.
 */
export function poseColumn(
  h: Harness,
  col: number,
  specs: readonly CardSpec[],
): Promise<number[]> {
  return addCards(h, "tableau", col, specs);
}

/**
 * Build foundation `index` up from the Ace to `upTo` in one suit, face-up, and
 * hand back the ids from the Ace upward.
 *
 * A foundation builds up in order (`specs/foundations.md`), so this is the only
 * shape a legal foundation has: `poseFoundation(h, 0, "spades", 5)` leaves the
 * Ace through the five of spades with the five on top.
 */
export function poseFoundation(
  h: Harness,
  index: number,
  suit: Suit,
  upTo: number,
): Promise<number[]> {
  if (upTo < RANK_MIN || upTo > RANK_MAX) {
    throw new RangeError(
      `cascade: a foundation runs from ${RANK_MIN} to ${RANK_MAX}, not to ${upTo}`,
    );
  }
  const specs: CardSpec[] = [];
  for (let rank = RANK_MIN; rank <= upTo; rank += 1) {
    specs.push({ suit, rank, faceUp: true });
  }
  return addCards(h, "foundation", index, specs);
}

/**
 * Lay the waste, BOTTOM CARD FIRST, and give it the set memory those cards
 * belong to, OLDEST SET FIRST.
 *
 * The sets are a required argument and are never omitted, because a waste holding
 * cards with no sets shows nothing and offers nothing to play
 * (`specs/stock.md`) — a defined state, and never one a pose should reach by
 * accident. They are also never allowed to claim more cards than were given: the
 * cards belong to the sets from the bottom up, so `poseWaste(h, cards("2C", "5H",
 * "9S"), [2, 1])` leaves the `9S` alone on the newest set and showing, with the
 * other two squared away behind it.
 *
 * Cards the sets do not reach are the buried remainder, which is exactly what
 * `draw-three/set-falls-back` is about.
 */
export async function poseWaste(
  h: Harness,
  specs: readonly CardSpec[],
  sets: readonly number[],
): Promise<number[]> {
  const claimed = sets.reduce((total, n) => total + n, 0);
  if (claimed > specs.length) {
    throw new RangeError(
      `cascade: poseWaste was given ${specs.length} card(s) and sets claiming ${claimed}`,
    );
  }
  const ids = await addCards(h, "waste", 0, specs);
  for (const count of sets) await h.debug.addWasteSet(count);
  return ids;
}

/**
 * Lay the stock, BOTTOM CARD FIRST, and hand back the ids in that order.
 *
 * So the LAST card given is the stock's top card, and it is the first one the
 * next turn takes (`specs/stock.md`).
 */
export function poseStock(
  h: Harness,
  specs: readonly CardSpec[],
): Promise<number[]> {
  return addCards(h, "stock", 0, specs);
}

/** One card to put in flight. Its position is its TOP-LEFT. */
export interface FlyerSpec {
  x: number;
  y: number;
  /** Logical units per second. Both default to `0`, a card simply dropped. */
  vx?: number;
  vy?: number;
  /** The card's face value. It decides nothing but what is drawn. */
  suit?: Suit;
  rank?: number;
}

/**
 * Put one card in flight and hand back its id.
 *
 * It is appended, so it is the last entry of `flyers`, and from there it flies,
 * bounces, paints and retires through the game's own cascade rules. Posing a
 * flyer on a cleared table is the cheap way to read one parabola instead of
 * fifty-two, and it is why `setLaunching(false)` exists.
 */
export async function poseFlyer(h: Harness, spec: FlyerSpec): Promise<number> {
  await h.debug.addFlyer(
    spec.suit ?? "spades",
    spec.rank ?? RANK_MAX,
    spec.x,
    spec.y,
    spec.vx ?? 0,
    spec.vy ?? 0,
  );
  const added = lastFlyer(await h.snapshot());
  if (added === undefined) {
    fail(
      "addFlyer to append a card to the flight (specs/instrumentation.md)",
      "the flight was still empty after addFlyer",
    );
  }
  return added.id;
}

/** The one card {@link poseNearlyWon} keeps off the foundations, and where. */
export interface MissingCard {
  suit: Suit;
  /**
   * It has to be the King. A foundation builds up in order, so a lower card kept
   * out would keep every card above it out too and the foundations would hold
   * fewer than fifty-one.
   */
  rank?: number;
  /** Where it is put instead. Defaults to column 0, face-up and alone. */
  at?: { pile: PileName; index: number };
  faceUp?: boolean;
}

/**
 * Fill all four foundations Ace to King except for one named King, which goes
 * where the caller asked for it, and hand back that King's id.
 *
 * Fifty-one cards home and one still out: the position every win check starts
 * from. Foundation `i` takes `SUITS[i]`, which is a choice this helper is free to
 * make because `specs/foundations.md` lets any suit start any foundation and
 * `foundations/any-suit-any-slot` is the item that grades it.
 *
 * It clears the four foundations before it fills them, since filling them is what
 * it is for, and it touches nothing else. Call {@link openTable} first if the
 * scenario wants the rest of the table empty as well.
 *
 * Nothing here wins the game: `addCard` is a pose, so the win test does not run.
 * {@link startCascade} is what drives the last card home through the real path.
 */
export async function poseNearlyWon(
  h: Harness,
  missing: MissingCard = { suit: SUITS[SUITS.length - 1] },
): Promise<number> {
  const rank = missing.rank ?? RANK_MAX;
  if (rank !== RANK_MAX) {
    throw new RangeError(
      `cascade: poseNearlyWon keeps a King out, not a ${rank}; a foundation builds up in order, so a lower card kept out keeps every card above it out too`,
    );
  }
  const where = missing.at ?? { pile: "tableau" as PileName, index: 0 };
  for (const [index, suit] of SUITS.entries()) {
    await h.debug.clearPile("foundation", index);
    await poseFoundation(
      h,
      index,
      suit,
      suit === missing.suit ? RANK_MAX - 1 : RANK_MAX,
    );
  }
  const [id] = await addCards(h, where.pile, where.index, [
    { suit: missing.suit, rank, faceUp: missing.faceUp ?? true },
  ]);
  return id;
}

/**
 * Win the game through its own win path, so the victory cascade is running.
 *
 * {@link poseNearlyWon} puts fifty-one cards home and the last King alone on a
 * column, then a real `move()` sends it to its foundation: the win test runs, the
 * screen becomes `won`, and the cascade takes over, exactly as it does for a
 * player. Nothing about the ending is posed.
 *
 * It fails the check when the build refuses that move or does not reach `won`,
 * because a scenario that never entered the cascade has nothing to say about it.
 *
 * Call {@link openTable} first. The cascade's own gates are left as they stand,
 * so a check that wants one parabola rather than fifty-two, or frames with no
 * full-screen blit in them, turns `setLaunching` or `setTrailPainting` off
 * itself.
 */
export async function startCascade(
  h: Harness,
  options: { column?: number; suit?: Suit } = {},
): Promise<void> {
  const column = options.column ?? 0;
  const suit = options.suit ?? SUITS[SUITS.length - 1];
  const foundation = SUITS.indexOf(suit);
  await h.debug.clearPile("tableau", column);
  await poseNearlyWon(h, { suit, at: { pile: "tableau", index: column } });
  const accepted = await h.debug.move(
    "tableau",
    column,
    0,
    "foundation",
    foundation,
  );
  if (!accepted) {
    fail(
      `the King of ${suit} to be accepted by its foundation, completing the board (specs/foundations.md)`,
      "the move was refused, so the game was never won and no cascade began",
    );
  }
  const won = await h.snapshot();
  if (won.screen !== "won") {
    fail(
      'screen "won" once all fifty-two cards are home (specs/victory.md)',
      `screen ${JSON.stringify(won.screen)}`,
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Gestures                                                                   */
/* -------------------------------------------------------------------------- */
//
// The surface's `pointerDown`, `pointerMove` and `pointerUp` feed the same input
// path the player's pointer feeds and resolve the moment they are called
// (`specs/instrumentation.md`), so a whole gesture can be driven without
// advancing the game at all. That is what makes the click, the drop and the
// double click cheap to pose, and it is what fixes the double click's clock: two
// presses with no advance between them are 0 s of game time apart.
//
// A REAL MOUSE IS A DIFFERENT INSTRUMENT, and the four functions at the end of
// this section are it. Use them where the subject is what a FRAME did with a
// player's input — `handling/sweep-resolves-per-sample`, and any cue whose event
// is a gesture — because a cue is played on the frame its event happens
// (`specs/audio.md`) and only a real event delivered to the build's own listeners
// exercises the path a player uses.

/**
 * Press, glide, and release, as the pointer positions the surface is given.
 *
 * `steps` interpolated moves separate the press from the release, so a build that
 * reads the run's position from the pointer has something to follow.
 *
 * Whether this is a CLICK or a DROP is the caller's to arrange: a release within
 * `DRAG_THRESHOLD` (`5`) of the press is a click (`specs/controls.md`), and
 * `handling/drag-threshold` is the item that grades the boundary. This helper
 * fixes neither side of it.
 */
export async function drag(
  h: Harness,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  steps = 6,
): Promise<void> {
  await h.debug.pointerDown(x0, y0);
  const whole = Math.max(1, Math.round(steps));
  for (let i = 1; i <= whole; i += 1) {
    await h.debug.pointerMove(
      x0 + ((x1 - x0) * i) / whole,
      y0 + ((y1 - y0) * i) / whole,
    );
  }
  await h.debug.pointerUp(x1, y1);
}

/**
 * Press at `(pressX, pressY)`, carry whatever that lifted so that the LEADING
 * CARD'S CENTRE lands on `(targetX, targetY)`, and release it there.
 *
 * A drop resolves to the pile whose drop rectangle contains the centre of the
 * run's leading card, not the pile under the pointer (`specs/controls.md`), and
 * the run keeps the offset between the press point and that card's top-left. So
 * the release point is the press point shifted by however far the centre has to
 * travel — arithmetic every drop check would otherwise repeat, and get subtly
 * wrong in the same way.
 *
 * The offset is measured from the run the build itself reports after the press,
 * so a build that lifts a run at a different offset is still carried to the
 * target the check named. It fails when the press lifted nothing, because a
 * scenario about where a run lands has nothing to say when no run was held.
 *
 * Pair it with {@link rectCenter} over {@link dropRect} to name a target:
 * `dragRunTo(h, press.x, press.y, ...rectCenter(dropRect("foundation", 2)))`.
 */
export async function dragRunTo(
  h: Harness,
  pressX: number,
  pressY: number,
  targetX: number,
  targetY: number,
  steps = 6,
): Promise<void> {
  await h.debug.pointerDown(pressX, pressY);
  const held = (await h.snapshot()).drag;
  if (held === null) {
    fail(
      `a press at (${pressX}, ${pressY}) to lift a run (specs/controls.md)`,
      "nothing was in hand after the press, so there was nothing to carry",
    );
  }
  const centre = cardCenter(held.x, held.y);
  const releaseX = pressX + (targetX - centre.x);
  const releaseY = pressY + (targetY - centre.y);
  const whole = Math.max(1, Math.round(steps));
  for (let i = 1; i <= whole; i += 1) {
    await h.debug.pointerMove(
      pressX + ((releaseX - pressX) * i) / whole,
      pressY + ((releaseY - pressY) * i) / whole,
    );
  }
  await h.debug.pointerUp(releaseX, releaseY);
}

/**
 * A press and a release at the same point, which is a click rather than a drop
 * because the release lies within `DRAG_THRESHOLD` of the press.
 *
 * The gesture that activates a control and turns the stock (`specs/controls.md`).
 */
export async function clickAt(h: Harness, x: number, y: number): Promise<void> {
  await h.debug.pointerDown(x, y);
  await h.debug.pointerUp(x, y);
}

/**
 * Two clicks at one point with no advance between them, so the two presses are
 * 0 s of game time apart and the second is inside `DOUBLE_CLICK_WINDOW`.
 *
 * A check about the window or the slop drives the two presses itself, with its
 * own `advance` or its own offset between them, because those figures are the
 * check's subject.
 */
export async function doubleClickAt(
  h: Harness,
  x: number,
  y: number,
): Promise<void> {
  await clickAt(h, x, y);
  await clickAt(h, x, y);
}

/** Show or hide the read-only debug overlay, through its fixed Backquote binding. */
export async function toggleOverlay(h: Harness): Promise<void> {
  await h.tap(OVERLAY_KEY);
}

/* ---- The real pointer ------------------------------------------------------ */

/** Press the real mouse at a logical stage point, and run the frame that reads it. */
export async function mousePress(
  h: Harness,
  x: number,
  y: number,
): Promise<void> {
  const at = h.css(x, y);
  await h.page.mouse.move(at.x, at.y);
  await h.page.mouse.down();
  await h.advance(1);
}

/** Move the held mouse to a logical stage point, and run the frame that reads it. */
export async function mouseGlide(
  h: Harness,
  x: number,
  y: number,
): Promise<void> {
  const at = h.css(x, y);
  await h.page.mouse.move(at.x, at.y);
  await h.advance(1);
}

/** Release the real mouse, and run the frame that reads it. */
export async function mouseRelease(h: Harness): Promise<void> {
  await h.page.mouse.up();
  await h.advance(1);
}

/**
 * Press, move and release the REAL mouse without a frame in between, then run one
 * frame.
 *
 * The whole gesture is delivered before a single update, which is what
 * `handling/sweep-resolves-per-sample` is about: a build that answers every
 * sample the frame delivers lifts the run on the press and completes the drop on
 * the release, and a build that keeps only each frame's last sample sees the
 * release alone, has nothing in hand, and fails.
 */
export async function mouseSweepInOneFrame(
  h: Harness,
  through: readonly Point[],
): Promise<void> {
  if (through.length < 2) {
    throw new RangeError(
      `cascade: a sweep needs at least a press and a release, got ${through.length} point(s)`,
    );
  }
  const [first, ...rest] = through.map((p) => h.css(p.x, p.y));
  await h.page.mouse.move(first.x, first.y);
  await h.page.mouse.down();
  for (const at of rest) await h.page.mouse.move(at.x, at.y);
  await h.page.mouse.up();
  await h.advance(1);
}

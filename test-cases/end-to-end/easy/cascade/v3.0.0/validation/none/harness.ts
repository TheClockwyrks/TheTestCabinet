// Cascade — the case's half of the validator harness. CASE-PROVIDED.
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
// THE MACHINERY THAT DRIVES THE PAGE IS NOT CASCADE'S. Serving the build,
// connecting to the one browser, opening a page per harness, injecting the
// draw-command recorder and the audio probe, bracketing each driven frame around
// one step of the build's surface, driving the real mouse and the real finger,
// reading pixels and draw calls back out, and writing the evidence a review point
// declares — every engineless case needs exactly that, and it lives once, in
// `@clockwyrks/case-harness`, staged beside this file as `./case-harness/`.
// What is left here is what is genuinely Cascade's: the shape of its snapshot,
// the operations its `specs/instrumentation.md` requires, the table its checks
// are posed on, and the readings its own geometry answers.
//
// The seam is one call. `createCaseHarness` takes the case's TYPES as type
// arguments and the case's VALUES as one object, and hands back the machinery
// with Cascade's names and Cascade's types on it — so the suites next door go on
// importing `createHarness`, `captureStill` and `watchCues` from `../harness`
// exactly as they did, and none of them can tell the difference.
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

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ConstantClock,
  IDENTITY,
  apply,
  createCaseHarness,
  drawnText,
  mouseGlide,
  mousePress,
  mouseRelease,
  rectCenter,
  sampleColor as sampleCluster,
  touchGlide,
  touchPress,
  touchRelease,
  transformed,
  type DrawCall,
  type Harness as BaseHarness,
  type HarnessOptions,
  type Matrix,
  type Point,
  type Rgb,
  type TimedCue,
  type UntilResult as BaseUntilResult,
} from "./case-harness/index";
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
  // Muting (this engine alone).
  "setMuted",
  // The core.
  "reset",
  "snapshot",
  "menuItemRect",
  // The screen and the menus.
  "setScreen",
  "setMenuIndex",
  "setTitleIndex",
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
  "drawLaunchVx",
] as const;

/** The four screens the game moves between (`specs/screens.md`). */
export type Screen = "title" | "howto" | "playing" | "won";

/** How the surface names one of the thirteen piles (`specs/instrumentation.md`). */
export type PileName = "stock" | "waste" | "foundation" | "tableau";

/** A pile a run may be lifted from. The stock is never a source. */
export type SourcePile = "waste" | "foundation" | "tableau";

/** A pile a run may land on. */
export type TargetPile = "foundation" | "tableau";

/**
 * One menu item's hit region, as `menuItemRect` reports it.
 *
 * `x` and `y` are the region's top-left corner and `w` and `h` its size, all in
 * logical stage units (`specs/instrumentation.md`). WHERE a build puts its items
 * is the build's own (`specs/controls.md`: "Each control occupies a rectangular
 * hit region the build lays out"), so a check drives the pointer at what this
 * reports and never at a rectangle of its own.
 */
export interface MenuRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

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
  /** The selected item on the menu the current screen shows. */
  menuIndex: number;
  /** The title menu's remembered selection: the entry last activated there. */
  titleIndex: number;
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
  reset(): Promise<void>;
  snapshot(): Promise<CascadeSnapshot>;
  /** The region of item `index` on the current screen's menu, or `null`. */
  menuItemRect(index: number): Promise<MenuRect | null>;

  setAutoStep(enabled: boolean): Promise<void>;
  advance(seconds: number, frames?: number): Promise<void>;

  /** The runtime's mute bit, which exists as an operation under this engine alone. */
  setMuted(muted: boolean): Promise<void>;

  setScreen(screen: Screen): Promise<void>;
  setMenuIndex(index: number): Promise<void>;
  setTitleIndex(index: number): Promise<void>;

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
  /** One launch's `vx` draw, performed alone: the signed value it drew. */
  drawLaunchVx(): Promise<number>;
}

/* -------------------------------------------------------------------------- */
/* The harness, bound to this case                                            */
/* -------------------------------------------------------------------------- */
//
// WHY 240 Hz IS THE STEP. Cascade runs on no fixed timestep: every rate is per
// second and integrated against the delta the frame supplies
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

/**
 * The shared harness, with Cascade's snapshot, Cascade's surface and Cascade's
 * figures bound into it.
 *
 * `projectRoot` comes from THIS module and must never come from the package's:
 * the package is staged one directory deeper than this file, and a produced
 * replay or still is addressed by the running suite's path relative to the
 * project root. Taken from the package it would address every output one level
 * too deep — and silently, because a writer that raised on a failed write would
 * be blaming the build for the host's problem, so neither of them raises.
 */
const kit = createCaseHarness<CascadeSnapshot, CascadeDebugApi>({
  slug: "cascade",
  handle: HANDLE,
  requiredOps: REQUIRED_OPS,
  // `advance(seconds, frames)`: a span of simulated time divided into whole
  // frames, so the suite's clock decides how long a frame is
  // (`specs/instrumentation.md`, The clock).
  step: { kind: "seconds-frames", op: "advance" },
  stage: { width: STAGE_W, height: STAGE_H },
  tickHz: 240,
  // A GENUINE browser gesture, so the build's audio can open: a build is free to
  // open its audio context from a real DOM event alone (both are conformant), so
  // a gesture delivered any other way would leave a perfectly good build silent.
  // `specs/controls.md` binds this key to nothing, so arming changes no game
  // state, opens no overlay, and records no press for the double-click rule.
  // Cascade's suites deliver it themselves, through {@link Harness.armAudio},
  // because a cue point arms AFTER it has posed its board rather than before the
  // harness's opening reset.
  arm: { kind: "key", code: UNBOUND_KEY },
  // Cascade's menus are driven by a finger as well as a mouse and the keyboard
  // (`specs/controls.md`, Menu navigation), so the context reports a touchscreen:
  // a contact arrives as `pointerType: "touch"` and `navigator.maxTouchPoints` is
  // non-zero, which is the device a build offering touch controls has to believe
  // it is on.
  hasTouch: true,
  // Every text call carries the width the page measured for it and the alignment
  // in force, which is what {@link textDraws} turns into the run's span. Cascade
  // reads WHERE a label landed — `screens/hud-shows-mode-label` and
  // `presentation/hud-labels-drawn` hold a drawn run against a region — and an
  // anchor alone cannot answer that.
  measureText: true,
  // The state the build stood the game up in, read once before this harness's
  // opening `reset`. `specs/screens.md` says of the title screen that the game
  // "opens on" it, and `specs/instrumentation.md` has `reset` restore `screen` to
  // `"title"` as well — so without a reading taken first, a build that opened on
  // its table and reset correctly would read as one that opened on the title.
  // `screens/opens-on-title` is the point that needs it.
  readOpeningSnapshot: true,
  // A build installs its surface while its entry module runs, so a page that has
  // fired `load` has either installed it already or is not going to, and the wait
  // returns the instant the global appears — a conformant build pays none of this
  // ceiling however high it is set. What it bounds is the cost of a build that
  // installs its surface later than `load` and then never gets there, which every
  // harness of that build pays once. Fifteen seconds rather than five, because
  // five was set against a healthy machine and this is a deadline on the HOST.
  surfaceTimeoutMs: 15_000,
  projectRoot: dirname(fileURLToPath(import.meta.url)),
});

export const {
  fitViewport,
  failSurface,
  SURFACE_REQUIREMENT,
  seconds,
  TICK_HZ,
  TICK_MS,
} = kit;

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
 * How many frames one crossing of a SWEEP used to run, kept as the figure the
 * `cascade` group states.
 *
 * The shared harness samples a sweep's predicate every frame, so a sweep is a
 * crossing per frame and this no longer changes what a sweep costs. It stays
 * because the checks that pass it are naming the granularity their reading is
 * honest to — fifty milliseconds of game time, small against every span they end
 * on — and because dropping it would silently change what those checks say they
 * are doing. {@link UntilOptions.chunk} documents what became of it.
 */
export const SWEEP_CHUNK_FRAMES = framesFor(0.05);

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

/** How far a sweep may run. */
export interface UntilOptions {
  maxFrames?: number;
  /**
   * Kept for the checks that name it; it no longer changes what a sweep costs.
   *
   * The shared harness's sweep applies the predicate to every frame it runs, so
   * the frame a sweep reports is the frame the predicate first held on whatever
   * this says — which is the reading `cascade/floor-bounce-*` and
   * `cascade/no-side-bounce` are written against.
   */
  chunk?: number;
}

/** What a sweep found: whether the predicate ever held, and where it held. */
export interface UntilResult extends BaseUntilResult<CascadeSnapshot> {
  /**
   * That sample's frame, as {@link Harness.frame} counts them.
   *
   * The frame the predicate held on, which is where the harness now stands. A
   * check that names the frame an event happened on reads this rather than
   * `Harness.frame()`, so it goes on reading the same number it always did.
   */
  at: number;
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

/**
 * Everything a check reads off one page running this build.
 *
 * The shared harness's, with the four members Cascade's suites have their own
 * vocabulary for. Each is a THIN thing over the shared machinery and none of them
 * is a second frame-driving path:
 *
 *   - {@link Harness.pose} performs a run of surface calls in one crossing. It
 *     runs no frames, so nothing it does can disagree with the harness's clock.
 *   - {@link Harness.sample} and {@link Harness.until} are the shared harness's
 *     `stepWatching` and `until` under the names this project's suites use.
 *   - {@link Harness.skip} and {@link Harness.skipUntil} count in SECONDS of game
 *     time rather than in frames, and take the rate to spend them at, which is
 *     what {@link RUNOUT_HZ} exists for. They call the surface's own `advance`
 *     directly, so they close no recorded frame and a capture running across one
 *     keeps nothing of it.
 *
 * The members the shared harness carries for other cases — `step`, `stepUntil`,
 * `stepWatching`, `hold`, `holdFor`, `clickPointer`, `movePointer`, `lastCalls`,
 * `pixelRect`, `scanDevice`, `imagePixels`, `runUntil`, `loopingSounds` and
 * `loopStarts` — are not part of Cascade's vocabulary and are not offered here.
 * They still exist on the object; naming them in a check is the signal that the
 * check has reached past the readings this case's specification supports.
 */
export interface Harness extends Omit<
  BaseHarness<CascadeSnapshot, CascadeDebugApi>,
  "skip" | "skipUntil" | "until"
> {
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
  /**
   * Run `frames` frames one at a time and hand back the state each one left.
   *
   * `samples[0]` is the state after the first frame. The frames are the frames
   * {@link Harness.advance} runs, and the reading is the reading a per-frame
   * `advance` then `snapshot` pair takes.
   */
  sample(frames: number): Promise<CascadeSnapshot[]>;
  /** Advance until `predicate` holds, reading the state every frame left. */
  until(
    predicate: (snapshot: CascadeSnapshot) => boolean,
    options?: UntilOptions,
  ): Promise<UntilResult>;
  /**
   * Run `duration` seconds of game time WITHOUT opening a recorded frame.
   *
   * The same real update the loop runs, `hz` frames per second of it, but off
   * camera: no frame boundary is closed, so a capture running across it keeps
   * nothing, and a section that has to sit through nine seconds of a cascade
   * launching costs a replay nothing. Use it for the wait; use
   * {@link Harness.advance} for the part a check is about.
   *
   * The frames it runs are the surface's own and the harness does not count them,
   * so a check that reads {@link Harness.frame} reads the frames it DROVE. No cue
   * a skip produced is stamped either, which is why every audio point advances
   * rather than skips.
   */
  skip(duration: number, hz?: number): Promise<void>;
  /** {@link Harness.skip} until `predicate` holds, sampling every `pollSeconds`. */
  skipUntil(
    predicate: (snapshot: CascadeSnapshot) => boolean,
    options?: SkipOptions,
  ): Promise<SkipResult>;
  /** Give the build a real, browser-trusted gesture, so its audio can open. */
  armAudio(): Promise<void>;
}

/**
 * The shared harness as the package types it: what {@link captureReplay},
 * {@link captureStill} and {@link watchCues} take.
 *
 * Cascade's {@link Harness} narrows three members and hides a dozen more, so it
 * is not one of these by assignment even though it IS one at run time — the
 * object below is the package's own, with Cascade's members laid over it. The
 * cast is made HERE, once, so no check ever makes one.
 */
type PackageHarness = BaseHarness<CascadeSnapshot, CascadeDebugApi>;

/**
 * Open a page on the build and take the game off its own clock.
 *
 * The clock is built here rather than left to the package so that this module and
 * the package share ONE instance: a check that hands in a `SequenceClock` or a
 * `JitterClock` is asking for a particular series of deltas, and two instances of
 * it would deal that series out twice.
 */
export async function createHarness(
  options: HarnessOptions = {},
): Promise<Harness> {
  const clock = options.clock ?? new ConstantClock(TICK_MS);
  const base = await kit.createHarness({ ...options, clock });

  /** Run `duration` seconds of game time in `frames` frames, off camera. */
  const coast = async (
    duration: number,
    hz: number,
  ): Promise<CascadeSnapshot> => {
    await base.debug.advance(duration, Math.max(1, Math.ceil(duration * hz)));
    return base.snapshot();
  };

  return {
    ...base,

    async pose(calls) {
      if (base.surfaceFault !== null) failSurface(base.surfaceFault);
      if (calls.length === 0) return [];
      return base.page.evaluate(
        ([handle, ops]) => {
          const api = (
            window as unknown as Record<
              string,
              Record<string, (...a: unknown[]) => unknown>
            >
          )[handle];
          return ops.map((call) => api[call.op](...call.args));
        },
        [
          HANDLE,
          calls.map((call) => ({ op: call.op, args: [...call.args] })),
        ] as const,
      );
    },

    sample: (frames) => base.stepWatching(frames),

    async until(predicate, untilOptions = {}) {
      const opened = base.frame();
      const swept = await base.until(predicate, {
        maxFrames: untilOptions.maxFrames ?? framesFor(5),
        poll: 1,
      });
      return { ...swept, at: opened + swept.frames };
    },

    async skip(duration, hz = TICK_HZ) {
      await coast(duration, hz);
    },

    async skipUntil(predicate, skipOptions = {}) {
      const maxSeconds = skipOptions.maxSeconds ?? 60;
      const pollSeconds = Math.max(1e-3, skipOptions.pollSeconds ?? 0.5);
      const hz = skipOptions.hz ?? TICK_HZ;

      let snapshot = await base.snapshot();
      if (predicate(snapshot)) return { hit: true, elapsed: 0, snapshot };

      let elapsed = 0;
      while (elapsed < maxSeconds) {
        const step = Math.min(pollSeconds, maxSeconds - elapsed);
        snapshot = await coast(step, hz);
        elapsed += step;
        if (predicate(snapshot)) return { hit: true, elapsed, snapshot };
      }
      return { hit: false, elapsed, snapshot };
    },

    async armAudio() {
      // A GENUINE browser gesture, not a posed one: a build is free to open its
      // audio context from a real DOM event alone (both are conformant), so a
      // gesture delivered any other way would leave a perfectly good build
      // silent. `specs/controls.md` gives this key no binding, so the press
      // changes no game state, opens no overlay, and records no press for the
      // double-click rule, which a real pointer press would.
      await base.page.keyboard.press(UNBOUND_KEY);
    },
  };
}

/** The harness as the package's own writers take it. */
function packaged(h: Harness): PackageHarness {
  return h as unknown as PackageHarness;
}

/**
 * Record the frames `scenario` drives and keep them as the review item's
 * `outputId` output, handing back whatever the scenario returned.
 *
 * Wrap the drive, not the arrangement — the assertions stay where they were.
 */
export function captureReplay<T>(
  h: Harness,
  outputId: string,
  scenario: () => T | Promise<T>,
): Promise<T> {
  return kit.captureReplay(packaged(h), outputId, scenario);
}

/**
 * Keep the picture currently on the canvas as the review item's `outputId`
 * output.
 *
 * What is written is whatever the last frame that RAN left behind, so drive a
 * frame after the pose and call this BEFORE the assertions, so a check that fails
 * still leaves the picture that shows why.
 */
export function captureStill(h: Harness, outputId: string): Promise<void> {
  return kit.captureStill(packaged(h), outputId);
}

/**
 * Collect every sound the build emits from now on, each stamped with the frame of
 * the drive it sounded on.
 *
 * WHAT IS LOST HERE THAT AN ENGINE GIVES: the cue's NAME. There is no bus to ask,
 * so these checks confirm that a sound was emitted and on which frame, and a
 * reviewer decides by ear whether the ten cues are told apart. NO CHECK IN THIS
 * PROJECT MAY ASSERT A CUE NAME.
 *
 * A sound emitted inside {@link Harness.skip} is stamped by nothing, since a skip
 * closes no frame of its own: run the frames a cue check reads with
 * {@link Harness.advance}.
 */
export function watchCues(h: Harness): TimedCue[] {
  return kit.watchCues(packaged(h));
}

export type {
  Clock,
  DrawCall,
  HarnessOptions,
  Point,
  RecordedFrame,
  RecordedPathSegment,
  RecordedResource,
  RecordedState,
  Recording,
  Rgb,
  TextDraw,
  TimedCue,
  Viewport,
} from "./case-harness/index";

export {
  ConstantClock,
  JitterClock,
  SequenceClock,
  callsTo,
  closeWorkerBrowser,
  colorDistance,
  drawnText,
  drewText,
  luminance,
  mouseGlide,
  mousePress,
  mouseRelease,
  rectCenter,
  retable,
  setsOf,
  textDraws,
  thinReplay,
  touchGlide,
  touchPress,
  touchRelease,
  touchTap,
} from "./case-harness/index";

/**
 * The ground a replay of this case is composited over.
 *
 * The shared harness's default, under the name this project's own checks read it
 * by: `index.html` paints the page black and the build draws over it, so a
 * recording replayed on anything else shows a picture the build never made.
 */
export { DEFAULT_REPLAY_BACKGROUND as REPLAY_BACKGROUND } from "./case-harness/index";

/* -------------------------------------------------------------------------- */
/* Reading one frame's render                                                 */
/* -------------------------------------------------------------------------- */
//
// What a frame drew is the shared harness's reading — `drawnText`, `drewText`,
// `textDraws`, `callsTo` and `setsOf` are re-exported above and behave the same
// in every engineless project. The two below are Cascade's own: one reads a
// STANDALONE word rather than a substring, and the other reads the boxes of the
// shapes a frame painted, which is how the `table` group finds the cards without
// requiring the build to have drawn them as rectangles.

/**
 * Whether the frame drew `word` as a STANDALONE token, ignoring case.
 *
 * The stricter sibling of `drewText`, for the copy `specs/screens.md` requires as
 * a word rather than as a substring — the how-to screen's `ACE`, `KING`, `STOCK`
 * and `DOUBLE-CLICK`, which `HOWTO_TOKENS` holds. A screen reading "restocking"
 * contains `stock` and does not name the pile the specification named.
 */
export function drewWord(calls: readonly DrawCall[], word: string): boolean {
  const pattern = new RegExp(
    `(^|[^A-Za-z0-9])${word.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z0-9]|$)`,
    "i",
  );
  return drawnText(calls).some((drawn) => pattern.test(drawn));
}

/**
 * Walk a frame's operations, handing `visit` each one with the transform in
 * force at it.
 *
 * A build is free to draw under a transform — to translate to a pile and draw at
 * the origin, say — so the position a call names is only what it means once the
 * transform at that call is applied. The shared harness's own readings carry the
 * same walk; this one is here because {@link paintedBoxes} needs the callback and
 * the package's readings do not expose one.
 */
function walkTransforms(
  calls: readonly DrawCall[],
  visit: (call: DrawCall, m: Matrix) => void,
): void {
  const saved: Matrix[] = [];
  let current: Matrix = IDENTITY;
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
    } else {
      current = transformed(current, method, args) ?? current;
    }
    visit(call, current);
  }
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

/**
 * How far out the four neighbours of a colour sample sit, in logical units.
 *
 * A card is `100 x 140`, so a cluster this size sits well inside one wherever it
 * is sampled, and one stray anti-aliased edge, rounded corner or drop shadow
 * cannot swing the reading. Sample a card away from its own rank and suit glyphs
 * when the reading is meant to be of the card's ground rather than of its marks.
 */
const SAMPLE_RADIUS = 6;

/** The rendered colour at a logical point, averaged over that small cluster. */
export function sampleColor(h: Harness, x: number, y: number): Promise<Rgb> {
  return sampleCluster(h, x, y, SAMPLE_RADIUS);
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
      if (x !== null && y !== null) points.push(apply(m, x, y));
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
        points.push(apply(m, x, y), apply(m, x + w, y + height));
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
  const origin = apply(m, Math.min(x, x + w), Math.min(y, y + h));
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
 * Pose one of the other three screens, over an empty table.
 *
 * `openTable`'s siblings, built out of the same three atomic operations in the
 * same order: `reset()`, `setScreen(...)`, `clearTable()`
 * (`specs/instrumentation.md`).
 *
 * WHY `setScreen` RATHER THAN THE ROUTE A PLAYER TAKES. A check about what the
 * how-to screen draws, or about the key that leaves it, must not fail because the
 * title's `HOW TO PLAY` control is broken — `screens/title-how-to-opens` is the
 * item that grades that control. So a check poses the screen it is about directly,
 * and only a check whose subject IS a control presses one.
 *
 * WHY THE TABLE IS CLEARED. `specs/screens.md` lets the table show behind the
 * title and how-to screens, "dimmed or otherwise quieted", so what sits behind
 * the copy is the build's. Clearing it is the isolation rule: the world holds
 * only what the requirement concerns. It also fixes what a captured frame shows,
 * so two runs of the same check leave comparable evidence.
 *
 * NONE OF THEM ASSERTS A VERDICT. They arrange; the check decides.
 */
export async function openTitle(h: Harness): Promise<void> {
  await h.debug.reset();
  await h.debug.setScreen("title");
  await h.debug.clearTable();
}

/** The how-to screen, over an empty table. */
export async function openHowto(h: Harness): Promise<void> {
  await h.debug.reset();
  await h.debug.setScreen("howto");
  await h.debug.clearTable();
}

/**
 * The `won` screen, over an empty table, with nothing in flight and nothing
 * painted.
 *
 * `reset` already leaves all three of those (`specs/instrumentation.md`), so this
 * is {@link openTitle} with a different screen. It is the direct route to the one
 * requirement `specs/victory.md` states about the screen rather than about the
 * cascade: "A press anywhere, during the cascade or after it, deals a fresh game
 * and moves to the `playing` screen." A check whose subject IS the cascade wins
 * the game through {@link startCascade} instead.
 */
export async function openWon(h: Harness): Promise<void> {
  await h.debug.reset();
  await h.debug.setScreen("won");
  await h.debug.clearTable();
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
 * `handling/short-gesture-is-a-click` and
 * `handling/long-gesture-is-a-drop` are the items that grade the boundary. This
 * helper fixes neither side of it.
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

/* ---- The real mouse and the real finger ------------------------------------ */
//
// `mousePress`, `mouseGlide`, `mouseRelease`, `touchPress`, `touchGlide`,
// `touchRelease` and `touchTap` are the shared harness's and are re-exported
// above. Each drives one real Chromium event and then runs exactly one frame, so
// a check that counts frames can add them up, and a build that reads its input
// once per frame sees the press held while a frame runs. Use them where the
// subject is what a FRAME did with a player's input — every audio cue, the menus'
// pointer and touch points, and `handling/sweep-resolves-per-sample` — because a
// posed pointer resolves between frames and a cue is played on the frame its
// event happens (`specs/audio.md`).
//
// The one below is Cascade's, because no other case needs it.

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

/* -------------------------------------------------------------------------- */
/* The menus                                                                  */
/* -------------------------------------------------------------------------- */
//
// WHERE AN ITEM SITS IS THE BUILD'S, AND IS ASKED FOR RATHER THAN ASSUMED.
// `specs/controls.md` leaves each control's hit region to the build — "Each
// control occupies a rectangular hit region the build lays out" — and
// `specs/instrumentation.md` has the build report it through `menuItemRect`. So
// every gesture below is aimed at the middle of what the build answered with,
// which is what lets any layout pass and fails only a build that reports a region
// it does not answer on. NOTHING HERE IMPORTS A CONTROL RECTANGLE, and nothing
// may: `./constants.ts` fixes the ORDER of a screen's items and no position.
//
// EVERY GESTURE IS A REAL ONE. A mouse is a real Chromium mouse and a finger is a
// real Chromium touch contact, because the two menu rules the specification gives
// them are DIFFERENT — a mouse selects the item it moves onto, and a finger,
// which never hovers, selects the item it lands on — and a posed `pointerMove`
// through the surface is neither of them. The posed pointer stays what the table
// gestures use, where a press is a press whatever raised it.

/**
 * Press several keys so that all of their edges land on ONE frame, then run it.
 *
 * What the two ordering rules at the end of `specs/controls.md`'s keyboard section
 * are about: "When several edges arrive on one frame, `menu-up` is applied before
 * `menu-down`, and movement before `menu-confirm`." Every key goes down before the
 * frame runs and comes up after it, so a build reading press edges once a frame
 * sees all of them on that frame, and one comparing held state between frames sees
 * every one of them held across it.
 */
export async function pressKeysInOneFrame(
  h: Harness,
  codes: readonly string[],
): Promise<void> {
  for (const code of codes) await h.page.keyboard.down(code);
  await h.advance(1);
  for (const code of codes) await h.page.keyboard.up(code);
}

/**
 * The region the build reports for item `index` of the menu the current screen
 * shows.
 *
 * Fails the running check when the build answers `null`, because a scenario that
 * has to drive an item has nothing to say when the build will not say where the
 * item is. `navigation/menu-item-rect-reported` is the point that grades the read
 * itself, including the two answers that are legitimately `null`.
 */
export async function menuRect(h: Harness, index: number): Promise<MenuRect> {
  const screen = (await h.snapshot()).screen;
  const rect = await h.debug.menuItemRect(index);
  if (rect === null) {
    fail(
      `menuItemRect(${index}) to report a region for item ${index} of the ` +
        `menu the ${screen} screen shows (specs/instrumentation.md)`,
      "null, so the build reports no region for it",
    );
  }
  return rect;
}

/** The middle of that region: where a check aims its pointer or its finger. */
export async function menuPoint(h: Harness, index: number): Promise<Point> {
  return rectCenter(await menuRect(h, index));
}

/** Move the real mouse onto item `index`, and run the frame that reads it. */
export async function hoverItem(h: Harness, index: number): Promise<void> {
  const at = await menuPoint(h, index);
  await mouseGlide(h, at.x, at.y);
}

/**
 * Press and release the real mouse inside item `index`.
 *
 * Both edges land in one region, which is the gesture `specs/controls.md` says
 * activates that item.
 */
export async function clickItem(h: Harness, index: number): Promise<void> {
  const at = await menuPoint(h, index);
  await mousePress(h, at.x, at.y);
  await mouseRelease(h);
}

/**
 * Press the real mouse inside item `from`, carry it into item `to`, and release
 * it there.
 *
 * The two edges land in different regions, which `specs/controls.md` says
 * activates nothing.
 */
export async function dragBetweenItems(
  h: Harness,
  from: number,
  to: number,
): Promise<void> {
  const start = await menuPoint(h, from);
  const end = await menuPoint(h, to);
  await mousePress(h, start.x, start.y);
  await mouseGlide(h, end.x, end.y);
  await mouseRelease(h);
}

/** Land a real touch contact inside item `index`, and leave it down. */
export async function touchItem(h: Harness, index: number): Promise<void> {
  const at = await menuPoint(h, index);
  await touchPress(h, at.x, at.y);
}

/** Land a real touch contact inside item `index` and lift it there. */
export async function tapItem(h: Harness, index: number): Promise<void> {
  await touchItem(h, index);
  await touchRelease(h);
}

/**
 * Land a real touch contact inside item `from`, travel it onto item `to`, and
 * lift it there.
 */
export async function touchBetweenItems(
  h: Harness,
  from: number,
  to: number,
): Promise<void> {
  // BOTH POINTS ARE READ BEFORE THE FIRST CONTACT, as {@link dragBetweenItems}
  // reads them. The landing runs a frame, so a build that wrongly activated on
  // it has changed screen by the time the second region would be read, and
  // `menuItemRect` would then answer for a DIFFERENT screen's menu — the check
  // would still fail, but its message would name a region the gesture never
  // touched.
  const start = await menuPoint(h, from);
  const end = await menuPoint(h, to);
  await touchPress(h, start.x, start.y);
  await touchGlide(h, end.x, end.y);
  await touchRelease(h);
}

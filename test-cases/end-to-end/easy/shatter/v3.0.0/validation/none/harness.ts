// Shatter — the shared validator harness. CASE-PROVIDED, over the shared package.
//
// Every check in this project is an ordinary vitest test that drives the built
// site IN A REAL BROWSER. There is nothing to import: an engineless run seeds no
// `src/` at all, so the build wrote its own frame loop, its own canvas fit, its
// own keyboard, its own audio, its own debug overlay and its own
// `window.__shatter` — and the only place any of that exists is a page that has
// loaded the bundle. So the project serves `dist/`, loads it in Chromium, and
// reaches the game the way anything reaches it: over the surface
// `specs/instrumentation.md` told the build to install.
//
// AND NONE OF THAT MACHINERY IS SHATTER'S. Serving the build, holding one
// browser, bracketing each driven tick around one step of the surface, recording
// what the build drew and reading pixels and draw calls back out is what EVERY
// engineless case does, in the same shape — so it lives once, in
// `@test-cabinet/case-harness`, which the runner stages beside this project at
// `validation/case-harness/`. A fix landed there reaches Shatter; a copy of it
// here would drift from the day it was made, which is what this file used to be.
//
// THE SEAM IS ONE CALL. `createCaseHarness` takes the case's TYPES as type
// arguments and the case's VALUES as one object, and hands back the machinery
// with Shatter's names and Shatter's types on it — so the suites next door go on
// importing `createHarness`, `captureReplay` and `watchCues` from `../harness`
// exactly as they did, and none of them can tell the difference. What stays in
// this file is what is genuinely the case's: the handle, the operations
// `specs/instrumentation.md` requires, the snapshot and surface types, the tick
// arithmetic `specs/simulation.md` fixes, the readings over Shatter's own state,
// and every compound scenario.
//
// IT IS STILL A VITEST PROJECT, AND THAT IS DELIBERATE. The runner locates the
// build output before it chooses between the vitest and browser paths, so `dist/`
// is on disk by the time this project runs. Staying a vitest project is what lets
// the case name ONE script per review item and have it resolve under all three
// engines — `validation/waves/clears-on-last-rock.test.ts` is the same path
// whichever engine the run selected — and what keeps `format = 2` resolution
// passing.
//
// WHAT A CHECK READS. The game's own state (through `window.__shatter`'s
// `snapshot`), the ticks the harness itself drove, the operations the build issued
// against its 2D context, the pixels those operations left on the canvas, and the
// sounds the build emitted. Nothing here fabricates an outcome: the scenario
// helpers at the bottom of this file only ARRANGE the field through the surface,
// and the real tick the build wrote is what runs from there.
//
// THE HARNESS OWNS EVERY COMPOUND SEQUENCE. The debug surface is atomic by design
// — each operation sets one field, reads the state, or moves the clock
// (`guides/authoring/writing-debug-apis-and-validators.md`) — so "a live, quiet
// field at wave 6" is a helper here, built out of those atomic operations, and
// never an operation on the surface. A check that needs only part of a sequence
// calls the operations it needs: NOTHING A CHECK DOES NOT ASK FOR HAPPENS.
//
// AND THE HELPERS FIX GEOMETRY, NEVER THRESHOLDS. A helper poses a field, drives a
// scenario, or reads a value out of a snapshot. Every tolerance a check asserts —
// a percentage, a colour distance, a number of units — is stated in that check,
// next to the figure `specs/` fixes for it, because a helper that carried the
// tolerance would hide what the check is really asserting. Look for a threshold in
// this file and you will not find one. The figures that ARE here — a standoff, a
// muzzle speed, a tick count — are geometry: they say where a thing was put, not
// how far a build may miss by.
//
// A CLEARED WAVE IS SHOT DOWN, NEVER CLEARED. `specs/progression.md` makes a wave
// clear on the TICK THE LAST ROCK IS DESTROYED, and `clearRocks()` destroys
// nothing (`specs/instrumentation.md` says so in as many words). So every check
// whose requirement is the wave loop reaches its cleared field through
// {@link shootFieldDown}, which puts every round in through `addBullet` and the
// build's own collision and split code. `clearRocks` poses an EMPTY FIELD for a
// scenario that is not about the wave loop, and every such scenario runs with the
// wave gate shut, so the empty field raises nothing. A build that raises its next
// wave from the destruction event rather than from polling field emptiness is
// conformant, and no check in this project may punish it for that.
//
// THE CLOCK IS THE SURFACE'S. Nothing outside an engineless build owns its loop,
// so `specs/instrumentation.md` puts the clock on the surface: `setAutoStep(false)`
// takes the game off real time and `advance(ticks)` runs whole ticks. Shatter fixes
// the size of a tick itself — `specs/simulation.md` fixes `TICK_HZ` at `120` and
// `advance` counts in whole `TICK_DT`s — so the kit is built with `step` in its
// `"count"` shape and a `tickHz` of 120: a check asks for a number of ticks and
// gets exactly that number, with no polling, no waiting and no measurement of the
// machine it ran on. (The two engine-backed projects DO supply a clock,
// `ConstantClock(TICK_MS)`, because there the frame loop is the engine's and the
// engine has to be told what a frame is worth. Here the surface takes ticks, so a
// clock would have nothing to feed.) Every harness opens by taking the game off
// the clock. The one check that is ABOUT the loop running itself,
// `instrumentation/clock-is-held`, hands it back with {@link Harness.runFor}.
//
// ADVANCE VERSUS SKIP. Both run real ticks and neither fabricates anything; they
// differ in what they leave behind for a reviewer. {@link Harness.advance} brackets
// each tick as one recorded frame, so a captured section plays back at the rate the
// game ran at. {@link Harness.skip} runs the ticks in one call and closes no frame,
// for the march to a state nobody needs to watch — waiting out the eighteen seconds
// before the first saucer, running a torpedo's ten-second recharge down, settling a
// pose. A section that skipped its setup and advanced its subject yields a clip of
// the subject. `step` is `advance` answering the state the ticks left, for the
// sweeps that read it off the same crossing that ran them.
//
// EVERYTHING CROSSING INTO THE PAGE IS ASYNC. That is the whole of the difference
// between a suite here and its counterpart under an engine: `await h.snapshot()`
// rather than `h.snapshot()`, `await h.debug.setShipPosition(...)` rather than
// `h.debug.setShipPosition(...)`. The scenarios, the tolerances and the assertions
// are the same ones, because they are the case's rather than the runtime's.
//
// A MISSING SURFACE MUST NOT THROW FROM A HOOK. Every suite builds its harness in
// a `beforeEach`, so a throw there would bury the real verdict under a hook
// failure that names nothing. {@link createHarness} therefore never throws for a
// build's fault: a missing or incomplete surface comes back as
// {@link Harness.surfaceFault} over a stand-in whose every access fails BY
// ASSERTION at the moment a check first reaches for an operation. And a fault that
// is the HOST's — a browser that never started, a page that was never handed over,
// a file the loopback server never answered — leaves the running check undecided
// instead, because none of those learned anything about the build.
//
// ONE SERVER, ONE BROWSER, ONE PAGE PER HARNESS. `globalSetup.ts` starts the
// server and the browser once for the whole project; the package connects to them
// from inside each suite's worker and opens a page per harness, so every check
// drives a build that has just started and no check can be affected by what the
// one before it pressed, opened or muted.

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  RECORDER_GLOBAL,
  createCaseHarness,
  darkestOf,
  drawnText,
  touchGlide,
  touchPress,
  touchRelease,
  type DrawCall,
  type Harness as BaseHarness,
  type Rgb,
  type UntilOptions,
  type UntilResult as BaseUntilResult,
} from "./case-harness/index";
import { fail } from "./assert";
import {
  BULLET_R,
  FACE_UP,
  FIELD_H,
  FIELD_W,
  MUZZLE_SPEED,
  OVERLAY_KEY,
  ROCK_SIZES,
  SAFE_X,
  SAFE_Y,
  SAUCER_R,
  START_LIVES,
  STAR_X,
  STAR_Y,
  TICK_HZ,
  UNBOUND_KEY,
  type RockSize,
  type Screen,
} from "./constants";
import { normalize, wrap, type Vec } from "./geometry";
/* -------------------------------------------------------------------------- */
/* The contract the build owes                                                */
/* -------------------------------------------------------------------------- */

/** The handle an engineless build installs its surface on. */
export const HANDLE = "__shatter";

/** The version the surface reports (`SHATTER_DEBUG_VERSION`). */
export const SHATTER_DEBUG_VERSION = 1;

/**
 * Every operation `specs/instrumentation.md` requires on the surface of EVERY
 * variant, including the two clock operations that exist only under this engine,
 * in the order the specification states them.
 *
 * This is the case's list, not the build's: a build that installs a surface
 * missing one of these is held against the specification rather than against its
 * own idea of what it wrote. `instrumentation/surface-present` asserts
 * completeness by naming this one constant, so a build missing anything is named
 * for exactly what it is missing, and {@link Harness.surfaceFault} then makes
 * every other check that reaches for the surface fail with the same pair.
 */
export const REQUIRED_OPS = [
  // The clock (this engine alone).
  "setAutoStep",
  "advance",
  // The core.
  "reset",
  "snapshot",
  "menuItemRect",
  // The screen and the run.
  "setScreen",
  "setMenuIndex",
  "setScore",
  "setLives",
  "setWave",
  "setWaveBanner",
  // The world gates.
  "setWaveSpawning",
  "setSaucerSpawning",
  // The ship.
  "setShipPosition",
  "setShipVelocity",
  "setShipAngle",
  "setShipInvuln",
  "setFireCooldown",
  "setShipCollision",
  // The bullets.
  "addBullet",
  "removeBullet",
  "clearBullets",
  "addEnemyBullet",
  "removeEnemyBullet",
  "clearEnemyBullets",
  // The rocks.
  "addRock",
  "setRockVelocity",
  "removeRock",
  "clearRocks",
  // The saucer.
  "addSaucer",
  "setSaucerVelocity",
  "removeSaucer",
  "setSaucerMind",
  "setSaucerGun",
  "setSaucerTravel",
] as const;

/**
 * The operations only a `warhead` build carries: the rock's armor and the whole
 * torpedo.
 *
 * Kept apart from {@link REQUIRED_OPS} rather than folded into it, because a
 * `base` build is CORRECT to carry none of them — `specs/instrumentation.md`
 * states them under the variant — and `instrumentation/surface-present` runs on
 * both checklists. Only the `warhead` suites name this list, and only a `warhead`
 * checklist names those suites.
 */
export const WARHEAD_OPS = [
  "setRockHealth",
  "setTorpedoCharge",
  "addTorpedo",
  "setTorpedoHeading",
  "setTorpedoHoming",
  "removeTorpedo",
  "clearTorpedoes",
] as const;

/** The ship, as a snapshot reports it. `x`/`y` is its CENTRE. */
export interface ShipView {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Its facing, in radians. */
  angle: number;
  /** The magnitude of its velocity, built at the call. */
  speed: number;
  thrusting: boolean;
  /** The seconds of respawn grace left, `0` for none. */
  invuln: number;
  /** Whether its lethal contact test runs. */
  collision: boolean;
  /** Whole ticks until the gun may fire again. */
  fireCooldown: number;
}

/** One of the ship's bullets, or one of the saucer's, as a snapshot reports it. */
export interface ShotView {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** The seconds of its life that remain. */
  life: number;
}

/** One rock, as a snapshot reports it. `x`/`y` is its CENTRE. */
export interface RockView {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: RockSize;
  /** The collision radius its size fixes, built at the call. */
  radius: number;
  /** `warhead` only: the hits it has left. */
  health?: number;
}

/** The saucer, as a snapshot reports it, or `null` when none is up. */
export interface SaucerView {
  /** Fresh on each arrival; never reused while a live entity holds it. */
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Its steering decisions: the weave, and the turn away from the core. */
  mind: boolean;
  /** Its aimed shot. */
  gun: boolean;
  /** Its locomotion. */
  travel: boolean;
  /** Seconds until its next aimed shot; `SAUCER_FIRE_INTERVAL` on arrival. */
  fireClock: number;
  /** Seconds until it rerolls its weave; `SAUCER_WEAVE_INTERVAL` on arrival. */
  weaveClock: number;
  /** Seconds it has been on the field; `0` on arrival. */
  age: number;
}

/** One torpedo, as a `warhead` snapshot reports it. */
export interface TorpedoView {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Its heading, in radians. */
  heading: number;
  life: number;
  /** Whether its guidance runs. */
  homing: boolean;
}

/**
 * The state a snapshot reports, exactly as `specs/instrumentation.md` shapes it.
 *
 * Every field an operation can set is here, which is what makes every pose
 * verifiable by set-then-read — except `tickClock`, `nextId` and `rngState`, the
 * bookkeeping `reset` restores and `specs/instrumentation.md` deliberately keeps
 * out of the snapshot. `muted` is the exception in the other direction: no
 * operation sets it, and it is the game's copy of the runtime's own mute bit,
 * reached the way a player reaches it through `KeyM`.
 *
 * The four `warhead` fields are optional HERE and required THERE. A `base` build
 * that reports them is not wrong and a `base` check never reads them; a `warhead`
 * build that omits one fails `instrumentation/warhead-snapshot-shape`, the item of
 * the warhead checklist that decides the variant's half of the shape.
 */
export interface ShatterSnapshot {
  version: number;
  screen: Screen;
  /** The highlighted entry of whatever menu the screen shows, from `0`. */
  menuIndex: number;
  score: number;
  /** Ships left, INCLUDING the one in play, so a fresh game reports `3`. */
  lives: number;
  /** `0` before the first wave. */
  wave: number;
  /** Seconds left on the `WAVE N` banner, `0` when none is showing. */
  waveBanner: number;
  muted: boolean;
  /** Whether the game's own wave loop runs. */
  waveSpawning: boolean;
  /** Whether the game's own saucer arrival runs. */
  saucerSpawning: boolean;
  /** Seconds the current arrival cadence has run. */
  saucerClock: number;
  /** What `saucerClock` must reach for the next saucer to arrive, in seconds. */
  saucerDue: number;
  /** `none` only: whether the frame loop advances the simulation. */
  autoStep: boolean;
  ship: ShipView;
  bullets: ShotView[];
  rocks: RockView[];
  saucer: SaucerView | null;
  enemyBullets: ShotView[];
  /** `warhead` only. */
  torpedoes?: TorpedoView[];
  /** `warhead` only: the stored charge, `0` to `1`. */
  torpedoCharge?: number;
  /** `warhead` only: `true` exactly when the charge is `1`. */
  torpedoReady?: boolean;
  /** Accumulated simulation time, in seconds. */
  simTime: number;
}

/**
 * The operations a check poses the game through. Every one crosses into the page.
 *
 * The `warhead` operations are declared beside the common ones rather than in a
 * type of their own, so a `warhead` suite reaches them without a cast. A `base`
 * build carries none of them and no `base` suite calls one.
 */
/**
 * A menu entry's hit region, in logical field units, as `menuItemRect` reports it
 * (`specs/instrumentation.md`).
 *
 * `x` and `y` are the region's top-left corner. Where the regions ARE is the
 * build's own layout, which `specs/ui.md` leaves to it, so nothing in this
 * project compares one against a figure: a check reads a region to drive the
 * mouse or a contact at it, and grades what the menu does next.
 */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ShatterDebugApi {
  setAutoStep(enabled: boolean): Promise<void>;
  advance(ticks: number): Promise<void>;
  reset(options?: { seed?: number }): Promise<void>;
  snapshot(): Promise<ShatterSnapshot>;
  menuItemRect(index: number): Promise<Rect | null>;

  setScreen(screen: Screen): Promise<void>;
  setMenuIndex(index: number): Promise<void>;
  setScore(score: number): Promise<void>;
  setLives(lives: number): Promise<void>;
  setWave(wave: number): Promise<void>;
  setWaveBanner(seconds: number): Promise<void>;

  setWaveSpawning(enabled: boolean): Promise<void>;
  setSaucerSpawning(enabled: boolean): Promise<void>;

  setShipPosition(x: number, y: number): Promise<void>;
  setShipVelocity(vx: number, vy: number): Promise<void>;
  setShipAngle(radians: number): Promise<void>;
  setShipInvuln(seconds: number): Promise<void>;
  setFireCooldown(ticks: number): Promise<void>;
  setShipCollision(enabled: boolean): Promise<void>;

  addBullet(x: number, y: number, vx: number, vy: number): Promise<void>;
  removeBullet(id: number): Promise<void>;
  clearBullets(): Promise<void>;
  addEnemyBullet(x: number, y: number, vx: number, vy: number): Promise<void>;
  removeEnemyBullet(id: number): Promise<void>;
  clearEnemyBullets(): Promise<void>;

  addRock(size: RockSize, x: number, y: number): Promise<void>;
  setRockVelocity(id: number, vx: number, vy: number): Promise<void>;
  removeRock(id: number): Promise<void>;
  clearRocks(): Promise<void>;

  addSaucer(x: number, y: number): Promise<void>;
  setSaucerVelocity(vx: number, vy: number): Promise<void>;
  removeSaucer(): Promise<void>;
  setSaucerMind(enabled: boolean): Promise<void>;
  setSaucerGun(enabled: boolean): Promise<void>;
  setSaucerTravel(enabled: boolean): Promise<void>;

  /** `warhead` only. */
  setRockHealth(id: number, hp: number): Promise<void>;
  /** `warhead` only. */
  setTorpedoCharge(fraction: number): Promise<void>;
  /** `warhead` only. */
  addTorpedo(x: number, y: number, heading: number): Promise<void>;
  /** `warhead` only. */
  setTorpedoHeading(id: number, radians: number): Promise<void>;
  /** `warhead` only. */
  setTorpedoHoming(id: number, enabled: boolean): Promise<void>;
  /** `warhead` only. */
  removeTorpedo(id: number): Promise<void>;
  /** `warhead` only. */
  clearTorpedoes(): Promise<void>;
}

/* -------------------------------------------------------------------------- */
/* Ticks                                                                      */
/* -------------------------------------------------------------------------- */
//
// `specs/simulation.md` fixes the timestep at `TICK_HZ` (120) and `advance` counts
// in whole ticks, so a duration and a tick count convert exactly and a check that
// wants "a second and a half" asks for `ticksFor(1.5)` and gets 180 of them. There
// is no rounding for a check to explain and no schedule for this harness to choose.

/** Ticks of game time covering `seconds`. */
export function ticksFor(seconds: number): number {
  return Math.round(seconds * TICK_HZ);
}

/** The seconds of game time `ticks` ticks cover. */
export function secondsFor(ticks: number): number {
  return ticks / TICK_HZ;
}

/** A rate in units per second from a displacement measured over `ticks` ticks. */
export function speedOverTicks(delta: number, ticks: number): number {
  return (Math.abs(delta) * TICK_HZ) / ticks;
}

/* -------------------------------------------------------------------------- */
/* The harness, bound to this case                                            */
/* -------------------------------------------------------------------------- */

/**
 * The shared engineless harness, with Shatter's snapshot, Shatter's surface and
 * Shatter's figures bound into it.
 *
 * `projectRoot` comes from THIS module and must never come from the package's:
 * the package is staged one directory deeper than this file, and a produced
 * replay or still is addressed by the running suite's path relative to the
 * project root. Taken from the package it would address every output one level
 * too deep — and silently, because a writer that raised on a failed write would
 * be blaming the build for the host's problem, so neither of them raises.
 */
const kit = createCaseHarness<ShatterSnapshot, ShatterDebugApi>({
  slug: "shatter",
  handle: HANDLE,
  requiredOps: REQUIRED_OPS,
  // `advance(ticks)`: whole ticks of the build's own fixed length, because
  // `specs/simulation.md` fixes that length at `TICK_HZ` and the surface is never
  // told a duration.
  step: { kind: "count", op: "advance" },
  stage: { width: FIELD_W, height: FIELD_H },
  tickHz: TICK_HZ,
  // A GENUINE browser gesture, so the build's audio can open: `specs/audio.md`
  // says audio does not start until the player has interacted with the page, and
  // a build is free to open its context from a real DOM event alone, so a key
  // delivered any other way would leave a perfectly good build silent.
  // `specs/controls.md` leaves this key bound to nothing, so arming changes no
  // game state — and the gesture is delivered before the opening `reset`, which
  // restores every declared field, so nothing it could have moved survives.
  arm: { kind: "key", code: UNBOUND_KEY },
  // `specs/ui.md` has the menus take a finger as well as a mouse and the
  // keyboard, so the context reports a touchscreen: a contact arrives as
  // `pointerType: "touch"` and `navigator.maxTouchPoints` is non-zero, which is
  // the device a build offering touch controls has to believe it is on.
  hasTouch: true,
  // A `presentation` check reads WHERE a run of text sits — a readout clear of
  // the field, a menu entry's own extent — and a run's width follows from the
  // font the build chose, which only a context can answer. So each frame's text
  // calls are measured, in the page, under the build's own loaded fonts.
  measureText: true,
  // A pixel reading waits one animation frame before it reads.
  // `specs/instrumentation.md` has `advance` redraw the canvas, so on a
  // conforming build the picture is already the one the last tick left — but a
  // build that presents on its own frame instead has drawn the same state a
  // moment later, and waiting costs a sample nothing but a frame.
  awaitFrameBeforeRead: true,
  // A build installs its surface while its entry module runs, so a page that has
  // fired `load` has either installed it already or is not going to, and the wait
  // returns the instant the global appears — a conformant build pays none of this
  // ceiling however high it is set. FIFTEEN SECONDS RATHER THAN FIVE, because
  // this is a deadline on the HOST: the project holds several pages of one
  // browser open at once on a box that is also running a model's build, where a
  // crossing into a page costs 90 ms against 6 ms idle, and a build failed for
  // crossing a tight ceiling has been failed for the load average.
  surfaceTimeoutMs: 15_000,
  // The one page-side reading `specs/audio.md` needs that the package's probe does
  // not carry: see {@link stops}.
  extraInitScripts: ["audio-stops-init.js"],
  projectRoot: dirname(fileURLToPath(import.meta.url)),
});

export const {
  createHarness,
  captureReplay,
  captureStill,
  watchCues,
  fitViewport,
  SURFACE_REQUIREMENT,
} = kit;

/**
 * Fail the running check on a surface fault, beside what the specification
 * requires of the surface.
 *
 * Bound with an EXPLICIT type rather than destructured with the rest, because it
 * returns `never` and the compiler only reads a call as unreachable-after when the
 * name it is called through carries a declared type. Destructured, every helper
 * that ends `failSurface(...); return traced.read;` would be told its return may
 * be `undefined`.
 */
export const failSurface: (fault: string) => never = kit.failSurface;

/**
 * Everything a check reads off one page running this build.
 *
 * A bound alias of the shared harness's interface, so every
 * `import { type Harness } from "../harness"` next door goes on naming a harness
 * whose `snapshot()` is a {@link ShatterSnapshot} and whose `debug` is a
 * {@link ShatterDebugApi}.
 */
export type Harness = BaseHarness<ShatterSnapshot, ShatterDebugApi>;

/** What a sweep found: whether the predicate ever held, and where it stopped. */
export type UntilResult = BaseUntilResult<ShatterSnapshot>;

export type {
  DrawCall,
  HarnessOptions,
  Pixel,
  Recording,
  Rgb,
  TextDraw,
  TimedCue,
  UntilOptions,
  Viewport,
} from "./case-harness/index";

export { drawnText, touchGlide, touchPress, touchRelease };

export {
  closeWorkerBrowser,
  colorDistance,
  drawOps,
  drewText,
  luminance,
  sampleColor,
  textDraws,
} from "./case-harness/index";

/* -------------------------------------------------------------------------- */
/* The three readings that are Shatter's own                                  */
/* -------------------------------------------------------------------------- */
//
// Everything above is the package's. These three are not, and each is here for a
// stated reason rather than because it was easier: a batched pose, because half
// this project's cost is crossings into a page and a pose is two dozen calls; a
// present-only render, because a check about a SCREEN must not run the screen's
// own timers; and a stop count, because `specs/audio.md` makes `thrust` a HELD
// cue and the other end of a held cue is not a sound.

/**
 * One operation on the build's debug surface: the name `specs/instrumentation.md`
 * gives it, and the arguments it takes.
 *
 * What {@link batch} is handed. It is a name rather than a bound method because
 * the call has to survive being handed into the page as data.
 */
export type SurfaceCall = readonly [op: string, ...args: unknown[]];

/**
 * Run several of the build's surface operations in one crossing, in order, and
 * hand back what each one answered.
 *
 * THE SAME CALLS THE SAME WAY, and that is the whole of it: the same operation
 * names, the same arguments, in the same order, invoked on the same
 * `window.__shatter` the `debug` proxy invokes them on. What it removes is the
 * round trip between them, not a call. A build that carries no such operation
 * still throws on it, naming it, exactly as one call would.
 *
 * AND NOTHING RUNS IN THE GAP IT CLOSES. The harness holds the game off the wall
 * clock from the moment it is built, so no tick passes between two poses however
 * far apart in real time they land; batching them changes what a pose COSTS and
 * not what it does.
 *
 * IT EXISTS BECAUSE THE CROSSING IS THE COST. Every scenario in this project poses
 * a field before it measures one, and a pose is a dozen or two operations on the
 * surface; driven one crossing at a time, a suite spends more of its allowance on
 * round trips into the page than on the ticks it is grading. On a host this
 * project shares with a model's build, a crossing costs tens of milliseconds
 * rather than the two it costs on an idle one, and a check whose verdict turns on
 * how many of them it made is a check that grades the machine.
 */
export async function batch(
  h: Harness,
  calls: readonly SurfaceCall[],
): Promise<unknown[]> {
  if (h.surfaceFault !== null) failSurface(h.surfaceFault);
  if (calls.length === 0) return [];
  return h.page.evaluate(
    ([handle, list]) => {
      const target = (
        window as unknown as Record<
          string,
          Record<string, (...a: unknown[]) => unknown>
        >
      )[handle];
      if (target === undefined) {
        throw new Error(`shatter: window.${handle} is absent`);
      }
      const answered: unknown[] = [];
      for (const one of list) {
        const [name, ...args] = one as [string, ...unknown[]];
        const operation = target[name];
        if (typeof operation !== "function") {
          throw new Error(`shatter: window.${handle} carries no ${name}()`);
        }
        try {
          answered.push(operation.apply(target, args));
        } catch (error) {
          throw new Error(
            `shatter: window.${handle}.${name}() threw: ${String(error)}`,
          );
        }
      }
      return answered;
    },
    [HANDLE, calls as SurfaceCall[]] as const,
  );
}

/** How many animation frames a present-only render is bracketed across. */
const PRESENT_FRAMES = 3;

/**
 * Redraw without advancing, and hand back every operation that render issued.
 *
 * The frame boundary is the recorder's `raf` mode, which opens a frame on one
 * animation frame and closes it on the next — so THREE are waited for: one to
 * open, one for the loop's own present to draw into, and one to close it. Nothing
 * advances, and what comes back is the render the loop made of the state as it
 * stands. What a check about a SCREEN reads, where advancing a tick would run the
 * screen's own timers.
 */
export async function presentCalls(h: Harness): Promise<DrawCall[]> {
  const setMode = async (mode: string): Promise<void> => {
    await h.page.evaluate(
      ([rec, which]) =>
        (window as unknown as Record<string, { setMode(m: string): void }>)[
          rec
        ]?.setMode(which),
      [RECORDER_GLOBAL, mode] as const,
    );
  };
  await setMode("raf");
  try {
    await h.page.evaluate(
      (count) =>
        new Promise<void>((done) => {
          let left = count;
          const step = (): void => {
            left -= 1;
            if (left <= 0) done();
            else requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
        }),
      PRESENT_FRAMES,
    );
  } finally {
    await setMode("manual");
  }
  return h.lastCalls();
}

/**
 * Give the build a real, browser-trusted gesture, so its audio can open.
 *
 * `specs/audio.md` says audio does not start until the player has interacted with
 * the page, and a build is free to open its context from a real DOM event alone
 * — so a gesture delivered any other way would leave a perfectly good build
 * silent. The key is bound to nothing (`specs/controls.md`), so arming changes no
 * game state.
 *
 * DELIVERED WHERE THE CHECK ASKS FOR IT, rather than at the moment the harness is
 * built. The kit carries the same gesture as `HarnessOptions.armAudio`, which arms
 * before the opening `reset`; a cue check wants it after its own scenario is posed,
 * so the case keeps the gesture as a step a check takes.
 */
export async function armAudio(h: Harness): Promise<void> {
  await h.page.keyboard.press(UNBOUND_KEY);
}

/**
 * How many sounding voices the build has stopped since the page loaded.
 *
 * THE OTHER END OF A HELD CUE, READ THROUGH THE OTHER DOOR. `specs/audio.md` makes
 * `thrust` start on the tick thrust begins and stop within a tenth of a second of
 * its release, and a release makes no sound: what is observable is the voice being
 * told to stop. The shared probe counts what STARTS, because that is what every
 * case needs; this counts what stops, which is Shatter's own requirement, and
 * `audio-stops-init.js` installs it as an extra init script over the shared one.
 *
 * READ IT AS A DELTA ACROSS A WINDOW, never as an attribution to one tick. A
 * one-shot cue commonly schedules its own stop at the moment it plays, so a tick
 * that started a sound may well have stopped one too; and a key comes up between
 * two driven ticks, so a build that answers the release from its own DOM handler
 * stops its voice at a moment no tick accounts for. `specs/audio.md` fixes a
 * DEADLINE rather than a tick here, so the honest reading is the total across the
 * window the deadline allows.
 */
export async function stops(h: Harness): Promise<number> {
  return h.page.evaluate(
    () =>
      (
        window as unknown as { __shatterStops?: { stopped(): number } }
      ).__shatterStops?.stopped() ?? 0,
  );
}

/* -------------------------------------------------------------------------- */
/* Reading the canvas                                                         */
/* -------------------------------------------------------------------------- */
//
// A `presentation` item reads what the build actually PAINTED, because the look is
// the build's: `specs/overview.md` fixes no palette, no typeface and no geometry,
// only that a player reads the ship, the star, a rock, the saucer, a bullet and the
// HUD at a glance. So every colour comparison here is between two things the build
// drew, never against a hex value, and the DISTANCE it demands is the check's own
// figure, stated in the check. Nothing here fixes one.

/**
 * Whether the frame drew `word` as a STANDALONE token, ignoring case.
 *
 * The stricter sibling of the package's `drewText`, for the copy `specs/ui.md`
 * requires as a word rather than as a substring — the how-to screen's `SPACE`,
 * `ARROWS`, `WASD`, `ESC`, `P` and `M`. A screen reading "press the spacebar"
 * contains `space` and names no key the specification named. Read off the RAW
 * text calls rather than off the coalesced runs, because a token is a token
 * wherever the build chose to break its drawing.
 */
export function drewWord(calls: readonly DrawCall[], word: string): boolean {
  const pattern = new RegExp(
    `(^|[^A-Za-z0-9])${word.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z0-9]|$)`,
    "i",
  );
  return drawnText(calls).some((drawn) => pattern.test(drawn));
}

/**
 * Points a field posed by {@link startPlaying} leaves bare: on the field, clear of
 * the star's whole drawn extent (nothing of it is drawn beyond `1.5 x HALO_R`,
 * `specs/field.md`), clear of the safe point the ship sits at, clear of the upper
 * portion the HUD is drawn in, and spread across the field so no one readout,
 * banner or watermark a build chose to place can cover them all.
 */
export const BARE_POINTS: readonly Vec[] = [
  { x: 110, y: 430 },
  { x: 1170, y: 430 },
  { x: 110, y: 660 },
  { x: 1170, y: 660 },
  { x: 400, y: 690 },
];

/**
 * The bare field's colour: the darkest of {@link BARE_POINTS}, sampled off the
 * canvas as it stands.
 *
 * The darkest of several rather than one fixed patch, because `specs/overview.md`
 * makes the field dark and everything on it brighter, but leaves a build free to
 * put a banner, a hint or a watermark anywhere it likes — and a patch something is
 * drawn over reads lighter than one nothing is.
 */
export async function sampleField(h: Harness): Promise<Rgb> {
  return darkestOf(h, BARE_POINTS);
}
/* -------------------------------------------------------------------------- */
/* Reading a snapshot                                                         */
/* -------------------------------------------------------------------------- */
//
// Plain readings over the shape `specs/instrumentation.md` fixes. They compute
// nothing a check could not compute itself; they exist so that twenty suites spell
// the same lookup the same way, and so that A LOOKUP THAT FINDS NOTHING FAILS WITH
// THE ENTITY IT WANTED NAMED rather than as a `TypeError` two lines later. That is
// the rule fold-in fix D turned into policy: an entity a validator then reads is
// hard-asserted first, so a build that launched nothing fails the item about
// launching rather than crashing the script and being misreported as failing to
// expose the debug surface.

/** The rock with that id, or `undefined`. */
export function rockById(
  snapshot: ShatterSnapshot,
  id: number,
): RockView | undefined {
  return snapshot.rocks.find((rock) => rock.id === id);
}

/** The rock with that id, failing the check with the scenario it needed. */
export function requireRock(
  snapshot: ShatterSnapshot,
  id: number,
  scenario: string,
): RockView {
  const rock = rockById(snapshot, id);
  if (rock === undefined) {
    fail(
      `${scenario}: the rock ${id} still on the field`,
      `the rock roster holds ${JSON.stringify(snapshot.rocks.map((r) => r.id))}`,
    );
  }
  return rock;
}

/** The ship's bullet with that id, or `undefined`. */
export function bulletById(
  snapshot: ShatterSnapshot,
  id: number,
): ShotView | undefined {
  return snapshot.bullets.find((bullet) => bullet.id === id);
}

/** The ship's bullet with that id, failing the check with the scenario it needed. */
export function requireBullet(
  snapshot: ShatterSnapshot,
  id: number,
  scenario: string,
): ShotView {
  const bullet = bulletById(snapshot, id);
  if (bullet === undefined) {
    fail(
      `${scenario}: the bullet ${id} still in flight`,
      `the bullet roster holds ${JSON.stringify(snapshot.bullets.map((b) => b.id))}`,
    );
  }
  return bullet;
}

/** The saucer bullet with that id, or `undefined`. */
export function enemyBulletById(
  snapshot: ShatterSnapshot,
  id: number,
): ShotView | undefined {
  return snapshot.enemyBullets.find((bullet) => bullet.id === id);
}

/** The torpedo with that id, or `undefined`. `warhead` only. */
export function torpedoById(
  snapshot: ShatterSnapshot,
  id: number,
): TorpedoView | undefined {
  return snapshot.torpedoes?.find((torpedo) => torpedo.id === id);
}

/** The torpedo with that id, failing the check with the scenario it needed. */
export function requireTorpedo(
  snapshot: ShatterSnapshot,
  id: number,
  scenario: string,
): TorpedoView {
  const torpedo = torpedoById(snapshot, id);
  if (torpedo === undefined) {
    fail(
      `${scenario}: the torpedo ${id} still in flight`,
      `the torpedo roster holds ${JSON.stringify(
        (snapshot.torpedoes ?? []).map((t) => t.id),
      )}`,
    );
  }
  return torpedo;
}

/** The saucer, failing the check with the scenario it needed. */
export function requireSaucer(
  snapshot: ShatterSnapshot,
  scenario: string,
): SaucerView {
  const { saucer } = snapshot;
  if (saucer === null || saucer === undefined) {
    fail(`${scenario}: a saucer on the field`, "saucer was null");
  }
  return saucer;
}

/**
 * The last rock on the roster: the one an `addRock` just appended.
 *
 * `specs/instrumentation.md` fixes that an entity added through the surface is
 * appended to its roster, which is what makes its id findable with no assignment
 * scheme to guess at.
 */
export function lastRock(snapshot: ShatterSnapshot): RockView | undefined {
  return snapshot.rocks[snapshot.rocks.length - 1];
}

/** The last of the ship's bullets: the one an `addBullet` just appended. */
export function lastBullet(snapshot: ShatterSnapshot): ShotView | undefined {
  return snapshot.bullets[snapshot.bullets.length - 1];
}

/** The last saucer bullet: the one an `addEnemyBullet` just appended. */
export function lastEnemyBullet(
  snapshot: ShatterSnapshot,
): ShotView | undefined {
  return snapshot.enemyBullets[snapshot.enemyBullets.length - 1];
}

/** The last torpedo: the one an `addTorpedo` just appended. `warhead` only. */
export function lastTorpedo(
  snapshot: ShatterSnapshot,
): TorpedoView | undefined {
  const torpedoes = snapshot.torpedoes ?? [];
  return torpedoes[torpedoes.length - 1];
}

/** Every rock of one size, in roster order. */
export function rocksOfSize(
  snapshot: ShatterSnapshot,
  size: RockSize,
): RockView[] {
  return snapshot.rocks.filter((rock) => rock.size === size);
}

/**
 * The smallest rock on the field, ties broken by roster order.
 *
 * What {@link shootFieldDown} shoots at next: only destroying a Small takes a rock
 * off the field at all, so working from the smallest is what makes the field
 * actually empty rather than multiply.
 */
export function smallestRock(snapshot: ShatterSnapshot): RockView | undefined {
  let smallest: RockView | undefined;
  for (const rock of snapshot.rocks) {
    if (
      smallest === undefined ||
      ROCK_SIZES.indexOf(rock.size) > ROCK_SIZES.indexOf(smallest.size)
    ) {
      smallest = rock;
    }
  }
  return smallest;
}

/** The ship's velocity, as a vector. */
export function shipVelocity(snapshot: ShatterSnapshot): Vec {
  return { x: snapshot.ship.vx, y: snapshot.ship.vy };
}

/** An entity's centre, as a vector. */
export function centreOf(entity: { x: number; y: number }): Vec {
  return { x: entity.x, y: entity.y };
}

/** An entity's velocity, as a vector. */
export function velocityOf(entity: { vx: number; vy: number }): Vec {
  return { x: entity.vx, y: entity.vy };
}

/* -------------------------------------------------------------------------- */
/* Posing the field                                                           */
/* -------------------------------------------------------------------------- */
//
// EVERY COMPOUND SEQUENCE IN THIS PROJECT LIVES HERE. The debug surface is atomic —
// `specs/instrumentation.md` gives it one operation per field — so there is no
// `startGame`, no `spawnRock(size, options)` and no `setShip({...})` to reach for,
// and there must not be: a patch operation would impose the case's own state layout
// on the build. What a check wants instead is a helper, built out of those atomic
// operations, that poses the field and then lets the build's own tick run from
// there.
//
// A CHECK TAKES ONLY THE PART IT ASKS FOR. Nothing below does anything a caller did
// not ask for: {@link startPlaying} empties four rosters, shuts three gates and
// poses a screen, and a check that wants a rock asks for one.
//
// AND NONE OF THEM ASSERTS A VERDICT. A helper fails only when the game is not even
// in the situation the caller's scenario needs, and then with what it needed named.

/** Whether this build reports a torpedo roster, so it is a `warhead` build. */
const harnessCarriesTorpedoes = new WeakMap<Harness, boolean>();

/**
 * Whether the build under this harness carries the `warhead` torpedo.
 *
 * Read off the build's own snapshot — `specs/instrumentation.md` puts `torpedoes`
 * in the shape under the variant — and cached, because it cannot change while a
 * page lives. It is used for one thing only: {@link clearWorld} and
 * {@link startPlaying} touch the torpedo roster on a build that has one and leave a
 * `base` build alone, so one helper serves both checklists. NO CHECK SHOULD BRANCH
 * ON IT: a suite is named by a variant's checklist, so it already knows.
 */
export async function carriesTorpedoes(h: Harness): Promise<boolean> {
  const known = harnessCarriesTorpedoes.get(h);
  if (known !== undefined) return known;
  const snapshot = await h.snapshot();
  const carries = Array.isArray(snapshot.torpedoes);
  harnessCarriesTorpedoes.set(h, carries);
  return carries;
}

/**
 * Empty every roster on the field, one atomic clear per roster.
 *
 * `specs/instrumentation.md` deliberately carries no `clearField()`: emptying the
 * world arranges several things at once, which is the shape a debug API may not
 * have, so it is a sequence here instead. Each per-roster clear empties ONE roster
 * and leaves the others standing, which is what makes each of them separately
 * gradeable (`instrumentation/clear-rocks` and its four siblings).
 *
 * It destroys nothing. `clearRocks` makes room; it awards no score and takes no
 * rock off the field by destroying it, so a field this emptied has had no rock
 * destroyed and is a wave being PLAYED rather than a wave CLEARED
 * (`specs/progression.md`). A check whose requirement is the wave loop reaches its
 * cleared field through {@link shootFieldDown} instead.
 *
 * The five clears go over in ONE crossing ({@link Harness.batch}) rather than five:
 * the same five operations in the same order, with no tick able to run between them
 * either way, because the game is off the wall clock from the moment the harness is
 * built. {@link clearCalls} is what they are, so a longer pose can carry them
 * inside its own batch instead of paying for a second one.
 */
export async function clearWorld(h: Harness): Promise<void> {
  await batch(h, clearCalls(await carriesTorpedoes(h)));
}

/**
 * The clears {@link clearWorld} makes, as calls a caller can carry in its own
 * batch. `torpedoes` is {@link carriesTorpedoes} for the build in question.
 */
function clearCalls(torpedoes: boolean): SurfaceCall[] {
  const calls: SurfaceCall[] = [
    ["clearRocks"],
    ["clearBullets"],
    ["clearEnemyBullets"],
    ["removeSaucer"],
  ];
  if (torpedoes) calls.push(["clearTorpedoes"]);
  return calls;
}

/**
 * Pose an empty, quiet, live field at `wave`, ready for a scenario.
 *
 * The sequence, and why each part of it is here:
 *
 *   - EVERY ROSTER IS EMPTIED, through {@link clearWorld}. An empty field is safe
 *     because of the wave-clear rule (`specs/progression.md`): a wave clears on the
 *     tick the last rock is DESTROYED, so a field that never held one is being
 *     played rather than cleared. `waves/an-empty-field-does-not-clear-by-itself` is
 *     the item that grades that, and it is what makes every scenario below poseable.
 *   - THE TWO WORLD GATES ARE SHUT. Without `setWaveSpawning(false)` a build is
 *     entitled to notice the empty field, raise a banner and put five Large rocks
 *     into any scenario that runs for more than a moment; without
 *     `setSaucerSpawning(false)` any scenario running past eighteen seconds of game
 *     time is joined by a saucer that hunts and fires. Each gate is the GAME's own
 *     faculty rather than any entity's, which is why shutting it is not "parking an
 *     entity in a harmless corner" — the defence the guidance names as insufficient,
 *     and the one this replaces.
 *   - THE SHIP'S CONTACT GATE IS SHUT. The ship is the one entity no scenario can
 *     remove, so without `setShipCollision(false)` a rock a check poses near it
 *     costs a life and empties the field mid-scenario.
 *   - THE RUN IS AT ITS OPENING FIGURES, and the screen is live: `playing` with no
 *     banner running, so the field really is stepping.
 *   - THE SHIP IS AT THE SAFE POINT, at rest, facing up, with no grace and no
 *     cooldown, which is where a run and a respawn put it (`specs/ship.md`).
 *   - AND ON `warhead`, THE TORPEDO IS READY, which is where a new game puts it.
 *
 * THE ITEMS THAT TURN A GATE BACK ON ARE THE ITEMS WHOSE REQUIREMENT THE GATE IS —
 * every item in `waves`, `rocks/drift-speed-large` and
 * `instrumentation/wave-spawning-gate` for the wave loop; the saucer's own cadence
 * items and `audio/saucer-arrival-cue` for the arrival; every item in `lives` and
 * the four others `specs/collision.md` decides for the contact test. Any other check
 * that finds itself wanting one has almost always been mis-posed, and re-posing it
 * is the fix.
 *
 * It poses no rock, no bullet and no saucer: a check adds exactly what its
 * requirement concerns.
 *
 * THE WHOLE POSE IS ONE CROSSING. Eighteen atomic operations on a `base` build and
 * twenty on `warhead`, in the order above, handed over together
 * ({@link Harness.batch}) rather than one round trip into the page apiece. Nearly
 * every scenario in this project opens with this, so what it costs is paid a couple
 * of hundred times a run on a host that is also running a model's build; and since
 * the game is off the wall clock throughout, a build cannot tell the two apart.
 */
export async function startPlaying(
  h: Harness,
  options: { wave?: number } = {},
): Promise<void> {
  const torpedoes = await carriesTorpedoes(h);
  const calls: SurfaceCall[] = [
    ...clearCalls(torpedoes),
    ["setWaveSpawning", false],
    ["setSaucerSpawning", false],
    ["setShipCollision", false],
    ["setScreen", "playing"],
    ["setMenuIndex", 0],
    ["setScore", 0],
    ["setLives", START_LIVES],
    ["setWave", options.wave ?? 1],
    ["setWaveBanner", 0],
    ["setShipPosition", SAFE_X, SAFE_Y],
    ["setShipVelocity", 0, 0],
    ["setShipAngle", FACE_UP],
    ["setShipInvuln", 0],
    ["setFireCooldown", 0],
  ];
  if (torpedoes) calls.push(["setTorpedoCharge", 1]);
  await batch(h, calls);
}

/**
 * Open a game the way a player does: from a reset title, confirm the highlighted
 * first entry, `PLAY`.
 *
 * The route for a check about what a NEW GAME is — its lives, its wave, its score,
 * its opening rocks, its torpedo charge — none of which any pose can produce,
 * because `setWave` spawns nothing and `setScore` grants nothing. Nothing here is
 * posed: `reset` is the surface's own, and the rest is a real key through Chromium's
 * input pipeline.
 *
 * It leaves BOTH WORLD GATES ON, because `reset` restores them and this never calls
 * {@link startPlaying}. That is the game's own path rather than a widening of the
 * gate table: a check reaching a real opening wave this way is reaching it the way a
 * player does.
 */
export async function startGameFromTitle(
  h: Harness,
  options: { seed?: number } = {},
): Promise<void> {
  await h.debug.reset(options.seed === undefined ? undefined : options);
  await h.debug.setMenuIndex(0);
  await h.tap("Enter");
  await h.advance(1);
}

/**
 * Make one call on the surface and read the state it left, in one crossing.
 *
 * The `add*` operations answer nothing (`specs/instrumentation.md` gives them no
 * return), so a caller learns which body it just added by reading the roster back —
 * two round trips into the page for one pose, on every rock, bullet and saucer this
 * project stands up. {@link Harness.batch} makes it one, and the reading is the same
 * one: the build's own `snapshot`, taken after the same call, with nothing able to
 * run in between.
 */
async function poseAndRead(
  h: Harness,
  call: SurfaceCall,
): Promise<ShatterSnapshot> {
  const answered = await batch(h, [call, ["snapshot"]]);
  return answered[1] as ShatterSnapshot;
}

/**
 * Put one rock of `size` on the field, at rest unless a velocity is given, and hand
 * back its id.
 *
 * `addRock` places a rock AT REST (`specs/instrumentation.md`), so the pose is the
 * caller's alone and `setRockVelocity` is verifiable by set-then-read; this is the
 * two of them together, which is what almost every scenario wants. The id comes off
 * the roster's last entry, which is where the specification says an added entity
 * lands.
 */
export async function poseRock(
  h: Harness,
  size: RockSize,
  x: number,
  y: number,
  vx = 0,
  vy = 0,
): Promise<number> {
  const added = lastRock(await poseAndRead(h, ["addRock", size, x, y]));
  if (added === undefined) {
    fail(
      "addRock to append a rock to the roster (specs/instrumentation.md)",
      "the rock roster was still empty after addRock",
    );
  }
  await h.debug.setRockVelocity(added.id, vx, vy);
  return added.id;
}

/** Put one of the ship's bullets in flight and hand back its id. */
export async function poseBullet(
  h: Harness,
  x: number,
  y: number,
  vx: number,
  vy: number,
): Promise<number> {
  const added = lastBullet(await poseAndRead(h, ["addBullet", x, y, vx, vy]));
  if (added === undefined) {
    fail(
      "addBullet to append a bullet to the roster (specs/instrumentation.md)",
      "the bullet roster was still empty after addBullet",
    );
  }
  return added.id;
}

/** Put one saucer bullet in flight and hand back its id. */
export async function poseEnemyBullet(
  h: Harness,
  x: number,
  y: number,
  vx: number,
  vy: number,
): Promise<number> {
  const added = lastEnemyBullet(
    await poseAndRead(h, ["addEnemyBullet", x, y, vx, vy]),
  );
  if (added === undefined) {
    fail(
      "addEnemyBullet to append a bullet to the roster (specs/instrumentation.md)",
      "the enemy-bullet roster was still empty after addEnemyBullet",
    );
  }
  return added.id;
}

/** How a saucer is brought onto the field. */
export interface SaucerSpec {
  /** Its velocity. Defaults to what `addSaucer` gives it: right at `SAUCER_SPEED`. */
  vx?: number;
  vy?: number;
  /** Its steering decisions: the weave, and the turn away from the core. */
  mind?: boolean;
  /** Its aimed shot. */
  gun?: boolean;
  /** Its locomotion. Off, its centre holds and its mind and gun run on. */
  travel?: boolean;
}

/**
 * Bring one saucer onto the field, with whichever of its three faculties the caller
 * named, and hand back its id.
 *
 * THE THREE FACULTIES ARE WHAT MAKE A SAUCER SCENARIO READABLE, and the pairing is
 * the point (`specs/saucer.md` gives the saucer three separable ones). A check on
 * what it DECIDES poses `travel: false` and reads a velocity with no motion at all.
 * A check on how it TRAVELS poses `mind: false`, so a weave reroll cannot move the
 * reading. A check on its GUN poses `mind: false, travel: false` and reads shots
 * from a saucer standing still. And `saucer/avoids-the-core` poses `gun: false`, so
 * fifty-four crossings produce no bullets at all.
 */
export async function poseSaucer(
  h: Harness,
  x: number,
  y: number,
  spec: SaucerSpec = {},
): Promise<number> {
  const added = requireSaucer(
    await poseAndRead(h, ["addSaucer", x, y]),
    "addSaucer",
  );
  const faculties: SurfaceCall[] = [];
  if (spec.vx !== undefined || spec.vy !== undefined) {
    faculties.push([
      "setSaucerVelocity",
      spec.vx ?? added.vx,
      spec.vy ?? added.vy,
    ]);
  }
  if (spec.mind !== undefined) faculties.push(["setSaucerMind", spec.mind]);
  if (spec.gun !== undefined) faculties.push(["setSaucerGun", spec.gun]);
  if (spec.travel !== undefined)
    faculties.push(["setSaucerTravel", spec.travel]);
  await batch(h, faculties);
  return added.id;
}

/**
 * Put one torpedo in flight along `heading` and hand back its id. `warhead` only.
 *
 * `homing: false` is what makes `torpedo/flies-true-through-the-well` decidable:
 * with the guidance off, the only thing that could turn the torpedo is the well, so
 * a build that treats the star as an acquirable body cannot confound the reading.
 */
export async function poseTorpedo(
  h: Harness,
  x: number,
  y: number,
  heading: number,
  spec: { homing?: boolean } = {},
): Promise<number> {
  const added = lastTorpedo(
    await poseAndRead(h, ["addTorpedo", x, y, heading]),
  );
  if (added === undefined) {
    fail(
      "addTorpedo to append a torpedo to the roster (specs/instrumentation.md)",
      "the torpedo roster was still empty after addTorpedo",
    );
  }
  if (spec.homing !== undefined) {
    await h.debug.setTorpedoHoming(added.id, spec.homing);
  }
  return added.id;
}

/* ---- Shooting things down ------------------------------------------------- */

/** Anything a round can be aimed at: a centre, a velocity, and a radius. */
export interface Target {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}

/** The saucer as a {@link Target}, at the radius `specs/collision.md` fixes for it. */
export function saucerTarget(saucer: SaucerView): Target {
  return {
    x: saucer.x,
    y: saucer.y,
    vx: saucer.vx,
    vy: saucer.vy,
    radius: SAUCER_R,
  };
}

/**
 * How far outside a target's surface a round is placed, in logical units.
 *
 * Geometry, not a tolerance: it says where the round starts, not how far a build
 * may miss by. Small enough that the whole flight is a few ticks — at
 * `MUZZLE_SPEED` a Large's standoff is under a tenth of a second, over which the
 * well adds a couple of units per second to a round travelling at five hundred —
 * and large enough that the round begins clear of the body it is aimed at, so what
 * resolves the hit is the build's own collision pass rather than an overlap the
 * pose created.
 */
export const ROUND_STANDOFF = 4;

/** A round to place: a centre and a velocity, as `addBullet` takes them. */
export interface Round {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/**
 * The round that puts a bullet on `target`'s doorstep and fires it inward.
 *
 * THREE PROPERTIES, AND EACH IS THERE FOR A REASON A VALIDATOR ONCE PAID FOR:
 *
 *   - IT IS PLACED ON THE SIDE FACING AWAY FROM THE STAR. The whole flight is the
 *     standoff, travelling inward, so the round cannot be absorbed by the core on
 *     the way — which a round fired from the far side, across the star, routinely
 *     is (`specs/collision.md`: a bullet that reaches the core is absorbed).
 *   - IT CARRIES THE TARGET'S OWN VELOCITY as well as its own, so the closing
 *     velocity is exactly `speed` along the line between them and a Small drifting
 *     at up to 210 units per second is not missed.
 *   - IT IS AIMED AT THE CENTRE from just outside the surface, so the hit is the
 *     build's collision pass resolving a real approach.
 *
 * A target sitting exactly on the star's centre has no side facing away from it and
 * is given the `+x` one; nothing in this case poses one there, and a rock that
 * reached the core is recycled rather than left sitting in it.
 */
export function aimedRound(
  target: Target,
  speed = MUZZLE_SPEED,
  standoff = ROUND_STANDOFF,
): Round {
  const outward = normalize({ x: target.x - STAR_X, y: target.y - STAR_Y });
  const away = outward.x === 0 && outward.y === 0 ? { x: 1, y: 0 } : outward;
  const reach = target.radius + BULLET_R + standoff;
  const at = wrap({
    x: target.x + away.x * reach,
    y: target.y + away.y * reach,
  });
  return {
    x: at.x,
    y: at.y,
    vx: target.vx - away.x * speed,
    vy: target.vy - away.y * speed,
  };
}

/** Place an {@link aimedRound} at `target` and hand back the bullet's id. */
export async function fireAt(
  h: Harness,
  target: Target,
  speed = MUZZLE_SPEED,
  standoff = ROUND_STANDOFF,
): Promise<number> {
  const round = aimedRound(target, speed, standoff);
  return poseBullet(h, round.x, round.y, round.vx, round.vy);
}

/**
 * Run the real simulation until the bullet with that id is no longer in flight — it
 * struck something, it was absorbed by the core, or it expired — and report where
 * the game stood at that moment.
 *
 * Sampled every tick by default, because for most of these the tick the bullet
 * resolved on is what is read: the rock that came apart, the score the hit paid, the
 * banner the last kill raised.
 */
export function driveBullet(
  h: Harness,
  id: number,
  options: UntilOptions = {},
): Promise<UntilResult> {
  return h.until((snapshot) => bulletById(snapshot, id) === undefined, {
    maxTicks: options.maxTicks ?? ticksFor(1),
    poll: options.poll ?? 1,
  });
}

/**
 * Put one round on the rock's doorstep and run it until it resolves.
 *
 * The sequence a shot check runs over and over. Under `warhead` a Large takes three
 * of these before it comes apart, which is what {@link destroyRock} is for.
 */
export async function shootRock(
  h: Harness,
  rockId: number,
  options: UntilOptions = {},
): Promise<UntilResult> {
  const rock = requireRock(await h.snapshot(), rockId, "shootRock");
  const bullet = await fireAt(h, rock);
  return driveBullet(h, bullet, options);
}

/**
 * Shoot one rock until it is gone, however many hits its armor takes, and report
 * the rounds it took and where the game stood on the tick it came apart.
 *
 * `maxRounds` bounds a build whose bullets pass through rocks, so a broken build
 * fails with what the scenario needed named rather than hanging the suite.
 */
export async function destroyRock(
  h: Harness,
  rockId: number,
  options: { maxRounds?: number } & UntilOptions = {},
): Promise<{ rounds: number; result: UntilResult }> {
  const maxRounds = options.maxRounds ?? 8;
  for (let rounds = 1; rounds <= maxRounds; rounds += 1) {
    const result = await shootRock(h, rockId, options);
    if (rockById(result.snapshot, rockId) === undefined) {
      return { rounds, result };
    }
  }
  fail(
    `a rock destroyed by at most ${maxRounds} rounds on its doorstep (specs/collision.md)`,
    `rock ${rockId} was still on the field after ${maxRounds} rounds`,
  );
}

/**
 * Shoot the field down until it holds at most `leave` rocks and every one of them is
 * a Small, and report how many rounds it took.
 *
 * THE HELPER FOLD-IN FIX A EXISTS FOR. Every round goes in through `addBullet` and
 * the build's own collision and split code, so the field is emptied the way
 * `specs/progression.md` says a wave is cleared — by destroying rocks — and never
 * with `clearRocks`, which destroys nothing. A build that raises its next wave from
 * the destruction event rather than from polling field emptiness is conformant, and
 * this is what lets it pass.
 *
 * IT STOPS ON SMALLS AS WELL AS ON A COUNT. Destroying a Large leaves two Mediums
 * and destroying a Medium leaves two Smalls, so a count alone would stop with a
 * Large standing and a caller would find its "last rock" splits into two more. Only
 * destroying a Small takes a rock off the field, so `leave: 1` really does leave one
 * rock whose destruction ends the wave — which is exactly what
 * `waves/clears-on-last-rock` needs.
 *
 * `maxRounds` bounds a build whose rounds do not land: it fails with what the
 * scenario needed rather than looping forever. Clearing four Large rocks costs 28
 * rounds under `base` and 44 under `warhead`, so the default leaves a wide margin.
 */
export async function shootFieldDown(
  h: Harness,
  options: { leave?: number; maxRounds?: number } & UntilOptions = {},
): Promise<number> {
  const leave = options.leave ?? 0;
  const maxRounds = options.maxRounds ?? 400;
  let rounds = 0;
  for (;;) {
    const snapshot = await h.snapshot();
    const done =
      snapshot.rocks.length <= leave &&
      snapshot.rocks.every((rock) => rock.size === "small");
    if (done) return rounds;
    const target = smallestRock(snapshot);
    if (target === undefined) return rounds;
    if (rounds >= maxRounds) {
      fail(
        `a field that can be shot down to ${leave} rock(s) within ${maxRounds} rounds (specs/collision.md)`,
        `${rounds} rounds left ${snapshot.rocks.length} rocks standing`,
      );
    }
    await shootRock(h, target.id, options);
    rounds += 1;
  }
}

/** Show or hide the read-only debug overlay, through its fixed Backquote binding. */
export async function toggleOverlay(h: Harness): Promise<void> {
  await h.tap(OVERLAY_KEY);
}

/* -------------------------------------------------------------------------- */
/* The mouse and the touch contacts                                           */
/* -------------------------------------------------------------------------- */
//
// `specs/ui.md` has the menus take a mouse and touch over the regions the build
// lays out, and `specs/instrumentation.md` has the build report each region
// through `menuItemRect`. So a check here asks the build where its entry is, and
// then drives a REAL device at the middle of what it answered.
//
// WHY A REAL DEVICE. There is no operation that hovers, presses or taps, and
// there could not be: posing a pointer through the surface would tell the build
// where the mouse is without making its own input layer see a move, a press and
// a release arrive. Chromium's own mouse is what a player has, so it is what this
// project uses.
//
// EVERY GESTURE RUNS ITS OWN FRAME. The build reads its input once per tick, so a
// move that ran no tick would never reach it. Each helper below drives exactly
// one tick per edge, and a check counting ticks can add them up.
//
// THE MAPPING IS {@link Harness.css}: a logical field point taken through the
// same letterboxed fit the build draws under, in the CSS pixels a pointer event
// reports its position in.

/** The middle of the region the build reports for `index` on the current screen. */
export async function menuItemCentre(
  h: Harness,
  index: number,
): Promise<{ x: number; y: number }> {
  const rect = await h.debug.menuItemRect(index);
  if (rect === null) {
    fail(
      `a hit region for menu entry ${String(index)} on the screen showing it (specs/instrumentation.md)`,
      "menuItemRect answered null",
    );
  }
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/** Move the mouse to a logical field point, and run the tick that reads it. */
export async function pointerTo(
  h: Harness,
  x: number,
  y: number,
): Promise<void> {
  const at = h.css(x, y);
  await h.page.mouse.move(at.x, at.y);
  await h.advance(1);
}

/** Move the mouse onto the middle of entry `index`'s region. */
export async function pointerOntoItem(
  h: Harness,
  index: number,
): Promise<void> {
  const centre = await menuItemCentre(h, index);
  await pointerTo(h, centre.x, centre.y);
}

/** Press the mouse where it stands, and run the tick that reads it. */
export async function pointerDown(h: Harness): Promise<void> {
  await h.page.mouse.down();
  await h.advance(1);
}

/** Release the mouse where it stands, and run the tick that reads it. */
export async function pointerUp(h: Harness): Promise<void> {
  await h.page.mouse.up();
  await h.advance(1);
}

/**
 * Press and release the mouse inside entry `index`'s region: three driven ticks.
 *
 * The move, the press and the release each run their own tick, which is the
 * gesture a player makes and the one `specs/ui.md` describes.
 */
export async function clickItem(h: Harness, index: number): Promise<void> {
  await pointerOntoItem(h, index);
  await pointerDown(h);
  await pointerUp(h);
}

/**
 * Press inside `from`'s region, slide onto `to`'s, and release there.
 *
 * The two edges fall in different regions, so `specs/ui.md` confirms no entry —
 * the slide-off a player uses to change their mind mid-press.
 */
export async function dragBetweenItems(
  h: Harness,
  from: number,
  to: number,
): Promise<void> {
  await pointerOntoItem(h, from);
  await pointerDown(h);
  const target = await menuItemCentre(h, to);
  await pointerTo(h, target.x, target.y);
  await pointerUp(h);
}

/** Land a contact inside entry `index`'s region, without lifting it. */
export async function touchOntoItem(h: Harness, index: number): Promise<void> {
  const centre = await menuItemCentre(h, index);
  await touchPress(h, centre.x, centre.y);
}

/** Land a contact inside entry `index`'s region and lift it there: two ticks. */
export async function tapItem(h: Harness, index: number): Promise<void> {
  await touchOntoItem(h, index);
  await touchRelease(h);
}

/**
 * Land a contact inside `from`'s region, travel onto `to`'s, and lift it there.
 *
 * The landing and the lift fall in different regions, so `specs/ui.md` confirms
 * no entry.
 */
export async function touchBetweenItems(
  h: Harness,
  from: number,
  to: number,
): Promise<void> {
  await touchOntoItem(h, from);
  const target = await menuItemCentre(h, to);
  await touchGlide(h, target.x, target.y);
  await touchRelease(h);
}

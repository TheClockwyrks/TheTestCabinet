// Shatter — the shared validator harness. CASE-PROVIDED.
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
// `advance` counts in whole `TICK_DT`s — so this harness chooses no schedule and
// ships no clock of its own: a check asks for a number of ticks and gets exactly
// that number, with no polling, no waiting and no measurement of the machine it
// ran on. (The two engine-backed projects DO supply a clock, `ConstantClock(TICK_MS)`,
// because there the frame loop is the engine's and the engine has to be told what
// a frame is worth. Here the surface takes ticks, so a clock would have nothing to
// feed.) Every harness opens by taking the game off the clock. The one check that
// is ABOUT the loop running itself, `instrumentation/clock-is-held`, hands it back
// with {@link Harness.runFor}.
//
// ADVANCE VERSUS SKIP. Both run real ticks and neither fabricates anything; they
// differ in what they leave behind for a reviewer. {@link Harness.advance} brackets
// each tick as one recorded frame, so a captured section plays back at the rate the
// game ran at. {@link Harness.skip} runs the ticks in one call and closes no frame,
// for the march to a state nobody needs to watch — waiting out the eighteen seconds
// before the first saucer, running a torpedo's ten-second recharge down, settling a
// pose. A section that skipped its setup and advanced its subject yields a clip of
// the subject.
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
// ASSERTION at the moment a check first reaches for an operation.
//
// ONE SERVER, ONE BROWSER, ONE PAGE PER HARNESS. `globalSetup.ts` starts the
// server and the browser once for the whole project; this module connects to them
// from inside each suite's worker and opens a page per harness, so every check
// drives a build that has just started and no check can be affected by what the
// one before it pressed, opened or muted.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { expect, inject } from "vitest";
import type { Browser, BrowserContext, CDPSession, Page } from "playwright";
import { connectChromium } from "./chromium";
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
  TICK_MS,
  UNBOUND_KEY,
  type RockSize,
  type Screen,
} from "./constants";
import { normalize, shortestDelta, wrap, type Vec } from "./geometry";

declare module "vitest" {
  export interface ProvidedContext {
    /** Where the built site is served, from `globalSetup.ts`. */
    shatterUrl: string;
    /** The one Chromium every suite worker connects to. */
    shatterBrowserWs: string;
  }
}

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
 * build that omits one fails `instrumentation/snapshot-shape`, which is the item
 * that decides the shape.
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
       * context's own units and the alignment in force, both read off the context
       * at the call. Only that context can say how wide a run is: the width
       * follows from the font, the letter spacing and the direction, none of which
       * the call itself carries. {@link textDraws} turns the pair into the run's
       * span.
       */
      width?: number;
      textAlign?: string;
    }
  | { kind: "set"; property: string; value: unknown };

/** A sound the build emitted, and the tick of the drive it emitted it on. */
export interface TimedCue {
  /** The tick it sounded on, 1-based, as {@link Harness.tick} reports. */
  tick: number;
  /** The simulation time at that tick, in milliseconds. */
  t: number;
}

/** How the field is mapped onto the canvas: one uniform scale and a letterbox. */
export interface Viewport {
  width: number;
  height: number;
  scale: number;
  offsetX: number;
  offsetY: number;
}

export interface HarnessOptions {
  /** The window's CSS width. Defaults to the logical field width. */
  cssWidth?: number;
  /** The window's CSS height. Defaults to the logical field height. */
  cssHeight?: number;
  /** Device pixels per CSS pixel. Defaults to 1, so one device pixel is one unit. */
  dpr?: number;
  /**
   * Whether the page reports a touchscreen.
   *
   * Opt-in per check, and off by default, because it changes the device a build
   * believes it is running on: every check that is not about touch keeps exactly
   * the context the rest of this project's evidence was recorded against. A touch
   * gesture driven on a page without one throws rather than quietly arriving as a
   * mouse, so `touch/*` asks for it and nothing else does.
   */
  touch?: boolean;
}

/** How far a sweep may run, and how many ticks separate two samples. */
export interface UntilOptions {
  maxTicks?: number;
  poll?: number;
}

/** What a sweep found: whether the predicate ever held, and where it stopped. */
export interface UntilResult {
  hit: boolean;
  /** Ticks advanced before the sample that ended the sweep. */
  ticks: number;
  snapshot: ShatterSnapshot;
}

/**
 * One operation on the build's debug surface: the name `specs/instrumentation.md`
 * gives it, and the arguments it takes.
 *
 * What {@link Harness.batch} is handed. It is a name rather than a bound method
 * because the call has to survive being handed into the page as data.
 */
export type SurfaceCall = readonly [op: string, ...args: unknown[]];

/** A device pixel, as `[r, g, b, a]`. */
export type Pixel = [number, number, number, number];

export interface Harness {
  /** The page the build is running in. For a check that needs Playwright itself. */
  readonly page: Page;
  /**
   * The surface the BUILD installed, as operations that cross into the page.
   *
   * Read off `window.__shatter` and never constructed here — see
   * {@link unexposedSurface}.
   */
  readonly debug: ShatterDebugApi;
  /**
   * Why the build's surface cannot be driven, or `null` when it can.
   *
   * A fault here is the build's: the surface is missing, or it is missing an
   * operation `specs/instrumentation.md` requires. It says what was FOUND
   * (`window.__shatter was still absent 300 rendered frames after the page
   * loaded`), and {@link failSurface} pairs it with what the specification
   * REQUIRES. Every operation fails by assertion with that pair rather than
   * throwing, so a missing surface lands as the verdict of every item that
   * reaches for it — and, crucially, a harness built in a `beforeEach` still
   * comes back, so the fault is reported by the check rather than buried in a
   * hook.
   */
  readonly surfaceFault: string | null;
  /** Everything the page logged to `console.error`, or threw, oldest first. */
  readonly pageErrors: string[];

  /** The ticks this harness has driven, 1-based, as a recorded frame counts them. */
  tick(): number;
  /** The simulation time those ticks covered, in milliseconds. */
  timeMs(): number;

  /** A fresh read of the game's state through the build's `snapshot`. */
  snapshot(): Promise<ShatterSnapshot>;
  /**
   * Run several of the build's surface operations in one crossing, in order, and
   * hand back what each one answered.
   *
   * THE SAME CALLS THE SAME WAY, and that is the whole of it: the same operation
   * names, the same arguments, in the same order, invoked on the same
   * `window.__shatter` the {@link debug} proxy invokes them on. What it removes is
   * the round trip between them, not a call. A build that carries no such
   * operation still throws on it, naming it, exactly as one call would.
   *
   * AND NOTHING RUNS IN THE GAP IT CLOSES. The harness holds the game off the wall
   * clock from the moment it is built, so no tick passes between two poses however
   * far apart in real time they land; batching them changes what a pose COSTS and
   * not what it does.
   *
   * IT EXISTS BECAUSE THE CROSSING IS THE COST. Every scenario in this project
   * poses a field before it measures one, and a pose is a dozen or two operations
   * on the surface; driven one crossing at a time, a suite spends more of its
   * allowance on round trips into the page than on the ticks it is grading. On a
   * host this project shares with a model's build, a crossing costs tens of
   * milliseconds rather than the two it costs on an idle one, and a check whose
   * verdict turns on how many of them it made is a check that grades the machine.
   */
  batch(calls: readonly SurfaceCall[]): Promise<unknown[]>;
  /**
   * Run `ticks` real ticks, each closed as one recorded frame.
   *
   * What a captured section is made of. Use it for the part of a scenario a
   * reviewer should watch, and {@link skip} for the march that got there.
   * `advance(0)` runs nothing; a check that is ABOUT `advance(0)` calls the
   * surface's own operation instead.
   *
   * IT ANSWERS THE STATE THE TICKS LEFT, read inside the same crossing that ran
   * them. A sweep that steps a tick and then reads it is the shape half this
   * project is written in, and taking the reading off the return rather than
   * calling {@link snapshot} after it is the same reading for half the crossings
   * — which, on a host where a crossing costs a tenth of a second, is the
   * difference between a check that fits its allowance and one that does not. A
   * caller with no use for it ignores it.
   */
  advance(ticks: number): Promise<ShatterSnapshot>;
  /**
   * Run `ticks` real ticks in one call, closing no recorded frame.
   *
   * The same simulation as {@link advance} — the ticks are the build's own and
   * nothing is fabricated — and the same cost to the game.
   * `specs/instrumentation.md` has `advance(n)` run `n` whole ticks "immediately
   * and in order", so a batch and a run of singles reach the same state. What it
   * saves is a capture's budget and a crossing per tick.
   *
   * Like {@link advance}, it answers the state the ticks left, read inside the
   * same crossing.
   */
  skip(ticks: number): Promise<ShatterSnapshot>;
  /** Advance until `predicate` holds, sampling every `poll` ticks. */
  until(
    predicate: (snapshot: ShatterSnapshot) => boolean,
    options?: UntilOptions,
  ): Promise<UntilResult>;
  /** The same sweep on {@link skip}: a march to a state, filmed by nothing. */
  skipUntil(
    predicate: (snapshot: ShatterSnapshot) => boolean,
    options?: UntilOptions,
  ): Promise<UntilResult>;
  /** Hand the game back to its own frame loop for `ms` of real time, then take it back. */
  runFor(ms: number): Promise<void>;

  /** Press a key and leave it down, as a player holding it would. */
  hold(code: string): Promise<void>;
  /** Release a key held by {@link hold}. */
  release(code: string): Promise<void>;
  /**
   * Press a key, run the one tick that delivers it, and release it.
   *
   * A press that ran no tick would never reach the game, and a press released
   * before a tick ran would be invisible to a build that reads its keyboard by
   * comparing held state at the top of each tick — so the tick goes between the
   * two. `specs/controls.md` reads confirming, leaving, pausing and muting as
   * press edges, which is exactly what this delivers. Exactly one tick passes
   * either way, so nothing a caller counts moves.
   */
  tap(code: string): Promise<void>;
  /** Hold one or more keys down for `ticks` ticks, then release them all. */
  holdFor(codes: string | readonly string[], ticks: number): Promise<void>;

  /** Run exactly one tick and hand back every operation its render issued. */
  frameCalls(): Promise<DrawCall[]>;
  /** Redraw without advancing, and hand back every operation that render issued. */
  presentCalls(): Promise<DrawCall[]>;
  /** Reflect the surface without invoking it: `typeof` for each name, and the version. */
  probe(
    names: readonly string[],
  ): Promise<{ version: unknown; ops: Record<string, string> }>;

  /** How the field is mapped onto this harness's canvas. */
  viewport(): Viewport;
  /** Where a logical point lands in the canvas's backing store. */
  device(x: number, y: number): { x: number; y: number };
  /** Where a logical point lands in CSS pixels, for a real pointer. */
  css(x: number, y: number): { x: number; y: number };
  /** The device pixel under a logical point. */
  pixel(x: number, y: number): Promise<Pixel>;
  /** Many logical points at once, in one crossing into the page. */
  pixels(points: readonly { x: number; y: number }[]): Promise<Pixel[]>;
  /** A pixel addressed in the canvas's own backing store, past the fit. */
  devicePixel(x: number, y: number): Promise<Pixel>;
  /**
   * The channel-mean brightness of every device pixel along one line of the
   * backing store, addressed past the fit.
   *
   * One crossing into the page for the whole line, because a check that has to
   * find WHERE the build drew something reads thousands of pixels rather than a
   * handful, and a crossing each would cost more than the frame it is reading.
   */
  scanDevice(axis: "row" | "column", index: number): Promise<number[]>;
  /** The canvas's backing store size, as the build sized it. */
  surface(): Promise<{ width: number; height: number; dpr: number }>;

  /** Give the build a real, browser-trusted gesture, so its audio can open. */
  armAudio(): Promise<void>;
  /** How many sounds the build has emitted since the page loaded, in total. */
  sounds(): Promise<number>;
  /** How many sounding voices the build has stopped since the page loaded. */
  stops(): Promise<number>;

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
 * the page renders, not in seconds of this machine's time. An engineless Shatter
 * build seeds no art and declares no assets, so a conformant build installs its
 * surface while its own entry module evaluates — before
 * `page.goto(waitUntil: "load")` has even returned — and is found on the first
 * poll. The grace below is for a build that finishes initializing asynchronously,
 * and three hundred frames is five seconds of a page rendering at an ordinary
 * rate.
 *
 * WHY NOT A NUMBER OF SECONDS, WHICH IS WHAT THIS USED TO BE. A wall-clock
 * deadline here does not measure the build at all. Playwright polls this
 * predicate once per animation frame, so on a host with nothing left to give BOTH
 * the build's script and the poll that looks for its surface are starved
 * together — and a fifteen-second ceiling then reported "this build installs no
 * debug surface" against a build whose surface was there all along. That verdict
 * is not one point: `surfaceFault` makes EVERY operation of the surface fail by
 * assertion, so the whole checklist is lost to how busy the machine was. Counted
 * in frames, the deadline stretches with the host exactly as the build does: a
 * page given a tenth of a core renders a tenth of the frames per second and gets
 * the same three hundred frames to install its surface in.
 *
 * WHAT IT STILL CATCHES, which is the distinction worth keeping. A build that
 * never installs a surface renders its three hundred frames and is reported —
 * promptly, on a quiet host in about five seconds — as exactly that. Nothing here
 * softens the real defect; what changed is that a slow page is no longer mistaken
 * for one.
 */
const SURFACE_GRACE_FRAMES = 300;

/**
 * The wall-clock ceiling on any one crossing into the page.
 *
 * NOT A DEADLINE ANY READING RESTS ON. A ceiling exists because a page that has
 * wedged must cost a check this much and no more; it is drawn where no loaded
 * host reaches it, so that what ends a wait is the thing being waited for. Two
 * minutes: the navigation this harness makes is a static bundle off a loopback
 * server, the longest crossing any check makes is a sweep of a few thousand ticks
 * run inside the page, and the frame-counted waits below reach their
 * {@link SURFACE_GRACE_FRAMES} long inside two minutes however loaded the host
 * is. It sits well under this project's own `testTimeout` of five minutes, so a
 * genuinely wedged page still reports as a crossed ceiling rather than as a
 * killed suite.
 *
 * WHAT IT REPLACES. Playwright's own default is thirty seconds on every crossing
 * — a navigation, a key press, a click, a `page.evaluate` driving ticks — and
 * thirty seconds is generous on an idle host and crossed by a page load on one
 * running many times its own number of cores. What a crossed deadline costs is
 * not a point but a check: the harness throws inside `beforeEach`, and the
 * verdict that reaches the reviewer names nothing the build did.
 */
const PAGE_CEILING_MS = 120_000;

let browserPromise: Promise<Browser> | null = null;

async function sharedBrowser(): Promise<Browser> {
  browserPromise ??= connectChromium(inject("shatterBrowserWs"));
  return browserPromise;
}

/**
 * One browser context per WINDOW SHAPE, shared by every harness of that shape in
 * this file, and one PAGE per harness inside it.
 *
 * The split is what the init scripts force and what correctness wants. The
 * recorder and the audio probe are installed on the CONTEXT, so every page it
 * opens is instrumented before a line of the build's script runs, and a context is
 * also where the viewport and the device pixel ratio are fixed — which is the one
 * thing `field/field-fit` varies. Everything else about a harness is the page: a
 * fresh one opens on a build that has just started, with no key held, no audio
 * context opened, and the mute preference back off, which is a stronger guarantee
 * than any reset the surface offers, since `reset()` deliberately leaves muting
 * alone.
 *
 * A page per harness rather than one reused between them, because a check may
 * legitimately hold two harnesses at once — `instrumentation/reset-seeds-randomness`
 * compares two runs of the same seed — and a harness whose page had been taken over
 * by a later one would read someone else's game while looking exactly like it
 * worked.
 */
const contexts = new Map<string, BrowserContext>();

/** Every page this worker opened, so none is left behind in the shared browser. */
const openPages = new Set<Page>();

function shapeKey(
  cssWidth: number,
  cssHeight: number,
  dpr: number,
  hasTouch: boolean,
): string {
  return `${cssWidth}x${cssHeight}@${dpr}${hasTouch ? "+touch" : ""}`;
}

/** The context for a window of this shape, opened and instrumented on demand. */
async function contextFor(
  cssWidth: number,
  cssHeight: number,
  dpr: number,
  hasTouch: boolean,
): Promise<BrowserContext> {
  const key = shapeKey(cssWidth, cssHeight, dpr, hasTouch);
  const existing = contexts.get(key);
  if (existing !== undefined) return existing;

  const browser = await sharedBrowser();
  const context = await browser.newContext({
    viewport: { width: cssWidth, height: cssHeight },
    deviceScaleFactor: dpr,
    hasTouch,
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
 * A proxy rather than a hand-written stub, because the surface is not one closed
 * list — the `warhead` variant adds seven operations — and a stub written against
 * the common surface would report a `warhead`-only operation as merely absent
 * rather than as the consequence of the build's missing install.
 *
 * Keys that belong to the MACHINERY rather than to a check are answered with
 * `undefined` instead: awaiting a value probes `then`, and vitest's own error
 * formatting probes symbols and `constructor`. Failing those would replace the
 * verdict below with noise from the machinery that was trying to report it.
 */
function unexposedSurface(reason: string): ShatterDebugApi {
  return new Proxy({} as ShatterDebugApi, {
    get: (_target, property): unknown => {
      if (typeof property === "symbol") return undefined;
      if (property === "then" || property === "constructor") return undefined;
      return () => failSurface(reason);
    },
  });
}

/**
 * What `specs/instrumentation.md` requires of the surface: the `Expected:` line of
 * the failure a build with no usable surface lands on every check that reaches for
 * it, beside the {@link Harness.surfaceFault} that says what was found.
 */
export const SURFACE_REQUIREMENT =
  `a usable debug and automation surface on window.${HANDLE} as soon as the ` +
  `game has initialized, carrying every operation specs/instrumentation.md ` +
  `requires`;

/**
 * Fail the running check on `fault`, the harness's account of what is wrong with
 * the build's surface, paired with what the specification requires.
 */
export function failSurface(fault: string): never {
  return fail(SURFACE_REQUIREMENT, fault);
}

/**
 * What a frame-counted wait is waiting for: the two things a page installs that a
 * harness cannot begin without.
 *
 * `"surface"` is the build's own `window.__shatter`. `"recorder"` is the injected
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
): Promise<boolean> {
  try {
    const found = await page.waitForFunction(
      ([kind, handle, grace]) => {
        const scope = window as unknown as Record<string, unknown>;
        const there =
          kind === "surface"
            ? typeof scope[handle] === "object" && scope[handle] !== null
            : (
                scope.__shatterRec as { ready(): boolean } | undefined
              )?.ready() === true;
        if (there) return "there";
        const key = `__shatterWaited_${kind}`;
        const seen = ((scope[key] as number | undefined) ?? 0) + 1;
        scope[key] = seen;
        // Neither `null` nor `false` ends a `waitForFunction`, so a frame that
        // has not answered yet returns one of them and the poll comes round
        // again on the next frame; only the two strings end the wait.
        return seen >= grace ? "never" : null;
      },
      [arrival, HANDLE, SURFACE_GRACE_FRAMES] as const,
      { timeout: PAGE_CEILING_MS },
    );
    return (await found.jsonValue()) === "there";
  } catch {
    return false;
  }
}

/**
 * What is wrong with the surface this page installed, or `null` when nothing is:
 * the surface never appeared, or it appeared without an operation the
 * specification requires of every variant.
 */
async function readSurfaceFault(page: Page): Promise<string | null> {
  if (!(await waitInPageFrames(page, "surface"))) {
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
 * The default shape is the field's own size at one device pixel per CSS pixel, so
 * a logical coordinate and a canvas pixel are the same thing and no check but
 * `field/field-fit` has to think about the fit at all.
 *
 * IT NEVER THROWS FOR A BUILD'S FAULT. A missing or incomplete surface comes back
 * as {@link Harness.surfaceFault} over a surface whose every operation fails by
 * assertion, so a suite that builds its harness in a `beforeEach` gets its real
 * verdict from the check rather than a hook failure that names nothing.
 */
export async function createHarness(
  options: HarnessOptions = {},
): Promise<Harness> {
  const cssWidth = options.cssWidth ?? FIELD_W;
  const cssHeight = options.cssHeight ?? FIELD_H;
  const dpr = options.dpr ?? 1;
  const context = await contextFor(
    cssWidth,
    cssHeight,
    dpr,
    options.touch === true,
  );
  const page = await context.newPage();
  openPages.add(page);
  // Off Playwright's own thirty seconds and onto this project's ceiling, for
  // every crossing the harness makes: the navigation below, a key press, a
  // click, the ticks a check drives inside the page. See {@link PAGE_CEILING_MS};
  // the two waits whose deadline belongs in the page's own frames count those
  // instead, and say so.
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

  await page.goto(inject("shatterUrl"), { waitUntil: "load" });

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

  /**
   * {@link Harness.batch}: one crossing for a whole pose.
   *
   * The loop runs inside the page, so an operation that throws stops the rest —
   * the same order of events a caller awaiting each one in turn would see — and
   * the name of the operation that threw travels back in the message.
   */
  const batch = async (calls: readonly SurfaceCall[]): Promise<unknown[]> => {
    if (surfaceFault !== null) refuse();
    if (calls.length === 0) return [];
    return page.evaluate(
      ([handle, list]) => {
        const target = (
          window as unknown as Record<
            string,
            Record<string, (...a: unknown[]) => unknown>
          >
        )[handle];
        const answered: unknown[] = [];
        for (const call of list) {
          const [name, ...args] = call as [string, ...unknown[]];
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
  };

  const debug =
    surfaceFault !== null
      ? unexposedSurface(surfaceFault)
      : (new Proxy({} as ShatterDebugApi, {
          get: (_target, property): unknown => {
            if (typeof property === "symbol") return undefined;
            if (property === "then" || property === "constructor")
              return undefined;
            const name = String(property);
            return (...args: unknown[]) => call(name, args);
          },
        }) as ShatterDebugApi);

  if (surfaceFault === null) {
    // Off the wall clock and back to the title before a check touches anything:
    // from here the game changes only when this harness says so.
    await call("setAutoStep", [false]);
    await call("reset", []);
    // And a recorder over the surface before a check can arm one. A build is free
    // to ask for its 2D context on the frame it first draws rather than while it
    // initializes, so the surface can be installed and answering before any
    // context exists to record — and a `captureReplay` armed in that window arms
    // nothing and writes no evidence for a section that drew.
    await waitInPageFrames(page, "recorder");
  }

  const view = fitViewport(cssWidth, cssHeight, dpr);
  const cueSinks: TimedCue[][] = [];
  const stopSinks: TimedCue[][] = [];
  let tickCount = 0;
  let timeMs = 0;

  /**
   * Run `count` ticks as `count` recorded frames, and read the state they left, in
   * one crossing.
   *
   * Each tick is opened and closed around a single `advance(1)`, all inside one
   * synchronous evaluation, so nothing the page's own animation frame renders can
   * land inside a recorded frame — and so a frame the recorder keeps is exactly
   * one tick the game ran. `specs/instrumentation.md` has `advance` draw after the
   * ticks it ran, so each bracket holds exactly one render.
   */
  const drive = async (count: number): Promise<ShatterSnapshot> => {
    if (surfaceFault !== null) refuse();
    const result = (await page.evaluate(
      ([handle, howMany, tickMs]) => {
        const api = (
          window as unknown as Record<
            string,
            Record<string, (...a: unknown[]) => unknown>
          >
        )[handle];
        const rec = (
          window as unknown as {
            __shatterRec: Record<string, (...a: unknown[]) => unknown>;
          }
        ).__shatterRec;
        const audio = (
          window as unknown as {
            __shatterAudio: { started(): number; stopped(): number };
          }
        ).__shatterAudio;
        const started: number[] = [];
        const stopped: number[] = [];
        for (let i = 0; i < howMany; i += 1) {
          const wasStarted = audio.started();
          const wasStopped = audio.stopped();
          rec.begin();
          api.advance(1);
          rec.end(tickMs);
          started.push(audio.started() - wasStarted);
          stopped.push(audio.stopped() - wasStopped);
        }
        return { snapshot: api.snapshot(), started, stopped };
      },
      [HANDLE, count, TICK_MS] as const,
    )) as {
      snapshot: ShatterSnapshot;
      started: number[];
      stopped: number[];
    };

    for (const [index, emitted] of result.started.entries()) {
      tickCount += 1;
      timeMs += TICK_MS;
      const at: TimedCue = { tick: tickCount, t: timeMs };
      for (let n = 0; n < emitted; n += 1) {
        for (const sink of cueSinks) sink.push(at);
      }
      for (let n = 0; n < result.stopped[index]; n += 1) {
        for (const sink of stopSinks) sink.push(at);
      }
    }
    return result.snapshot;
  };

  /**
   * Run `count` ticks in one `advance` call, closing no recorded frame, and read
   * the state they left.
   *
   * The same real ticks the game runs under {@link drive}; what is skipped is the
   * recording. A sound emitted inside a skip is attributed to nothing, because a
   * skip cannot honestly say which of its ticks produced it — a cue check advances.
   */
  const march = async (count: number): Promise<ShatterSnapshot> => {
    if (surfaceFault !== null) refuse();
    const snapshot = (await page.evaluate(
      ([handle, howMany]) => {
        const api = (
          window as unknown as Record<
            string,
            Record<string, (...a: unknown[]) => unknown>
          >
        )[handle];
        api.advance(howMany);
        return api.snapshot();
      },
      [HANDLE, count] as const,
    )) as ShatterSnapshot;
    tickCount += count;
    timeMs += count * TICK_MS;
    return snapshot;
  };

  /**
   * One animation frame, so a pixel read sees the picture the last tick left.
   *
   * `specs/instrumentation.md` has `advance` redraw the canvas, so on a conforming
   * build the picture is already there — but a build that presents on its own frame
   * instead has drawn the same state a moment later, and waiting costs a sample
   * nothing but a frame. The recorder is in manual mode here, so the frame it waits
   * for closes nothing and no recording sees it.
   */
  const present = async (frames = 1): Promise<void> => {
    await page.evaluate(
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
      frames,
    );
  };

  const readPixels = async (
    devicePoints: readonly { x: number; y: number }[],
  ): Promise<Pixel[]> => {
    await present();
    return page.evaluate(
      (points) => {
        const canvases = Array.from(document.querySelectorAll("canvas"));
        if (canvases.length === 0) {
          throw new Error("shatter: the page has no <canvas>");
        }
        let canvas = canvases[0];
        for (const other of canvases) {
          if (other.width * other.height > canvas.width * canvas.height) {
            canvas = other;
          }
        }
        const ctx2d = canvas.getContext("2d");
        if (ctx2d === null) {
          throw new Error("shatter: the canvas has no 2D context");
        }
        return points.map((point) => {
          const x = Math.min(
            Math.max(point.x, 0),
            Math.max(canvas.width - 1, 0),
          );
          const y = Math.min(
            Math.max(point.y, 0),
            Math.max(canvas.height - 1, 0),
          );
          const { data } = ctx2d.getImageData(x, y, 1, 1);
          return [data[0], data[1], data[2], data[3]] as Pixel;
        });
      },
      devicePoints as { x: number; y: number }[],
    );
  };

  const lastCalls = async (): Promise<DrawCall[]> => {
    const ops = (await page.evaluate(() =>
      (
        window as unknown as { __shatterRec: { last(): unknown[] } }
      ).__shatterRec.last(),
    )) as RecordedOp[];
    return ops.map(toDrawCall);
  };

  const harness: Harness = {
    page,
    debug,
    surfaceFault,
    pageErrors,

    tick: () => tickCount,
    timeMs: () => timeMs,

    snapshot: () => debug.snapshot(),
    batch,

    advance: async (count) => {
      if (count > 0) return drive(count);
      return debug.snapshot();
    },

    skip: async (count) => {
      if (count > 0) return march(count);
      return debug.snapshot();
    },

    until: (predicate, untilOptions = {}) =>
      sweep(() => debug.snapshot(), drive, predicate, untilOptions),

    skipUntil: (predicate, untilOptions = {}) =>
      sweep(() => debug.snapshot(), march, predicate, untilOptions),

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
            window as unknown as { __shatterRec: { setMode(m: string): void } }
          ).__shatterRec.setMode("raf");
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
            window as unknown as { __shatterRec: { setMode(m: string): void } }
          ).__shatterRec.setMode("manual");
        },
        [HANDLE] as const,
      );
    },

    hold: (code) => page.keyboard.down(code),
    release: (code) => page.keyboard.up(code),

    async tap(code) {
      await page.keyboard.down(code);
      await drive(1);
      await page.keyboard.up(code);
    },

    async holdFor(codes, ticks) {
      const keys = typeof codes === "string" ? [codes] : [...codes];
      for (const code of keys) await page.keyboard.down(code);
      try {
        if (ticks > 0) await drive(ticks);
      } finally {
        for (const code of keys) await page.keyboard.up(code);
      }
    },

    async frameCalls() {
      await drive(1);
      return lastCalls();
    },

    async presentCalls() {
      // The frame boundary is the recorder's `raf` mode, which opens a frame on
      // one animation frame and closes it on the next — so THREE are waited for:
      // one to open, one for the loop's own present to draw into, and one to close
      // it. Nothing advances, and what comes back is the render the loop made of
      // the state as it stands. What a check about a SCREEN reads, where advancing
      // a tick would run the screen's own timers.
      await page.evaluate(() =>
        (
          window as unknown as { __shatterRec: { setMode(m: string): void } }
        ).__shatterRec.setMode("raf"),
      );
      try {
        await present(3);
      } finally {
        await page.evaluate(() =>
          (
            window as unknown as { __shatterRec: { setMode(m: string): void } }
          ).__shatterRec.setMode("manual"),
        );
      }
      return lastCalls();
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

    async scanDevice(axis, index) {
      await present();
      return page.evaluate(
        ([which, at]) => {
          const canvases = Array.from(document.querySelectorAll("canvas"));
          if (canvases.length === 0) {
            throw new Error("shatter: the page has no <canvas>");
          }
          let canvas = canvases[0];
          for (const other of canvases) {
            if (other.width * other.height > canvas.width * canvas.height) {
              canvas = other;
            }
          }
          const ctx2d = canvas.getContext("2d");
          if (ctx2d === null) {
            throw new Error("shatter: the canvas has no 2D context");
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
            out.push((data[i] + data[i + 1] + data[i + 2]) / 3);
          }
          return out;
        },
        [axis, index] as const,
      );
    },

    surface: () =>
      page.evaluate(() => {
        const canvases = Array.from(document.querySelectorAll("canvas"));
        if (canvases.length === 0) {
          throw new Error(
            "shatter: the page has no <canvas>, so the build drew nowhere — " +
              "index.html supplies one and the build is asked not to edit it " +
              "(specs/overview.md)",
          );
        }
        let canvas = canvases[0];
        for (const other of canvases) {
          if (other.width * other.height > canvas.width * canvas.height) {
            canvas = other;
          }
        }
        return {
          width: canvas.width,
          height: canvas.height,
          dpr: window.devicePixelRatio,
        };
      }),

    async armAudio() {
      // A GENUINE browser gesture, not a posed one: `specs/audio.md` says audio
      // does not start until the player has interacted with the page, and a build
      // is free to open its context from a real DOM event alone, so a key
      // delivered any other way would leave a perfectly good build silent. The key
      // is bound to nothing (`specs/controls.md`), so arming changes no game state.
      await page.keyboard.press(UNBOUND_KEY);
    },

    sounds: () =>
      page.evaluate(() =>
        (
          window as unknown as { __shatterAudio: { started(): number } }
        ).__shatterAudio.started(),
      ),

    stops: () =>
      page.evaluate(() =>
        (
          window as unknown as { __shatterAudio: { stopped(): number } }
        ).__shatterAudio.stopped(),
      ),

    async dispose() {
      // The context stays: it holds the init scripts and the window shape, and the
      // next harness of this shape wants both. The page goes, so nothing this check
      // pressed, opened or muted can reach the next one.
      openPages.delete(page);
      await page.close().catch(() => undefined);
    },
  };

  harnessCues.set(harness, cueSinks);
  harnessStops.set(harness, stopSinks);
  return harness;
}

/** Advance in strides until `predicate` holds, or the ceiling is reached. */
async function sweep(
  read: () => Promise<ShatterSnapshot>,
  run: (count: number) => Promise<ShatterSnapshot>,
  predicate: (snapshot: ShatterSnapshot) => boolean,
  options: UntilOptions,
): Promise<UntilResult> {
  const maxTicks = options.maxTicks ?? ticksFor(5);
  const poll = Math.max(1, options.poll ?? 1);

  let snapshot = await read();
  if (predicate(snapshot)) return { hit: true, ticks: 0, snapshot };

  let count = 0;
  while (count < maxTicks) {
    const stride = Math.min(poll, maxTicks - count);
    snapshot = await run(stride);
    count += stride;
    if (predicate(snapshot)) return { hit: true, ticks: count, snapshot };
  }
  return { hit: false, ticks: count, snapshot };
}

/** Where {@link watchCues} attaches, per harness. */
const harnessCues = new WeakMap<Harness, TimedCue[][]>();
/** Where {@link watchStops} attaches, per harness. */
const harnessStops = new WeakMap<Harness, TimedCue[][]>();

/* ---- The fit -------------------------------------------------------------- */

/**
 * How the field maps onto a surface of this shape, as `specs/overview.md` fixes
 * it: one uniform scale, the whole field inside out to all four edges, centred,
 * with the leftover split evenly into two letterbox bars.
 *
 * Computed rather than read from the build, deliberately. Under an engine the fit
 * is the engine's and a check can ask it what it derived; here the fit is the
 * build's own work, so asking it would be asking a build to grade itself. Every
 * check but `field/field-fit` runs at the field's own size, where this is the
 * identity and the question does not arise; that one check runs at other shapes and
 * reads the pixels against what the specification says should be there.
 */
export function fitViewport(
  cssWidth: number,
  cssHeight: number,
  dpr: number,
): Viewport {
  const deviceWidth = Math.round(cssWidth * dpr);
  const deviceHeight = Math.round(cssHeight * dpr);
  const scale = Math.min(cssWidth / FIELD_W, cssHeight / FIELD_H) * dpr;
  return {
    width: FIELD_W,
    height: FIELD_H,
    scale,
    offsetX: (deviceWidth - FIELD_W * scale) / 2,
    offsetY: (deviceHeight - FIELD_H * scale) / 2,
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
// build itself drew while a check drove it, kept as evidence a reviewer can scrub
// and compare against the reference implementation's. {@link captureReplay} is how
// a check produces one.
//
// Five properties are what make it usable, and each is deliberate:
//
// 1. IT RECORDS THE SECTION, NOT THE RUN. The recorder is armed around the
//    caller's scenario and disarmed the moment that scenario returns, so what is
//    kept is the part the check is ABOUT and never the setup that got there. Put
//    the wait outside it, or off camera entirely with {@link Harness.skip}, which
//    closes no frame at all.
// 2. A RECORDING ENDS ON THE OUTCOME, NOT ON THE INSTANT OF MEASUREMENT. Arm the
//    recorder before the scenario's last beat and stop it AFTER the effect has
//    played out — a second of the fragments coming apart, of the wave arriving, of
//    the core that swallowed the torpedo. The reading the verdict rests on is
//    still taken at the instant the event happened; what changes is where the clip
//    ends, and a clip that cuts on the frame of impact shows a reviewer nothing.
// 3. IT IS EVIDENCE, NEVER A VERDICT. The scenario's own value comes straight
//    back, and a scenario that THROWS still writes what it had recorded before the
//    failure travels on — a failing check is the one whose replay a reviewer most
//    wants. A recording that cannot be written is reported as an output that never
//    turned up, which is a fact about the host rather than about the build.
// 4. IT WRITES ONLY WHAT THERE IS TO LOOK AT. A capture that closed no frames
//    leaves no file, so the run reports the output absent instead of offering the
//    reviewer a replay of nothing.
// 5. IT COSTS NOTHING WHEN NOBODY IS COLLECTING. Outside a run the media directory
//    is unset and the whole thing is a no-op that still runs the scenario, so a
//    check cannot pass in one place and fail in the other.

/** The environment variable the runner names the media directory in. */
const MEDIA_DIR_ENV = "TCAB_VALIDATION_MEDIA_DIR";

/**
 * The directory the runner stages this project to inside the build's tree.
 *
 * A recording is addressed by the STAGED path of the suite that produced it —
 * `validation/waves/clears-on-last-rock.test.ts` — because that is the path the
 * review item's declared script resolves to, and so the only name the case's
 * manifest and the runner both already agree on. Stating the prefix here is what
 * keeps that address the same when this suite is run in place against a reference
 * implementation, where the project root is `validation/none/` instead.
 */
const STAGED_PROJECT_DIR = "validation";

/**
 * The most frames a written recording holds.
 *
 * The injected recorder already holds the page's side to twice this, decimating as
 * it fills, so what arrives here is at most a few hundred frames however long the
 * section ran. This is the same cap the engine-backed harnesses write under, so a
 * replay recorded under any of the three engines is the same size of thing.
 */
const MAX_REPLAY_FRAMES = 300;

/**
 * The ground the console's player paints behind a recorded frame.
 *
 * `specs/overview.md` fixes no field colour: the build paints its own background
 * each frame, and the recorded frames carry that paint. What the player needs is a
 * colour for the canvas under them, and the page the build is served on is painted
 * `#000` by the case's own `index.html`, so that is what a replay says.
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
 * path would be free to write its evidence under some other item's address.
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
 * the file that no frame asks for — dead weight in a document whose whole point is
 * to say each thing once, and the bulk of it in a game that draws procedurally and
 * so repeats almost nothing between frames.
 *
 * Every entry here is reached from a kept frame, and every reference inside one is
 * rewritten as it is reached, transitively. What is deduplicated is the rewritten
 * entry, so an operation two hundred frames issue identically is written once and
 * named two hundred times.
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
    if (typeof record.$res === "number") {
      return { $res: takeResource(record.$res) };
    }
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
 * `count` is left as it was recorded, so a reader can see that frames were skipped
 * rather than being told a smooth lie. The last frame is always kept whatever the
 * stride lands on — it is the frame the check's sweep stopped at, and the one a
 * reviewer looks at first.
 *
 * Keeping it costs a frame rather than the cap. The stride rounds up, so a section
 * whose length is an exact multiple of the cap strides over exactly that many
 * frames and stops one stride short of the end: the last frame still has to come
 * in, and the cap is a ceiling rather than a target. It takes the place of the
 * final strided frame — the frame nearest it, so the swap opens the smallest gap
 * available anywhere in the section — and is measured from where that frame was
 * measured from, which is what keeps the kept deltas summing to the elapsed time.
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
 * What lands on disk is gzip rather than raw JSON. A recording is text made almost
 * entirely of numbers and repeated field names, which gzip takes down to a
 * fraction of its size, and every host that serves one declares the encoding so the
 * browser inflates it before the player sees it.
 *
 * Never throws. A file that cannot be written says something about the machine the
 * validators ran on, and failing the item over it would blame the build for the
 * host's problem.
 */
function writeReplay(destination: string, recording: Recording | null): void {
  if (recording === null || recording.frames.length === 0) return;
  try {
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, gzipSync(JSON.stringify(thinReplay(recording))));
  } catch (error) {
    console.warn(`shatter: could not write ${destination}: ${String(error)}`);
  }
}

/**
 * Record the frames `scenario` drives and keep them as the review item's
 * `outputId` output, handing back whatever the scenario returned.
 *
 * Wrap the drive, not the arrangement, and let the outcome play out inside it:
 *
 * ```ts
 * const banner = await captureReplay(h, "clear", async () => {
 *   const hit = await shootRock(h, last.id);          // the beat
 *   await h.advance(ticksFor(WAVE_BANNER_TIME + 0.5)); // and its outcome
 *   return hit;
 * });
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
        window as unknown as { __shatterRec: { arm(d: unknown): boolean } }
      ).__shatterRec.arm(design),
    { width: FIELD_W, height: FIELD_H, background: REPLAY_BACKGROUND },
  );
  try {
    return await scenario();
  } finally {
    // In a `finally`, so a scenario that failed still leaves its evidence behind.
    const recording = (await h.page.evaluate(() =>
      (
        window as unknown as { __shatterRec: { disarm(): unknown } }
      ).__shatterRec.disarm(),
    )) as Recording | null;
    writeReplay(destination, recording);
  }
}

/**
 * Keep the picture currently on the canvas as the review item's `outputId` output.
 *
 * The companion to {@link captureReplay}, for an item whose evidence is one PICTURE
 * rather than a stretch of motion: which screen the game opened on, how a build
 * drew a rock of each size, where the letterbox bars fell.
 *
 * What is written is whatever the last tick that RAN left behind, so call it after
 * the tick that poses the thing under test and before the assertions, so a check
 * that fails still leaves the picture that shows why. Nothing here can change a
 * verdict: outside a run this is a no-op, and a still that cannot be written is
 * reported as an output that never turned up.
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
    console.warn(`shatter: could not write ${destination}: ${String(error)}`);
  }
}

/* -------------------------------------------------------------------------- */
/* Cues                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Record every sound the build emits from now on, stamped with the tick of the
 * drive it sounded on.
 *
 * WHAT IS OBSERVED, AND WHY IT IS THE FAIR READING. `specs/audio.md` requires one
 * cue per event, played on the tick its event happens, and says nothing at all
 * about how a build makes a sound — under this engine the whole audio layer is the
 * build's. So `audio-init.js` watches the two doors a browser can emit sound
 * through (a Web Audio source being `start()`ed, whatever kind it is, and an
 * `<audio>` element being played) and counts what goes through them; the harness
 * brackets each driven tick around that count, so a sound is attributed to the tick
 * that produced it. A blip made of two oscillators counts as two, which is why a
 * check asserts that a tick SOUNDED rather than how many times: the number of
 * sources is the build's business and the specification never fixed it.
 *
 * WHAT IS LOST HERE THAT AN ENGINE GIVES. The cue's NAME. Under an engine the game
 * asks the bus for `CUES.fire` by name and the bus announces it, so a build that
 * plays its menu blip on every shot is caught. There is no bus here to ask, so
 * these checks confirm that a sound was emitted and on which tick, and a reviewer
 * decides by ear whether the six are told apart. That is a real reduction, and the
 * alternative — inferring the cue from the waveform the reference happens to use —
 * would grade builds against an implementation rather than against the
 * specification. NO CHECK IN THIS PROJECT MAY ASSERT A CUE NAME.
 *
 * A sound emitted inside {@link Harness.skip} is attributed to nothing, since a
 * skip closes no ticks of its own: run the ticks a cue check reads with
 * {@link Harness.advance}.
 */
export function watchCues(h: Harness): TimedCue[] {
  const played: TimedCue[] = [];
  harnessCues.get(h)?.push(played);
  return played;
}

/**
 * Record every sounding voice the build STOPS from now on, on the same terms.
 *
 * The other half of the held cue. `specs/audio.md` makes `thrust` start on the tick
 * thrust begins and stop within a tenth of a second of its release, and the release
 * is not observable as a sound: what is observable is the source being told to
 * stop. So `audio/thrust-cue-stops` reads this rather than {@link watchCues}.
 *
 * READ IT AS A DELTA ON A QUIET TICK. A one-shot cue commonly schedules its own
 * stop at the moment it plays, so a tick that started a sound may well have stopped
 * one too. What is decidable is a tick on which NOTHING started and a voice
 * stopped, which is exactly the shape of a burn ending.
 */
export function watchStops(h: Harness): TimedCue[] {
  const stopped: TimedCue[] = [];
  harnessStops.get(h)?.push(stopped);
  return stopped;
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
 * commonly drawn with a selection marker or padding around it. Requiring the exact
 * run would fail a screen that shows precisely the right words.
 */
export function drewText(calls: readonly DrawCall[], text: string): boolean {
  const wanted = text.trim().toLowerCase();
  return drawnText(calls).some((drawn) => drawn.toLowerCase().includes(wanted));
}

/**
 * Whether the frame drew `word` as a STANDALONE token, ignoring case.
 *
 * The stricter sibling of {@link drewText}, for the copy `specs/ui.md` requires as
 * a word rather than as a substring — the how-to screen's `SPACE`, `ARROWS`,
 * `WASD`, `ESC`, `P` and `M`. A screen reading "press the spacebar" contains
 * `space` and names no key the specification named.
 */
export function drewWord(calls: readonly DrawCall[], word: string): boolean {
  const pattern = new RegExp(
    `(^|[^A-Za-z0-9])${word.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z0-9]|$)`,
    "i",
  );
  return drawnText(calls).some((drawn) => pattern.test(drawn));
}

/** One run of text a frame drew, and where it drew it in logical field units. */
export interface TextDraw {
  text: string;
  /** The anchor the run was drawn at, mapped through the transform in force. */
  x: number;
  y: number;
  /**
   * The horizontal extent of the run's glyphs, in logical field units.
   *
   * The width the context measured at the call, scaled by the transform in force
   * and laid out about the anchor as the alignment then in force places it. A run
   * whose width the recorder could not read spans its anchor alone, so `left` and
   * `right` are both `x`.
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
 * Walk a frame's operations, handing `visit` each one with the transform in force
 * at it.
 *
 * A build is free to draw under a transform — to translate to a rock's centre and
 * rotate by its spin, or to translate to the ship and turn by its facing — so the
 * position and the orientation a call names are only what they mean once the
 * transform at that call is applied. This carries `save`/`restore`, `translate`,
 * `scale`, `rotate`, `transform`, `setTransform` and `resetTransform`, starting
 * from `start` (the state the frame inherited) over `stack` (the states saved under
 * it, outermost first).
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
 * Every run of text the frame drew, with its anchor in logical field units.
 *
 * At the harness's default shape the canvas is the field at one pixel per unit, so
 * what comes back is directly comparable with the figures `specs/overview.md`
 * fixes — which is how `presentation/hud-score-is-drawn` reads where a readout
 * landed.
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
 * Every logical point a frame's drawing calls named, mapped through the transform
 * in force at each.
 *
 * The leading pair of arguments is the position for every method listed, except
 * the curve calls, whose control points come first and whose endpoint is the last
 * pair.
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
      // The source comes first, so the destination is the pair after it — or, in
      // the nine-argument form, the pair after the source sub-rect.
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

/**
 * The logical points a frame's drawing calls named, within `radius` of `at` by the
 * shortest wrapped separation.
 *
 * The reading `field/seam-drawn-both-sides` and the `presentation` items are built
 * on: a body straddling a seam is drawn on BOTH sides at once, so the question is
 * never "did the build draw near this point" but "did it draw near this point and
 * near its wrapped image".
 */
export function drawnNear(
  calls: readonly DrawCall[],
  at: Vec,
  radius: number,
): { x: number; y: number }[] {
  return drawnPoints(calls).filter((point) => {
    const delta = shortestDelta(at, point);
    return Math.hypot(delta.x, delta.y) <= radius;
  });
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

/** A colour's luminance, out of 255: the reading a ramp brightens along. */
export function luminance(c: Rgb): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/**
 * The five offsets a colour sample is averaged over, in logical units.
 *
 * The centre plus four neighbours four units out, all well inside the body of the
 * smallest thing any check samples (a Small rock is radius 14, the ship 14), so one
 * stray anti-aliased or glow pixel cannot swing the reading.
 */
const SAMPLE_OFFSETS: readonly (readonly [number, number])[] = [
  [0, 0],
  [4, 0],
  [-4, 0],
  [0, 4],
  [0, -4],
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
  const samples: Rgb[] = [];
  for (const point of BARE_POINTS) {
    samples.push(await sampleColor(h, point.x, point.y));
  }
  return samples.reduce((darkest, sample) =>
    luminance(sample) < luminance(darkest) ? sample : darkest,
  );
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
  await h.batch(clearCalls(await carriesTorpedoes(h)));
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
  await h.batch(calls);
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
  const answered = await h.batch([call, ["snapshot"]]);
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
  await h.batch(faculties);
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

/**
 * The CDP session a page's contacts are driven through, opened once and HELD.
 *
 * Chromium tracks the live contacts per CDP client, so a session opened for the
 * landing and detached again takes the contact with it: the travel that follows
 * is refused outright, and a gesture is three events. The session therefore has
 * to outlive the whole gesture, and the page closing is what closes it.
 */
const touchSessions = new WeakMap<Page, Promise<CDPSession>>();

/** The contact identifier every gesture below drives: one finger is all a menu needs. */
const CONTACT_ID = 1;

/** The held CDP session for `page`, opening it on the first contact it drives. */
function touchSession(page: Page): Promise<CDPSession> {
  const open = touchSessions.get(page);
  if (open !== undefined) return open;
  const opening = page.context().newCDPSession(page);
  touchSessions.set(page, opening);
  return opening;
}

/**
 * Dispatch one raw touch event through CDP.
 *
 * Playwright's own `page.touchscreen` carries `tap` alone, which is a landing and
 * a lift with no frame between them, so a check that needs the contact HELD
 * across a tick cannot express itself through it. The Chrome DevTools Protocol is
 * the level that can, and it is what `page.touchscreen.tap` is itself built on.
 */
async function dispatchTouch(
  h: Harness,
  type: "touchStart" | "touchMove" | "touchEnd",
  point: { x: number; y: number } | null,
): Promise<void> {
  const session = await touchSession(h.page);
  await session.send("Input.dispatchTouchEvent", {
    type,
    touchPoints:
      point === null ? [] : [{ x: point.x, y: point.y, id: CONTACT_ID }],
  });
}

/** Land a contact at a logical field point, and run the tick that reads it. */
export async function touchPress(
  h: Harness,
  x: number,
  y: number,
): Promise<void> {
  await dispatchTouch(h, "touchStart", h.css(x, y));
  await h.advance(1);
}

/** Travel the held contact to a logical field point, and run the tick that reads it. */
export async function touchGlide(
  h: Harness,
  x: number,
  y: number,
): Promise<void> {
  await dispatchTouch(h, "touchMove", h.css(x, y));
  await h.advance(1);
}

/** Lift the contact, and run the tick that reads it. */
export async function touchRelease(h: Harness): Promise<void> {
  await dispatchTouch(h, "touchEnd", null);
  await h.advance(1);
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

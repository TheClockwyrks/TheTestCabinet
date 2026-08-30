// Arc Foundry — the shared validator harness. CASE-PROVIDED.
//
// Every check in this project is an ordinary vitest test that runs IN THE SAME
// PROCESS as the build. It imports the engine and the build's own `src/game.ts`,
// creates an engine over a canvas it owns and a clock it chose, and steps the game
// with `engine.advance`. Nothing drives a browser, nothing serves a site, nothing
// polls, and no wall-clock time passes: a check asks for a number of frames and
// gets exactly that number, at exactly the deltas its clock supplied.
//
// WHAT A CHECK READS. The game's own state (through the debug surface's
// `snapshot`), the three control readings, the engine's frame counter, the cues
// the engine announced, the assets the build failed to load, and — for the
// rendering checks — the pixels on the canvas or the operations the render issued
// against the 2D context. Nothing here fabricates an outcome: the scenario
// helpers below only ARRANGE the yard through the debug surface, and the real
// `update` the build wrote is what runs from there.
//
// WHY THE DEBUG SURFACE RATHER THAN RAW ASSIGNMENT. `specs/instrumentation.md`
// fixes its operations, so they mean the same thing in every build:
// `clearStructures` empties the yard and recomputes the route, `placeComponent`
// stands one permanent component up and appends it to the snapshot,
// `setUnitFrozen` holds one unit's travel and nothing else about it, and
// `spawnUnit` releases through the real spawner into a wave whose schedule is
// empty. Posing through it is how a scenario is reproducible, and it is the seam
// the case's specification documents. `surface.ts` is that specification as types,
// and it is the only description of the surface this harness reads: the build's
// own module for it is never imported.
//
// WHERE THE SURFACE COMES FROM. Off `engine.debug`, never built here. The build's
// `initialize` returns it beside the state, as `[state, debug]`, the engine holds
// the second element and returns it from `engine.debug`, and reading it back off
// the engine is the only way a surface reaches a check. So a build that returned
// no surface, or a surface missing an operation, fails the checks that reach the
// game through it. See {@link readDebugSurface}.
//
// HOW THE SURFACE IS DRIVEN. The engine holds the state by value and hands it out
// read-only, so the surface is pure: a pose takes the current state and returns
// the next, a reading takes the current state and returns what it read
// (`surface.ts`). A check still writes `h.debug.setCharge(500)` and
// `h.debug.snapshot()`, because `h.debug` is a {@link Driver} over the raw
// surface: it runs each pose through `engine.apply` and hands each reading
// `engine.state`. Nothing a check does holds a writable state — `h.state` is the
// engine's current value, read fresh on every access, and the only way to change
// it is a pose.
//
// THE CLOCK IS THE ENGINE'S, AND SO IS THE INPUT. `specs/instrumentation.md` puts
// no clock and no input operation on the surface under an engine, because both
// belong to the runtime: `engine.advance(n)` runs whole frames off a clock this
// harness supplies, and a key or a pointer press is a real event dispatched at the
// engine's own surface, which the game reads through the actions it registered.
// The default clock is a steady 120 Hz, which makes every duration below a whole
// number of frames — and which keeps a projectile's step (`PROJECTILE_SPEED / 120`,
// about 4.3 units) inside its own hit radius, so a shot's arrival is a fact about
// the game rather than about the step size.
//
// ONE ENGINE PER HARNESS, AND ONE HARNESS PER CHECK. `createHarness` builds a
// fresh canvas, a fresh event target and a fresh engine every time, so every check
// drives a game that has just initialized, with no key held, nothing muted, and
// nothing placed. `dispose` destroys the engine and drops its listeners.
//
// AND THIS FILE OWNS EVERY COMPOUND SEQUENCE. The surface is atomic by design: one
// operation sets one field. Opening a run, emptying the yard, standing one
// structure up, releasing one held unit, pressing one named control — each of
// those is several operations in a fixed order, and each lives HERE so that a
// hundred suites say what their scenario is about in one line and say it the same
// way. A check that needs only part of a sequence calls the operations it needs.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import {
  createCanvas,
  Image,
  type Canvas,
  type SKRSContext2D,
} from "@napi-rs/canvas";

// The engine's recorder decides whether a draw source is a bitmap by matching the
// host's own constructor names, and a name the host does not define never matches.
// Node defines no `ImageBitmap`, so the images this harness draws from -- which are
// `@napi-rs/canvas`'s `Image` -- were recorded as an opaque marker with no pixels
// behind it. Every replay that drew a produced sprite therefore reached a reviewer
// with the sprite missing from it.
//
// Naming that class `ImageBitmap` on the host is the whole fix, and it belongs here
// rather than in the engine: matching by name is the engine's deliberate design, and
// it is correct in the browser it is written for. This harness is the Node-side
// adapter, so supplying the name the host lacks is its job.
(globalThis as Record<string, unknown>).ImageBitmap ??= Image;
import {
  ConstantClock,
  createEngine,
  type CapturedImage,
  type Clock,
  type DrawOp,
  type DrawState,
  type DrawValue,
  type Engine,
  type Game,
  type PathSegment,
  type RecordedFrame,
  type Recording,
  type Resource,
  type SurfaceMetrics,
  type Viewport,
} from "@test-cabinet/simple-2d";
import type { DeepReadonly } from "ts-essentials";
import { expect } from "vitest";

import {
  BASE_STATS,
  BINDINGS,
  BOARD_Y,
  COMBOS,
  COMBO_DAMAGE_MULT,
  COMBO_MAX_LEVEL,
  COMBO_RANGE_BONUS,
  COMBO_UPGRADE_COST_FRAC,
  DIFFICULTIES,
  FIRING_COMPONENT_TYPES,
  FOOTPRINT,
  GRID_COLS,
  GRID_ROWS,
  LAYOUT,
  LOAD_ROSTER,
  LOAD_TYPES,
  MAPS,
  OVERLOAD_TYPE,
  QUALITY_MULT,
  RANGE_PER_TIER,
  REFINEMENT_COSTS,
  STAGE_H,
  STAGE_W,
  STAMPS_PER_LEVEL,
  TARGETING_PRIORITIES,
  TILE,
  WAVE_BONUS_BASE,
  WAVE_BONUS_STEP,
  type ActionName,
  type ComboId,
  type Combo as ComboDef,
  type ComponentType,
  type Difficulty as DifficultyDef,
  type DifficultyId,
  type LoadType,
  type LoadUnitType as LoadDef,
  type FoundryMap as MapDef,
  type MapId,
  type MenuAction,
  type PanelAction,
  type PressControl as PressAction,
  type StatusControl as StatusAction,
  type Tile,
} from "../src/constants";
import { BACKGROUND, game as build, type FoundryState } from "../src/game";
import { assertTruthy, fail } from "./assert";
import {
  READINGS,
  type FoundryDebugApi,
  type FoundrySnapshot,
  type MenuButton,
  type OverlayName,
  type PanelButton,
  type PressButton,
  type Screen,
  type SpawnType,
  type StatusControl,
  type StructureView,
  type Targeting,
  type Tier,
  type UnitView,
} from "./surface";

export {
  FOUNDRY_DEBUG_VERSION,
  DEFAULT_SEED,
  READINGS,
  REQUIRED_OPS,
  type FoundrySnapshot,
  type MenuButton,
  type OverlayName,
  type PanelButton,
  type PressButton,
  type ProjectileView,
  type Screen,
  type SpawnType,
  type StatusControl,
  type StructureView,
  type Targeting,
  type Tier,
  type UnitView,
  type WaypointView,
} from "./surface";

export type { ActionName, ComboId, ComponentType, LoadType, MapId, Tile };

/* -------------------------------------------------------------------------- */
/* The step schedule                                                          */
/* -------------------------------------------------------------------------- */
//
// The suite chooses the size of a frame, because the specification deliberately
// fixes none: every rate in this game is per second and is integrated against the
// elapsed time of the frame, so a build must reach the same place however that
// time was divided. A check that is specifically about the step size builds
// harnesses with clocks of its own; every other check takes the default.

/** The frame the suite steps in. */
export const TICK_HZ = 120;
export const TICK_MS = 1000 / TICK_HZ;

/** Seconds of simulated time in `n` frames of the default clock. */
export function seconds(n: number): number {
  return n / TICK_HZ;
}

/** Frames of the default clock covering `s` seconds, rounded up. */
export function ticks(s: number): number {
  return Math.ceil(s * TICK_HZ);
}

/** A speed in units per second from a displacement measured over `n` frames. */
export function speedOverTicks(delta: number, n: number): number {
  return (Math.abs(delta) * TICK_HZ) / n;
}

/** A point on the stage, in logical units. */
export interface Point {
  x: number;
  y: number;
}

/** The straight-line distance between two points. */
export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/* -------------------------------------------------------------------------- */
/* The figures, derived from the case's own constants                         */
/* -------------------------------------------------------------------------- */
//
// `src/constants.ts` is the CASE's file, seeded into every workspace and left
// alone by the build, so it is the case's own statement of every figure the
// specification fixes and importing it is not reading the build. What is derived
// HERE is only what a check needs and the constants state as a rule rather than as
// a table: where a tile is on the stage, what a component's damage is at a tier,
// what a tower's upgrade costs. Each derivation is the arithmetic its `specs/`
// page states, so a check asserting against one is asserting against the
// specification.

/** The anchors a `FOOTPRINT` by `FOOTPRINT` structure may take. */
export const MAX_ANCHOR_COL = GRID_COLS - FOOTPRINT;
export const MAX_ANCHOR_ROW = GRID_ROWS - FOOTPRINT;

/** The center of tile `(col, row)`, in logical units (specs/yard.md). */
export function tileCenter(col: number, row: number): Point {
  return { x: TILE * col + TILE / 2, y: BOARD_Y + TILE * row + TILE / 2 };
}

/**
 * The center of a structure anchored at `(col, row)`: the point range, targeting
 * and drawing are all measured from (specs/yard.md).
 */
export function structureCenter(col: number, row: number): Point {
  return { x: TILE * (col + 1), y: BOARD_Y + TILE * (row + 1) };
}

/**
 * The four tiles a waypoint platform anchored at `(col, row)` covers: the three
 * of its arm, and the stem, which points into the yard (specs/yard.md).
 */
export function platformTiles(col: number, row: number): Tile[] {
  return [
    { col: col - 1, row },
    { col, row },
    { col: col + 1, row },
    { col, row: row < GRID_ROWS / 2 ? row + 1 : row - 1 },
  ];
}

/** The map of that identifier. */
export function mapById(id: MapId): MapDef {
  const found = MAPS.find((m) => m.id === id);
  if (found === undefined) throw new Error(`no map ${id}`);
  return found;
}

/**
 * The whole ordered chain of a map: the entry, its six waypoints, the collector.
 *
 * The checkpoint a unit heads for is numbered from `1`, so `chain(map)[i]` is the
 * checkpoint `waypointIndex` `i` names once the entry is dropped — see
 * {@link checkpoint}.
 */
export function chain(map: MapDef): Tile[] {
  return [map.entry, ...map.waypoints, map.collector];
}

/** The `waypointIndex` a unit heading for the collector reports. */
export const COLLECTOR_WAYPOINT = 7;

/** The checkpoint a `waypointIndex` of `1`–`7` names (specs/instrumentation.md). */
export function checkpoint(map: MapDef, waypointIndex: number): Tile {
  const found =
    waypointIndex === COLLECTOR_WAYPOINT
      ? map.collector
      : map.waypoints[waypointIndex - 1];
  if (found === undefined) {
    throw new RangeError(`no checkpoint ${waypointIndex}`);
  }
  return found;
}

/** A route's length is in TILES: an orthogonal step is 1, a diagonal sqrt(2). */
export const STEP_ORTHOGONAL = 1;
export const STEP_DIAGONAL = Math.SQRT2;

/** What clearing wave `n` pays, in Charge (specs/economy.md). */
export function waveBonus(n: number): number {
  return WAVE_BONUS_BASE + WAVE_BONUS_STEP * n;
}

/** The difficulty of that identifier. */
export function difficultyById(id: DifficultyId): DifficultyDef {
  const found = DIFFICULTIES.find((d) => d.id === id);
  if (found === undefined) throw new Error(`no difficulty ${id}`);
  return found;
}

/** The two milestone waves of a run of `N` waves: `round(N / 2)` and `N`. */
export function milestoneWaves(waves: number): [number, number] {
  return [Math.round(waves / 2), waves];
}

/**
 * A unit's maximum health on wave `w` (specs/difficulty.md):
 * `round(baseHealth * baseMult * [(1 + k(w - 1)) + c(r^(w-1) - 1)])`, to the
 * nearest whole number with an exact half rounding up.
 */
export function scaledHp(
  baseHealth: number,
  wave: number,
  difficulty: DifficultyDef,
): number {
  const w = Math.max(1, wave);
  const { baseMult, k, c, r } = difficulty;
  const bracket = 1 + k * (w - 1) + c * (Math.pow(r, w - 1) - 1);
  return Math.round(baseHealth * baseMult * bracket);
}

/** The roster entry of that type. */
export function loadDef(type: LoadType): LoadDef {
  const found = LOAD_ROSTER.find((u) => u.type === type);
  if (found === undefined) throw new Error(`no roster entry ${type}`);
  return found;
}

/** Every argument `spawnUnit` takes, in the order specs/instrumentation.md lists. */
export const SPAWN_TYPES: readonly SpawnType[] = [
  ...LOAD_TYPES,
  OVERLOAD_TYPE as SpawnType,
];

/** The seven base types that fire. The Regulator never does. */
export const FIRING_TYPES: readonly ComponentType[] = [
  ...FIRING_COMPONENT_TYPES,
];

/** The one base type that never fires. */
export const NON_FIRING_TYPE: ComponentType = "regulator";

/** The five quality tiers, in ladder order. */
export const TIERS: readonly Tier[] = [1, 2, 3, 4, 5];

/** A base component's damage per shot at `tier`, before any aura. */
export function componentDamage(type: ComponentType, tier: Tier): number {
  return BASE_STATS[type].damage * QUALITY_MULT[tier - 1]!;
}

/** A base component's range at `tier`. The Regulator has none, and reports `0`. */
export function componentRange(type: ComponentType, tier: Tier): number {
  const base = BASE_STATS[type].range;
  return base === null ? 0 : base + RANGE_PER_TIER * (tier - 1);
}

/** A base component's shots per second. Flat across tiers. */
export function componentFireRate(type: ComponentType): number {
  return BASE_STATS[type].fireRate ?? 0;
}

/** The combination tower of that identifier. */
export function comboDef(id: ComboId): ComboDef {
  const found = COMBOS.find((c) => c.id === id);
  if (found === undefined) throw new Error(`no combination tower ${id}`);
  return found;
}

/** The four-rung upgrade track a combination tower climbs. */
export const COMBO_LEVELS: readonly number[] = Array.from(
  { length: COMBO_MAX_LEVEL + 1 },
  (_unused, level) => level,
);

/** A landed tower's damage at `level` (specs/combinations.md). */
export function comboDamage(id: ComboId, level: number): number {
  return comboDef(id).damage * COMBO_DAMAGE_MULT[level]!;
}

/** A landed tower's range at `level` (specs/combinations.md). */
export function comboRange(id: ComboId, level: number): number {
  return comboDef(id).range + COMBO_RANGE_BONUS[level]!;
}

/**
 * The Charge that raises a tower to `level`, rounded to the nearest whole number
 * with an exact half rounding up (specs/combinations.md).
 */
export function comboUpgradeCost(id: ComboId, level: number): number {
  return Math.round(comboDef(id).damage * COMBO_UPGRADE_COST_FRAC[level - 1]!);
}

/** The Charge that raises refinement from `level - 1` to `level`. */
export function refinementCost(level: number): number {
  const cost = REFINEMENT_COSTS[level - 1];
  if (cost === undefined) throw new RangeError(`no refinement level ${level}`);
  return cost;
}

/** The one key of each action, for a check that presses rather than holds. */
export function keyFor(action: ActionName): string {
  return BINDINGS[action][0]!;
}

/** The key the engine shows and hides its diagnostics overlay with. */
export const OVERLAY_KEY = "Backquote";

/**
 * A key no action is bound to, for a check that needs a keystroke to change
 * nothing.
 */
export const UNBOUND_KEY = "KeyZ";

/* -------------------------------------------------------------------------- */
/* The harness                                                                */
/* -------------------------------------------------------------------------- */

/** The case's surface, bound to the state type the build declared. */
export type FoundrySurface = FoundryDebugApi<FoundryState>;

/**
 * The build's game, typed against the surface the CASE specifies.
 *
 * The build declares its own type for the surface its `initialize` returns, and
 * that type is the build's: what a check holds it to is `surface.ts`, so the game
 * is cast to the case's `Game<FoundryState, FoundrySurface>` here and the engine
 * is parameterized with it. A surface that departs from the specification is
 * caught where a check reaches for the missing member, not by the build's own
 * compiler.
 */
const game = build as unknown as Game<FoundryState, FoundrySurface>;

/**
 * A member of a pure surface, as a check calls it.
 *
 * A pose `(state, ...args) => S` becomes `(...args) => void`: the driver runs it
 * through `engine.apply`, so the state it returns is the state the next frame
 * receives. A reading `(state) => R` becomes `() => R`: the driver hands it
 * `engine.state`. Anything else (`version`) is carried as it is.
 */
type Driven<S, M> = M extends (state: DeepReadonly<S>, ...args: infer A) => S
  ? (...args: A) => void
  : M extends (state: DeepReadonly<S>) => infer R
    ? () => R
    : M;

/**
 * The imperative reading of a pure surface: every member of `D`, minus its state
 * argument, over the engine that holds the state.
 */
export type Driver<S, D> = {
  [K in keyof D]: Driven<S, NonNullable<D[K]>>;
};

/** The surface as every check drives it. */
export type FoundryDriver = Driver<FoundryState, FoundrySurface>;

/** One recorded operation on the 2D context, in the order the render made it. */
export type DrawCall =
  | { kind: "call"; method: string; args: unknown[] }
  | { kind: "set"; property: string; value: unknown };

/** One cue the build played, as the engine announced it. */
export interface TimedCue {
  /** The cue's name, one of the twelve `CUES` fixes (specs/ui.md). */
  cue: string;
  /** The frame loop's simulated time when it played, in milliseconds. */
  t: number;
  /** The cue's gain: zero while the bus is muted, positive otherwise. */
  gain: number;
  /** The frame it played on, 1-based, as `engine.frame().count` reports. */
  frame: number;
}

/** One asset the build asked for and did not get. */
export interface AssetFailure {
  path: string;
  reason: string;
}

export interface HarnessOptions {
  /** The clock each frame takes its delta from. Defaults to 120 Hz. */
  clock?: Clock;
  /** The element's laid-out CSS width. Defaults to the logical stage width. */
  cssWidth?: number;
  /** The element's laid-out CSS height. Defaults to the logical stage height. */
  cssHeight?: number;
  /** Device pixels per CSS pixel. Defaults to 1, so one device pixel is one unit. */
  dpr?: number;
}

/** How far a sweep may run, and how many frames separate two samples. */
export interface UntilOptions {
  maxFrames?: number;
  poll?: number;
}

/** What a sweep found: whether the predicate ever held, and where it stopped. */
export interface UntilResult {
  hit: boolean;
  /** Frames advanced before the sample that ended the sweep. */
  frames: number;
  snapshot: FoundrySnapshot;
}

export interface Harness {
  readonly engine: Engine<FoundryState, FoundrySurface>;
  /**
   * The engine's current state, read fresh on every access. Read it, or pose it
   * through `debug`; nothing here can write to it.
   */
  readonly state: DeepReadonly<FoundryState>;
  /**
   * The debug surface the BUILD returned beside its state, driven over the
   * engine: each pose runs through `engine.apply`, each reading is handed
   * `engine.state`.
   */
  readonly debug: FoundryDriver;
  /** The real 2D context, for `getImageData`. Draw calls also reach it. */
  readonly ctx: SKRSContext2D;
  /**
   * The surface the engine drew into, holding the last frame that ran. Exposed
   * for {@link captureStill}, which encodes it.
   */
  readonly canvas: Canvas;
  /** Every call and property set the render made, oldest first. */
  readonly calls: DrawCall[];
  /** Every cue the build played, oldest first. */
  readonly cues: TimedCue[];
  /** Every asset the build failed to load, oldest first. */
  readonly assetFailures: AssetFailure[];

  /** This engine's frame counter, as `engine.frame().count` reports it. */
  frame(): number;
  /** The simulated time those frames covered, in milliseconds. */
  timeMs(): number;

  /** A fresh read of the game's state through the case's `snapshot`. */
  snapshot(): FoundrySnapshot;
  /** Run `frames` frames back to back, each the length the clock says. */
  advance(frames: number): Promise<void>;
  /** Run whole frames of the default clock covering `s` seconds of game time. */
  advanceSeconds(s: number): Promise<void>;
  /** Advance until `predicate` holds, sampling every `poll` frames. */
  until(
    predicate: (snapshot: FoundrySnapshot) => boolean,
    options?: UntilOptions,
  ): Promise<UntilResult>;
  /** Drive the engine's own frame loop for `ms` of real time, then halt it. */
  runFor(ms: number): Promise<void>;

  /** Press a key and leave it down, as a player holding it would. */
  hold(code: string): void;
  /** Release a key held by `hold`. */
  release(code: string): void;
  /**
   * Press and release a key, then run the one frame that delivers its edge.
   *
   * The engine discards an edge nothing consumed by the end of the frame it was
   * armed in, so a tap that ran no frame would never reach the game. The release
   * is delivered before the frame because an edge, once armed, survives it: an
   * action read as a LEVEL — `modify` — is held with {@link Harness.hold}
   * instead, and {@link withModify} is the shape that does it.
   */
  tap(code: string): Promise<void>;

  /** Move the pointer, without pressing. */
  pointerMove(x: number, y: number): void;
  /** Press the pointer at a logical point. */
  pointerDown(x: number, y: number): void;
  /** Release the pointer at a logical point. */
  pointerUp(x: number, y: number): void;

  /** Run exactly one frame and hand back every operation its render issued. */
  frameCalls(): Promise<DrawCall[]>;
  /**
   * Reflect the surface without invoking it: `typeof` for each name, and the
   * version it reports.
   */
  probe(names: readonly string[]): {
    version: unknown;
    ops: Record<string, string>;
  };

  /** How the stage is mapped onto this harness's canvas. */
  viewport(): Viewport;
  /** Where a logical point lands in the canvas's backing store. */
  device(x: number, y: number): { x: number; y: number };
  /** The device pixel under a logical point, as `[r, g, b, a]`. */
  pixel(x: number, y: number): [number, number, number, number];
  /** Many logical points at once. */
  pixels(points: readonly Point[]): [number, number, number, number][];

  /** Halt the engine and drop every listener. */
  dispose(): void;
}

/** A `KeyboardEvent`-shaped event: the engine reads `code` and `repeat`. */
class KeyEvent extends Event {
  readonly code: string;
  readonly repeat: boolean;

  constructor(type: "keydown" | "keyup", code: string, repeat = false) {
    super(type);
    this.code = code;
    this.repeat = repeat;
  }
}

/**
 * A `PointerEvent`-shaped event: the engine reads `clientX`, `clientY` and
 * `isPrimary`, and maps the position through the same fit the game draws under.
 *
 * At the default shape — the stage's own size at one device pixel per CSS pixel —
 * that fit is the identity, so a logical point is dispatched directly.
 */
class PointerEvt extends Event {
  readonly clientX: number;
  readonly clientY: number;
  readonly isPrimary = true;

  constructor(
    type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
    x: number,
    y: number,
  ) {
    super(type);
    this.clientX = x;
    this.clientY = y;
  }
}

function toDevice(view: Viewport, x: number, y: number): Point {
  return {
    x: Math.round(view.offsetX + x * view.scale),
    y: Math.round(view.offsetY + y * view.scale),
  };
}

/**
 * A proxy that records every call and property set on its way to the real
 * context, so one frame produces both a pixel buffer to sample and a call list to
 * inspect.
 */
function recorder(target: SKRSContext2D, calls: DrawCall[]): SKRSContext2D {
  return new Proxy(target, {
    get(object, property) {
      const value = Reflect.get(object, property, object) as unknown;
      if (typeof value !== "function") return value;
      return (...args: unknown[]): unknown => {
        calls.push({ kind: "call", method: String(property), args });
        return (value as (...rest: unknown[]) => unknown).apply(object, args);
      };
    },
    set(object, property, value) {
      calls.push({ kind: "set", property: String(property), value });
      return Reflect.set(object, property, value, object);
    },
  });
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
 * case's own, but how a build presents it is the build's, and a label is commonly
 * drawn with a marker or padding around it.
 */
export function drewText(calls: readonly DrawCall[], text: string): boolean {
  const wanted = text.trim().toLowerCase();
  return drawnText(calls).some((drawn) => drawn.toLowerCase().includes(wanted));
}

/**
 * What `specs/instrumentation.md` requires of the surface: the `Expected:` line of
 * the failure every check that reaches for a missing surface lands on, beside what
 * `engine.debug` was found holding instead.
 */
export const SURFACE_REQUIREMENT =
  "the debug and automation surface src/game.ts's initialize returns beside " +
  "its state, as [state, debug], which the engine hands back from engine.debug " +
  "(specs/instrumentation.md)";

/** Fail the running check on `fault`, paired with what the specification requires. */
export function failSurface(fault: string): never {
  return fail(SURFACE_REQUIREMENT, fault);
}

/**
 * A stand-in for the surface a build never returned: every operation on it fails
 * the check that reached for it, with the missing return named.
 *
 * A proxy rather than a hand-written stub, so an operation a check reaches for by
 * name reports the build's missing surface rather than looking like a harness bug.
 *
 * Keys that belong to the MACHINERY rather than to a check are answered with
 * `undefined` instead: awaiting a value probes `then`, and vitest's own error
 * formatting probes symbols and `constructor`. Failing those would replace the
 * verdict with noise from the machinery that was trying to report it.
 */
function missingSurface(reason: string): FoundrySurface {
  return new Proxy({} as FoundrySurface, {
    get: (_target, property): unknown => {
      if (typeof property === "symbol") return undefined;
      if (property === "then" || property === "constructor") return undefined;
      return failSurface(reason);
    },
  });
}

/**
 * The debug surface the BUILD returned beside its state, read off the engine that
 * holds it.
 *
 * This is deliberately a READ and never a construction. The surface is the build's
 * deliverable: its `initialize` returns `[state, debug]`
 * (specs/instrumentation.md), the engine keeps the second element, and
 * `engine.debug` is the only way it reaches a check.
 *
 * A build that returned no pair at all never gets this far, because the engine
 * rejects `initialize` itself and the rejection fails the suite's `beforeEach`
 * with the engine's own message. What IS decided here is a pair whose second
 * element is no surface. That is a fault in the build and not in this harness, so
 * it must not present as one: it is neither thrown from here — which would bury
 * the verdict under the harness's own stack — nor swallowed. {@link missingSurface}
 * stands in and fails, by assertion, at the moment a check first reaches for an
 * operation on it.
 */
function readDebugSurface(
  engine: Engine<FoundryState, FoundrySurface>,
): FoundrySurface {
  const surface: unknown = engine.debug;
  if (typeof surface !== "object" || surface === null) {
    return missingSurface(
      `engine.debug holds ${surface === null ? "null" : typeof surface}, not an object`,
    );
  }
  return surface as FoundrySurface;
}

/**
 * The imperative reading of the raw surface, over the engine that holds the state.
 *
 * A proxy, and a lazy one, for the same reason {@link missingSurface} is: the
 * member is read off the raw surface at the moment a check reaches for it, so a
 * missing surface or a missing operation fails the check that needed it and never
 * the `beforeEach` that built the harness.
 *
 * A reading is called with `engine.state` and its result handed back. A pose is run
 * through `engine.apply`, so the engine stores what it returned and the next
 * frame's `update` receives it; a pose that returns nothing is refused by the
 * engine with a message naming the rule.
 */
function driveSurface(
  engine: Engine<FoundryState, FoundrySurface>,
  raw: FoundrySurface,
): FoundryDriver {
  const readings: readonly string[] = READINGS;
  return new Proxy({} as FoundryDriver, {
    get: (_target, property): unknown => {
      if (typeof property === "symbol") return undefined;
      if (property === "then" || property === "constructor") return undefined;
      const member = (raw as unknown as Record<string, unknown>)[property];
      if (typeof member !== "function") return member;
      const op = member as (
        state: DeepReadonly<FoundryState>,
        ...args: unknown[]
      ) => unknown;
      if (readings.includes(property)) {
        return (): unknown => op.call(raw, engine.state);
      }
      return (...args: unknown[]): void => {
        engine.apply((state) => op.call(raw, state, ...args) as FoundryState);
      };
    },
  });
}

/**
 * Build an engine over a canvas of the harness's own, initialize the build's game,
 * and hand back everything a check reads.
 *
 * The options passed to the factory are the ones the seeded `src/main.ts` passes —
 * the design size, the build's exported `BACKGROUND`, and the touch layout — so one
 * harness serves every build of this case. Everything else the build decided lives
 * inside `src/game.ts`.
 *
 * THE PRODUCED FILES DO NOT RESOLVE HERE, and that is the intended reading. There
 * is no page behind the loader, so every path under `assets/` fails, the engine
 * announces each failure, and `specs/assets.md` requires the build to stay playable
 * on its own geometry when a file does not arrive. A check about a produced file
 * reads the file off disk itself; every other check runs against the fallbacks,
 * which is a strictly harder game to pass.
 */
export async function createHarness(
  options: HarnessOptions = {},
): Promise<Harness> {
  const cssWidth = options.cssWidth ?? STAGE_W;
  const cssHeight = options.cssHeight ?? STAGE_H;
  const dpr = options.dpr ?? 1;

  const canvas = createCanvas(
    Math.round(cssWidth * dpr),
    Math.round(cssHeight * dpr),
  );
  const ctx = canvas.getContext("2d");
  const calls: DrawCall[] = [];
  const recorded = recorder(ctx, calls);
  const element = Object.assign(canvas, {
    style: {} as CSSStyleDeclaration,
    getContext: (): SKRSContext2D => recorded,
  }) as unknown as HTMLCanvasElement;

  const events = new EventTarget();
  const metrics: SurfaceMetrics = {
    cssWidth: () => cssWidth,
    cssHeight: () => cssHeight,
    dpr: () => dpr,
    events: () => events,
  };

  const engine = createEngine<FoundryState, FoundrySurface>({
    canvas: element,
    width: STAGE_W,
    height: STAGE_H,
    game,
    // The build's own stage background, handed to the engine exactly as the seeded
    // `src/main.ts` hands it (specs/overview.md).
    background: BACKGROUND,
    layout: LAYOUT,
    clock: options.clock ?? new ConstantClock(TICK_MS),
    surface: metrics,
  });

  // Subscribed BEFORE `initialize`, which is what makes the game's own loading and
  // its opening cues observable: construction runs no game code, so nothing has
  // happened yet.
  const assetFailures: AssetFailure[] = [];
  const cues: TimedCue[] = [];
  engine.events.on("asset:failed", ({ path, reason }) => {
    assetFailures.push({ path, reason });
  });
  engine.events.on("cue:played", ({ cue, t, gain }) => {
    cues.push({ cue, t, gain, frame: engine.frame().count });
  });

  await engine.initialize();
  const raw = readDebugSurface(engine);
  const debug = driveSurface(engine, raw);

  const key = (type: "keydown" | "keyup", code: string): void => {
    events.dispatchEvent(new KeyEvent(type, code));
  };
  const pointer = (
    type: "pointerdown" | "pointermove" | "pointerup",
    x: number,
    y: number,
  ): void => {
    events.dispatchEvent(new PointerEvt(type, x, y));
  };

  // WHY A DRIVE HANDS THE EVENT LOOP A TURN. `engine.advance(n)` returns a promise,
  // but the `n` frames have already run by the time it does: the engine steps them
  // synchronously and resolves after the last one. So a check that drives a wave to
  // its clear holds this worker's event loop for as long as that simulation takes,
  // and awaiting an already-settled promise does not give the loop back — it queues
  // a microtask, which runs before the loop is reached at all. Vitest reports a
  // running file to its runner over a socket served by that same loop, and a
  // report left unanswered for long enough is abandoned, which spoils the RUN over
  // a check that passed. `step` therefore lets one real turn of the loop through
  // whenever the frames just run have held it for {@link YIELD_AFTER_MS}. Nothing
  // measured here depends on wall-clock time — every check supplies its own clock
  // and the engine reads no other — so the turn changes no reading, and it costs a
  // microsecond, only after a drive has already spent a tenth of a second.
  const YIELD_AFTER_MS = 100;
  let yieldedAt = Date.now();
  const step = async (frames: number): Promise<void> => {
    await engine.advance(frames);
    if (Date.now() - yieldedAt >= YIELD_AFTER_MS) {
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
      yieldedAt = Date.now();
    }
  };

  const harness: Harness = {
    engine,
    get state() {
      return engine.state;
    },
    debug,
    ctx,
    canvas,
    calls,
    cues,
    assetFailures,

    frame: () => engine.frame().count,
    timeMs: () => engine.frame().timeMs,

    snapshot: () => debug.snapshot(),

    advance: (frames) => step(frames),
    advanceSeconds: (s) => step(ticks(s)),

    async until(predicate, untilOptions = {}) {
      const maxFrames = untilOptions.maxFrames ?? 1200;
      const poll = Math.max(1, untilOptions.poll ?? 1);

      let snapshot = debug.snapshot();
      if (predicate(snapshot)) return { hit: true, frames: 0, snapshot };

      let frames = 0;
      while (frames < maxFrames) {
        const chunk = Math.min(poll, maxFrames - frames);
        await step(chunk);
        frames += chunk;
        snapshot = debug.snapshot();
        if (predicate(snapshot)) return { hit: true, frames, snapshot };
      }
      return { hit: false, frames, snapshot };
    },

    async runFor(ms) {
      const controller = new AbortController();
      const running = engine.run({ signal: controller.signal });
      await new Promise((resolve) => setTimeout(resolve, ms));
      controller.abort();
      await running;
    },

    hold: (code) => key("keydown", code),
    release: (code) => key("keyup", code),
    async tap(code) {
      key("keydown", code);
      key("keyup", code);
      await step(1);
    },

    pointerMove: (x, y) => pointer("pointermove", x, y),
    pointerDown: (x, y) => pointer("pointerdown", x, y),
    pointerUp: (x, y) => pointer("pointerup", x, y),

    async frameCalls() {
      calls.length = 0;
      await step(1);
      return [...calls];
    },

    probe(names) {
      const target = raw as unknown as Record<string, unknown>;
      const ops: Record<string, string> = {};
      for (const name of names) ops[name] = typeof target[name];
      return { version: target.version, ops };
    },

    viewport: () => engine.viewport(),
    device: (x, y) => toDevice(engine.viewport(), x, y),
    pixel: (x, y) => harness.pixels([{ x, y }])[0]!,
    pixels(points) {
      const view = engine.viewport();
      return points.map((point) => {
        const at = toDevice(view, point.x, point.y);
        const x = Math.min(Math.max(at.x, 0), Math.max(canvas.width - 1, 0));
        const y = Math.min(Math.max(at.y, 0), Math.max(canvas.height - 1, 0));
        const { data } = ctx.getImageData(x, y, 1, 1);
        return [data[0]!, data[1]!, data[2]!, data[3]!];
      });
    },

    dispose: () => engine.destroy(),
  };

  return harness;
}

/* -------------------------------------------------------------------------- */
/* Evidence capture                                                           */
/* -------------------------------------------------------------------------- */
//
// A review item may declare a `replay` OUTPUT beside its verdict: the frames the
// build itself drew while a check drove it, kept as evidence a reviewer can scrub
// and compare against the reference implementation's. `captureReplay` is how a
// check produces one, and under an engine what it keeps is the ENGINE's own
// draw-command recording, which is the preferred moving evidence.
//
// Four properties are what make it usable, and each is deliberate:
//
// 1. IT RECORDS THE SECTION, NOT THE RUN. The recorder is armed around the
//    caller's scenario and disarmed the moment that scenario returns, so what is
//    kept is the part the check is ABOUT and never the setup that got there.
// 2. IT IS EVIDENCE, NEVER A VERDICT. The scenario's own value comes straight
//    back, and a scenario that THROWS still writes what it had recorded before the
//    failure travels on — a failing check is the one whose replay a reviewer most
//    wants. A recording that cannot be written is reported as an output that never
//    turned up, which is a fact about the host rather than about the build.
// 3. IT WRITES ONLY WHAT THERE IS TO LOOK AT. A capture that closed no frames
//    leaves no file, so the run reports the output absent instead of offering the
//    reviewer a replay of nothing.
// 4. IT COSTS NOTHING WHEN NOBODY IS COLLECTING. Outside a run the media directory
//    is unset and the whole thing is a no-op that still runs the scenario, so a
//    check cannot pass in one place and fail in the other.

/** The environment variable the runner names the media directory in. */
const MEDIA_DIR_ENV = "TCAB_VALIDATION_MEDIA_DIR";

/**
 * The directory this harness sits in, which is the validator project's root.
 *
 * Taken from this module's own URL rather than from the working directory, because
 * it has to name the same directory in both layouts this file lives in: the case's
 * own `validation/<engine>/`, and the `validation/` the runner stages that
 * directory to inside the build's tree.
 */
const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * The directory the runner stages this project to inside the build's tree.
 *
 * A recording is addressed by the STAGED path of the suite that produced it —
 * `validation/firing/in-range.test.ts` — because that is the path the review item's
 * declared script resolves to, and so the only name the case's manifest and the
 * runner both already agree on.
 */
const STAGED_PROJECT_DIR = "validation";

/**
 * The most frames a written recording holds.
 *
 * A recording is one operation log per frame, and a frame of this game is
 * hundreds of operations, so a section a check drives for half a minute of game
 * time runs to tens of megabytes — a file nobody can serve to a reviewer. The cap
 * is what makes `captureReplay` safe to wrap ANY section in: an author arms the
 * recorder around what the check is about and never has to reason about how long
 * that turns out to be.
 */
const MAX_REPLAY_FRAMES = 300;

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
 * DROPPING A FRAME DROPS THE LAST REFERENCE TO WHATEVER ONLY THAT FRAME DREW WITH.
 * The four tables in front of a recording are shared by every frame in it, so
 * carrying them over whole would put operations, states, gradients and images in
 * the file that no surviving frame asks for — dead weight in a document whose whole
 * point is to say each thing once, and the bulk of it in a game that draws
 * procedurally and so repeats almost nothing between frames.
 *
 * Every entry here is reached from a kept frame, and every reference inside one is
 * rewritten as it is reached, transitively. What is deduplicated is the rewritten
 * entry, so an operation two hundred frames issue identically is written once and
 * named two hundred times, and every index a frame carries addresses the table it
 * was interned into.
 *
 * Exported for the suite beside this file: a recording carrying an own field named
 * `__proto__` is one the engine's recorder writes for a build that passes one, and
 * this one has to rewrite it as a field rather than as a prototype.
 */
export function retable(
  recording: Recording,
  frames: readonly RecordedFrame[],
): Recording {
  const images: CapturedImage[] = [];
  const imageAt = new Map<number, number>();
  const resources: Resource[] = [];
  const resourceAt = new Map<number, number>();
  const ops: DrawOp[] = [];
  const opAt = new Map<string, number>();
  const states: DrawState[] = [];
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
    // A recipe's own arguments were encoded when the value was used, so they can
    // only name entries interned before it: rewriting one terminates and cannot
    // re-enter this resource.
    const rebuilt: Resource = {
      make: { method: recipe.make.method, args: recipe.make.args.map(value) },
      then: recipe.then.map(operation),
    };
    const index = resources.length;
    resources.push(rebuilt);
    resourceAt.set(source, index);
    return index;
  };

  const value = (entry: DrawValue): DrawValue => {
    if (Array.isArray(entry)) return entry.map(value);
    if (entry === null || typeof entry !== "object") return entry;
    const record = entry as Record<string, DrawValue>;
    if (typeof record.$img === "number")
      return { $img: takeImage(record.$img) };
    if (typeof record.$res === "number") {
      return { $res: takeResource(record.$res) };
    }
    const rewritten: Record<string, DrawValue> = {};
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

  const operation = (op: DrawOp): DrawOp =>
    op.op === "call"
      ? { op: "call", method: op.method, args: op.args.map(value) }
      : { op: "set", property: op.property, value: value(op.value) };

  const segments = (list: readonly PathSegment[]): PathSegment[] =>
    list.map((segment) => ({
      transform: segment.transform,
      ops: segment.ops.map(operation),
    }));

  const stateOf = (source: number): number => {
    const state = recording.states[source];
    const properties: Record<string, DrawValue> = {};
    for (const [name, held] of Object.entries(state.properties)) {
      Object.defineProperty(properties, name, {
        value: value(held),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return intern(states, stateAt, {
      properties,
      transform: state.transform,
      lineDash: state.lineDash,
      clip: segments(state.clip),
      // A frame inherits the current path along with the clip: a canvas keeps its
      // path across a frame boundary, and applying a clip leaves the clip outline
      // current, so a state that stopped at the clip would leave a bare `fill`
      // among the frame's operations filling that outline.
      path: segments(state.path),
    });
  };

  return {
    ...recording,
    images,
    resources,
    ops,
    states,
    frames: frames.map((frame) => ({
      ...frame,
      state: stateOf(frame.state),
      stack: frame.stack.map(stateOf),
      ops: frame.ops.map((op) =>
        intern(ops, opAt, operation(recording.ops[op])),
      ),
    })),
  };
}

/**
 * A recording of at most {@link MAX_REPLAY_FRAMES} frames, covering the whole of
 * what was captured.
 *
 * An over-long section is THINNED rather than cut short: every nth frame is kept,
 * so the reviewer sees the entire section at a lower frame rate instead of its
 * first — or last — few seconds at the full one. A wave is evidence that the Load
 * walked the maze and died along it, and the deaths are spread across the whole of
 * it.
 *
 * Thinning is legitimate because every frame in a recording is drawable on its own:
 * a frame names the whole of the state it opened with and reaches everything it
 * draws with through tables the recording shares. Each kept frame's `deltaMs` is
 * restated as the time since the frame kept before it, so the deltas still sum to
 * the section's elapsed time and a player pacing itself off them runs at the speed
 * the game really ran at. The frame `count` is left as the host reported it, so a
 * reader can see that frames were skipped rather than being told a smooth lie.
 *
 * The last frame is always kept, whatever the stride lands on: it is the frame the
 * check's sweep stopped at, and the one a reviewer looks at first. Keeping it costs
 * a frame rather than the cap. The stride rounds up, so a section whose length is an
 * exact multiple of the cap strides over exactly that many frames and stops one
 * stride short of the end; the last frame then takes the place of the final strided
 * frame and is measured from where that frame was measured from, which is what keeps
 * the kept deltas summing to the elapsed time.
 */
function thinReplay(recording: Recording): Recording {
  const { frames } = recording;
  if (frames.length <= MAX_REPLAY_FRAMES) return recording;

  const stride = Math.ceil(frames.length / MAX_REPLAY_FRAMES);
  const kept: RecordedFrame[] = [];
  // The moment the section started, so the first kept frame's delta is its own
  // rather than a step measured from nothing.
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
      // Drop the frame it stopped on, and put the moment back to the one before it:
      // a kept frame's restated delta is measured from exactly that moment, so
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
 * A capture that closed no frames writes nothing. There is no picture in it to
 * draw, and a file holding an empty frame list would be collected as an output that
 * turned up — the run would tell the reviewer there is a replay to watch and the
 * player would open on nothing.
 *
 * What lands on disk is gzip rather than raw JSON. A recording is text made almost
 * entirely of numbers, index lists and field names repeated once per frame, which
 * is close to the shape gzip is best at. Every host that serves one declares the
 * encoding, so the browser inflates it before the player sees it.
 *
 * Never throws. A directory that cannot be made or a file that cannot be written
 * says something about the machine the validators ran on, and failing the point
 * over it would blame the build for the host's problem.
 */
function writeReplay(destination: string, recording: Recording): void {
  if (recording.frames.length === 0) return;
  try {
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, gzipSync(JSON.stringify(thinReplay(recording))));
  } catch (error) {
    console.warn(
      `arc foundry: could not write ${destination}: ${String(error)}`,
    );
  }
}

/**
 * Record the frames `scenario` draws and keep them as the review item's `outputId`
 * output, handing back whatever the scenario returned.
 *
 * Wrap the drive, not the arrangement:
 *
 * ```ts
 * const cleared = await captureReplay(h, "wave", () => clearWave(h));
 * assertEqual(cleared.hit, true);
 * ```
 *
 * The assertions stay exactly where they were and read exactly what they did.
 * Capture sits BESIDE them rather than in place of them.
 */
export async function captureReplay<T>(
  h: Harness,
  outputId: string,
  scenario: () => T | Promise<T>,
): Promise<T> {
  const destination = mediaDestination(outputId, "json.gz");
  if (destination === null) return scenario();

  h.engine.startRecording();
  try {
    return await scenario();
  } finally {
    // In a `finally`, so a scenario that failed still leaves its evidence behind.
    writeReplay(destination, h.engine.stopRecording());
  }
}

/**
 * Keep the frame currently on the canvas as the review item's `outputId` output.
 *
 * The companion to {@link captureReplay}, for a point whose evidence is one PICTURE
 * rather than a stretch of motion: which screen the game opened on, what the
 * inspector drew for a selected structure, how the recipe book laid its twelve out.
 *
 * What is written is whatever the last frame that RAN left behind, so call it after
 * the frame that poses the thing under test — an `advance(1)` following the
 * arrangement — and before the assertions, so a check that fails still leaves the
 * picture that shows why.
 */
export function captureStill(h: Harness, outputId: string): void {
  const destination = mediaDestination(outputId, "png");
  if (destination === null) return;
  try {
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, h.canvas.toBuffer("image/png"));
  } catch (error) {
    console.warn(
      `arc foundry: could not write ${destination}: ${String(error)}`,
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Cues                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Record every cue the build plays from now on, stamped with its frame.
 *
 * The engine publishes `cue:played` synchronously from inside `audio.play`, so the
 * handler runs while the frame that played it is still running and
 * `engine.frame().count` is that frame's own number. That is what lets a check
 * assert not merely that a cue sounded but that it sounded on the frame of the kill
 * — which is what tells a build that plays its cue on the right event apart from
 * one that plays it on every frame, or a frame late.
 *
 * The cue's NAME is the engine's to report, so a check names the cue it expects:
 * a build that plays its leak blip on every kill is caught here.
 */
export function watchCues(h: Harness): TimedCue[] {
  const played: TimedCue[] = [];
  h.engine.events.on("cue:played", ({ cue, t, gain }) => {
    played.push({ cue, t, gain, frame: h.engine.frame().count });
  });
  return played;
}

/* -------------------------------------------------------------------------- */
/* Reading a snapshot                                                         */
/* -------------------------------------------------------------------------- */
//
// A snapshot is a plain document, so these are pure functions over one. They exist
// so that a check reads what it is about by name and fails by assertion when the
// thing it named is not there, rather than dereferencing `undefined` a few lines
// later and reporting a `TypeError` where a verdict belonged.

/** The live unit of that id, or a failure naming the id and what was on the yard. */
export function unitById(snapshot: FoundrySnapshot, id: number): UnitView {
  const found = snapshot.units.find((u) => u.id === id);
  assertTruthy(
    found,
    `snapshot().units to carry the unit #${id}; it carries ${
      snapshot.units.length === 0
        ? "none"
        : snapshot.units.map((u) => `#${u.id}`).join(", ")
    }`,
  );
  return found as UnitView;
}

/** The structure of that id, or a failure naming the id and what was on the yard. */
export function structureById(
  snapshot: FoundrySnapshot,
  id: number,
): StructureView {
  const found = snapshot.structures.find((s) => s.id === id);
  assertTruthy(
    found,
    `snapshot().structures to carry the structure #${id}; it carries ${
      snapshot.structures.length === 0
        ? "none"
        : snapshot.structures.map((s) => `#${s.id}`).join(", ")
    }`,
  );
  return found as StructureView;
}

/**
 * The last unit the snapshot reports, which `specs/instrumentation.md` fixes as the
 * one `spawnUnit` just released.
 */
export function lastUnit(snapshot: FoundrySnapshot): UnitView {
  const found = snapshot.units[snapshot.units.length - 1];
  assertTruthy(
    found,
    "snapshot().units to carry the unit spawnUnit just released, as its last " +
      "entry (specs/instrumentation.md); it is empty",
  );
  return found as UnitView;
}

/**
 * The last structure the snapshot reports, which `specs/instrumentation.md` fixes
 * as the one the `place` operation just stood up.
 */
export function lastStructure(snapshot: FoundrySnapshot): StructureView {
  const found = snapshot.structures[snapshot.structures.length - 1];
  assertTruthy(
    found,
    "snapshot().structures to carry the structure just placed, as its last " +
      "entry (specs/instrumentation.md); it is empty",
  );
  return found as StructureView;
}

/** The structure anchored at that tile, or `undefined`. */
export function structureAt(
  snapshot: FoundrySnapshot,
  col: number,
  row: number,
): StructureView | undefined {
  return snapshot.structures.find((s) => s.col === col && s.row === row);
}

/** Every structure that fires: the seven firing base types and the towers. */
export function firingStructures(snapshot: FoundrySnapshot): StructureView[] {
  return snapshot.structures.filter((s) => s.targeting !== null);
}

/**
 * The progress ordering of `specs/pathing.md`, furthest along the chain first.
 *
 * Compared first by the checkpoint the unit is heading for, and then, among units
 * heading for the same one, by the REMAINING route length to it — so a shorter
 * `progress` is further along. This is the ordering `first` and `last` select on,
 * and the tie-break every targeting priority resolves toward.
 */
export function compareAlongChain(a: UnitView, b: UnitView): number {
  if (a.waypointIndex !== b.waypointIndex) {
    return b.waypointIndex - a.waypointIndex;
  }
  return a.progress - b.progress;
}

/** The units of a snapshot, ordered furthest along the chain first. */
export function alongChain(snapshot: FoundrySnapshot): UnitView[] {
  return [...snapshot.units].sort(compareAlongChain);
}

/** The priority `steps` activations of the targeting control past `current`. */
export function targetingAfter(current: Targeting, steps: number): Targeting {
  const at = TARGETING_PRIORITIES.indexOf(current);
  assertTruthy(at >= 0, `a targeting priority; received ${String(current)}`);
  const n = TARGETING_PRIORITIES.length;
  return TARGETING_PRIORITIES[(at + (steps % n) + n) % n]!;
}

/* -------------------------------------------------------------------------- */
/* Compound sequences                                                         */
/* -------------------------------------------------------------------------- */
//
// The surface is atomic by design, so opening a run, emptying the yard, standing
// one structure up and releasing one held unit are each several operations in a
// fixed order. Every one of them lives here, so a suite says what its scenario is
// about in one line and every suite says it the same way. A check that needs only
// part of a sequence calls the operations it needs.
//
// Nothing here poses an outcome. Each of these arranges a precondition through the
// same systems play uses — a placed rock rolls through the real press, a released
// unit walks the real pathfinder — and what happens next comes from advancing the
// real simulation.

/** What a run opens as, and what the yard holds when it opens. */
export interface YardOptions {
  /** The map the run opens on. Defaults to the reset value, `substation`. */
  map?: MapId;
  /** The difficulty. Defaults to the reset value, `medium`. */
  difficulty?: DifficultyId;
  /** The seed every random draw runs off. Defaults to `DEFAULT_SEED`. */
  seed?: number;
  /** The wave units released from now on scale to. */
  wave?: number;
  /** Charge in the bank. */
  charge?: number;
  /** Grid Integrity remaining. */
  integrity?: number;
  /** The refinement level, and with it the roll odds. */
  refinement?: number;
  /** The stamps left in the level's allowance. */
  stamps?: number;
  /** The speed multiplier. Defaults to the reset value, `1`. */
  speed?: number;
}

/**
 * A run at its first build phase, entered the way choosing a difficulty enters
 * one: reset to the title, choose the map and the difficulty, start the run.
 *
 * What it arranges is exactly the opening allocation `specs/campaign.md` states,
 * because `startRun` takes the path confirming the difficulty select takes.
 */
export function openRun(h: Harness, options: YardOptions = {}): void {
  h.debug.reset(
    options.seed === undefined ? undefined : { seed: options.seed },
  );
  if (options.map !== undefined) h.debug.setMap(options.map);
  if (options.difficulty !== undefined)
    h.debug.setDifficulty(options.difficulty);
  h.debug.startRun();
}

/**
 * Everything off the yard: every structure, every live unit, every projectile.
 *
 * The isolation the validator guide asks for, in one line. `clearStructures` also
 * clears the selection and the combine set and recomputes the route, and
 * `clearUnits` kills nothing and leaks nothing, so no bounty is paid and no Grid
 * Integrity is lost by emptying the yard.
 */
export function emptyYard(h: Harness): void {
  h.debug.clearStructures();
  h.debug.clearUnits();
  h.debug.clearProjectiles();
}

/**
 * THE OPENING LINE OF ALMOST EVERY CHECK: a run on an empty yard, posed to the
 * resources and the progress the scenario needs.
 *
 * The order matters and is fixed here so no suite has to think about it: the run
 * opens first, because `startRun` installs the opening allocation over anything
 * posed before it, and the resources are posed after, because a check that wants
 * `500` Charge wants it whatever the run opened with.
 */
export function openYard(h: Harness, options: YardOptions = {}): void {
  openRun(h, options);
  emptyYard(h);
  if (options.wave !== undefined) h.debug.setWave(options.wave);
  if (options.charge !== undefined) h.debug.setCharge(options.charge);
  if (options.integrity !== undefined) h.debug.setIntegrity(options.integrity);
  if (options.refinement !== undefined) {
    h.debug.setRefinement(options.refinement);
  }
  if (options.stamps !== undefined) h.debug.setStamps(options.stamps);
  if (options.speed !== undefined) h.debug.setSpeed(options.speed);
}

/**
 * Put away whatever is held on the cursor, as `back` does.
 *
 * `placeRock` goes through the real continuous-placement path, so it re-arms the
 * press the moment the rock lands, and the panel then shows the held-rock read
 * rather than the inspector — `panelButtons` comes back EMPTY. A check that placed
 * a rock and wants to read the inspector clears the hand first, and `back` is what
 * a player presses to do it.
 *
 * Under this engine the surface carries no key operation, so this is a REAL key
 * event at the engine's surface, and it costs the one frame that delivers the edge.
 * {@link standCandidate} takes the other route the specification leaves open —
 * spending the last stamp, so the press cannot re-arm — and costs no frame at all.
 */
export async function clearHand(h: Harness): Promise<void> {
  await pressAction(h, "back");
}

/** Refill the level's stamp allowance, for a scenario that needs a sixth rock. */
export function refillStamps(h: Harness): void {
  h.debug.setStamps(STAMPS_PER_LEVEL);
}

/* ---- Standing one structure up -------------------------------------------- */
//
// Each of these stands exactly one thing on the yard and hands back its id, read
// off the snapshot's last entry as `specs/instrumentation.md` fixes it. Each
// asserts the placement landed, so a scenario that asked for an anchor the
// never-seal rule refuses fails where it asked rather than several frames later
// with a structure it never got.

/** The id the structure a `place` operation just appended carries. */
function placed(
  snapshot: FoundrySnapshot,
  before: number,
  what: string,
): number {
  assertTruthy(
    snapshot.structures.length === before + 1,
    `${what} to stand one structure up and append it to snapshot().structures ` +
      `(specs/instrumentation.md); the yard went from ${before} structures to ` +
      `${snapshot.structures.length}`,
  );
  return lastStructure(snapshot).id;
}

/** A permanent firing component of that type and quality, at that anchor. */
export function standComponent(
  h: Harness,
  type: ComponentType,
  quality: Tier,
  col: number,
  row: number,
): number {
  const before = h.snapshot().structures.length;
  h.debug.placeComponent(type, quality, col, row);
  return placed(
    h.snapshot(),
    before,
    `placeComponent(${type}, ${quality}, ${col}, ${row})`,
  );
}

/** A combination tower at that anchor, landed at level `0` and raised to `level`. */
export function standCombo(
  h: Harness,
  combo: ComboId,
  col: number,
  row: number,
  level = 0,
): number {
  const before = h.snapshot().structures.length;
  h.debug.placeCombo(combo, col, row);
  const id = placed(
    h.snapshot(),
    before,
    `placeCombo(${combo}, ${col}, ${row})`,
  );
  if (level !== 0) h.debug.setComboLevel(id, level);
  return id;
}

/** An inert blocker at that anchor: a wall with no head and no glow. */
export function standBlocker(h: Harness, col: number, row: number): number {
  const before = h.snapshot().structures.length;
  h.debug.placeBlocker(col, row);
  return placed(h.snapshot(), before, `placeBlocker(${col}, ${row})`);
}

/**
 * A candidate of a chosen type and quality, dropped through the real press.
 *
 * The roll is armed first, so the rock that lands rolls exactly what the scenario
 * asked for; the drop itself still goes through the placement path, so it spends a
 * stamp and is refused exactly where a pointer press would be.
 *
 * THE HAND IS LEFT EMPTY WITHOUT PRESSING ANYTHING. The press re-arms itself on a
 * successful drop only while the allowance still permits, so this spends the LAST
 * stamp of the allowance and then puts the allowance back where it would have been
 * — one below where it started. Nothing is pressed, no frame runs, and the yard the
 * check reads is the one the drop left. `setStamps` sets the allowance and touches
 * nothing else (`specs/instrumentation.md`), so restoring it cannot re-arm the hand
 * the drop already released.
 */
export function standCandidate(
  h: Harness,
  type: ComponentType,
  quality: Tier,
  col: number,
  row: number,
): number {
  const opening = h.snapshot();
  const before = opening.structures.length;
  const stamps = opening.stampsLeft;
  assertTruthy(
    stamps > 0,
    `the level's stamp allowance to have a stamp left for a rock at ` +
      `(${col}, ${row}); stampsLeft is ${stamps}`,
  );
  h.debug.setStamps(1);
  h.debug.setNextRoll(type, quality);
  h.debug.placeRock(col, row);
  h.debug.clearNextRoll();
  h.debug.setStamps(stamps - 1);
  return placed(
    h.snapshot(),
    before,
    `placeRock(${col}, ${row}) armed to roll ${type} at quality ${quality}`,
  );
}

/** Select a structure, as a pointer press on it would. */
export function selectStructure(h: Harness, id: number): void {
  h.debug.select(id);
}

/* ---- Releasing one unit --------------------------------------------------- */

/**
 * How a released unit is posed, one faculty at a time.
 *
 * Isolation reaches inside the entity: a check about a burn's damage wants a unit
 * that burns and does not walk, and a check about a slow's expiry wants one that
 * walks and carries a slow. So each faculty a scenario must hold is its own field
 * here, and every one it leaves out is left exactly as the spawner set it.
 */
export interface UnitPose {
  /** A logical position to stand it at. */
  at?: Point;
  /** Or the center of a tile to stand it at. */
  tile?: { col: number; row: number };
  /** The checkpoint it heads for, `1`–`7`, where `7` is the collector. */
  waypoint?: number;
  /** Its current health, at least `1` and at most its maximum. */
  hp?: number;
  /** A slow, applied through the rule `specs/enemies.md` fixes. */
  slow?: { amount: number; seconds: number };
  /** A burn, applied through the same rule, credited to no structure. */
  burn?: { dps: number; seconds: number };
  /** Travel held, and nothing else held with it. */
  frozen?: boolean;
}

/**
 * One unit of that type at the map's entry, scaled to the current wave, posed.
 *
 * `spawnUnit` releases through the real spawner and so puts the run into a live
 * wave whose spawn schedule is empty: the units on the yard are exactly the ones
 * released here and nothing else arrives. That wave clears the ordinary way, when
 * every one of them has died or leaked, and clearing it pays the ordinary wave-clear
 * bonus — so a check reading `charge` after a kill either keeps a bystander alive
 * with {@link holdWaveOpen} or expects the bounty and the bonus.
 *
 * The poses are applied in the order `specs/instrumentation.md` leaves them
 * independent in: the checkpoint first, because setting it moves the unit nowhere,
 * then the position, then the health, then the statuses, and the travel hold last so
 * nothing after it has to think about whether the unit moved.
 */
export function releaseUnit(
  h: Harness,
  type: SpawnType,
  pose: UnitPose = {},
): number {
  const before = h.snapshot().units.length;
  h.debug.spawnUnit(type);
  const after = h.snapshot();
  assertTruthy(
    after.units.length === before + 1,
    `spawnUnit(${type}) to release one unit and append it to snapshot().units ` +
      `(specs/instrumentation.md); the yard went from ${before} units to ` +
      `${after.units.length}`,
  );
  const id = lastUnit(after).id;

  if (pose.waypoint !== undefined) h.debug.setUnitWaypoint(id, pose.waypoint);
  const at =
    pose.at ??
    (pose.tile === undefined
      ? undefined
      : tileCenter(pose.tile.col, pose.tile.row));
  if (at !== undefined) h.debug.setUnitPosition(id, at.x, at.y);
  if (pose.hp !== undefined) h.debug.setUnitHp(id, pose.hp);
  if (pose.slow !== undefined) {
    h.debug.setUnitSlow(id, pose.slow.amount, pose.slow.seconds);
  }
  if (pose.burn !== undefined) {
    h.debug.setUnitBurn(id, pose.burn.dps, pose.burn.seconds);
  }
  if (pose.frozen !== undefined) h.debug.setUnitFrozen(id, pose.frozen);
  return id;
}

/**
 * One unit standing still at a chosen point, keeping every faculty but travel.
 *
 * The workhorse of this project. A held unit is targetable, it takes damage, its
 * burn ticks, its slow runs down and expires, and its body holds the position it
 * was posed at however long the scenario runs — so a check about damage, about a
 * status effect, or about which unit a priority picks reads a number that moved for
 * exactly one reason.
 */
export function parkUnit(
  h: Harness,
  type: SpawnType,
  at: Point,
  pose: Omit<UnitPose, "at" | "tile" | "frozen"> = {},
): number {
  return releaseUnit(h, type, { ...pose, at, frozen: true });
}

/**
 * A held unit at the map's entry that nothing is shooting at, so the live wave
 * `spawnUnit` opened cannot clear while the check is reading.
 *
 * Clearing a wave pays the wave-clear bonus, and a bonus landing in the middle of a
 * check that is reading `charge` would be indistinguishable from the bounty it was
 * measuring. Keeping one unit alive is what separates them.
 */
export function holdWaveOpen(h: Harness): number {
  return releaseUnit(h, "mote", { frozen: true });
}

/**
 * Commit the level's harvest, which is what starts the wave.
 *
 * There is no send control (`specs/campaign.md`): a wave begins when a candidate is
 * kept, downgraded, or folded into a combine. So this stands one candidate at the
 * anchor given and keeps it, and the wave the level composed starts on the next
 * advance. The component it leaves standing is the one the harvest produced, and its
 * id comes back.
 */
export function startWave(
  h: Harness,
  type: ComponentType,
  quality: Tier,
  col: number,
  row: number,
): number {
  const candidate = standCandidate(h, type, quality, col, row);
  h.debug.keep(candidate);
  return candidate;
}

/* -------------------------------------------------------------------------- */
/* Controls                                                                   */
/* -------------------------------------------------------------------------- */
//
// A control is found by the action it carries rather than by where it was drawn,
// because `specs/hud.md` fixes each menu's content and navigation and leaves its
// layout to the build. The rectangle a reading reports is the control's real hit
// region, so pressing the center of a reported, non-disabled rectangle activates it
// — which is how a check operates the game the way a player does without knowing
// anything about the build's layout.

/** A rectangle a reading reports. */
export interface ControlRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The center of a reported control rectangle. */
export function controlCenter(rect: ControlRect): Point {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/**
 * A press and a release at a logical point: one click, and the frame that delivers
 * it.
 *
 * The pointer is moved onto the point before the press, because that is what a real
 * pointer does and because a build is entitled to hover before it commits. The frame
 * runs between the press and the release, so the game reads the press edge where it
 * happened; the release commits nothing (`specs/controls.md`) and is delivered after,
 * leaving the pointer up for whatever comes next.
 */
export async function clickAt(h: Harness, x: number, y: number): Promise<void> {
  h.pointerMove(x, y);
  h.pointerDown(x, y);
  await h.advance(1);
  h.pointerUp(x, y);
}

/** A click at the center of a tile. */
export function clickTile(h: Harness, col: number, row: number): Promise<void> {
  const point = tileCenter(col, row);
  return clickAt(h, point.x, point.y);
}

/** A click at the center of a structure anchored at that tile. */
export function clickStructure(
  h: Harness,
  col: number,
  row: number,
): Promise<void> {
  const point = structureCenter(col, row);
  return clickAt(h, point.x, point.y);
}

/** A click at the center of a reported control rectangle. */
export function clickControl(h: Harness, rect: ControlRect): Promise<void> {
  const point = controlCenter(rect);
  return clickAt(h, point.x, point.y);
}

function describeControls(drawn: readonly { action: string }[]): string {
  return drawn.length === 0
    ? "none"
    : drawn.map((c) => `\`${c.action}\``).join(", ");
}

/** The inspector's control carrying that action, or a failure naming what was drawn. */
export function panelControl(
  h: Harness,
  action: PanelAction,
  label?: string,
): PanelButton {
  const drawn = h.debug.panelButtons();
  const found = drawn.find(
    (b) => b.action === action && (label === undefined || b.label === label),
  );
  assertTruthy(
    found,
    `panelButtons() to carry a \`${action}\` control${
      label === undefined ? "" : ` labelled ${label}`
    } (specs/instrumentation.md); it carries ${describeControls(drawn)}`,
  );
  return found as PanelButton;
}

/** The panel's own control carrying that action, or a failure naming what was drawn. */
export function pressControl(h: Harness, action: PressAction): PressButton {
  const drawn = h.debug.pressControls();
  const found = drawn.find((c) => c.action === action);
  assertTruthy(
    found,
    `pressControls() to carry a \`${action}\` control ` +
      `(specs/instrumentation.md); it carries ${describeControls(drawn)}`,
  );
  return found as PressButton;
}

/** The menu choice carrying that action, or a failure naming what was drawn. */
export function menuControl(h: Harness, action: MenuAction): MenuButton {
  const drawn = h.debug.menuButtons();
  const found = drawn.find((b) => b.action === action);
  assertTruthy(
    found,
    `menuButtons() to carry a \`${action}\` choice (specs/instrumentation.md); ` +
      `it carries ${describeControls(drawn)}`,
  );
  return found as MenuButton;
}

/** The status-bar control carrying that action, or a failure naming what was drawn. */
export function statusControl(h: Harness, action: StatusAction): StatusControl {
  const drawn = h.debug.statusControls();
  const found = drawn.find((c) => c.action === action);
  assertTruthy(
    found,
    `statusControls() to carry a \`${action}\` control ` +
      `(specs/instrumentation.md); it carries ${describeControls(drawn)}`,
  );
  return found as StatusControl;
}

/** Find the inspector's control by action and press its center. */
export function pressPanel(
  h: Harness,
  action: PanelAction,
  label?: string,
): Promise<void> {
  return clickControl(h, panelControl(h, action, label));
}

/** Find the panel's own control by action and press its center. */
export function pressPressControl(
  h: Harness,
  action: PressAction,
): Promise<void> {
  return clickControl(h, pressControl(h, action));
}

/** Find the menu choice by action and press its center. */
export function pressMenu(h: Harness, action: MenuAction): Promise<void> {
  return clickControl(h, menuControl(h, action));
}

/** Find the status-bar control by action and press its center. */
export function pressStatus(h: Harness, action: StatusAction): Promise<void> {
  return clickControl(h, statusControl(h, action));
}

/**
 * Fire one action from the keyboard, through the engine's own input path.
 *
 * A real press and release of the key `specs/controls.md` binds the action to,
 * dispatched at the engine's surface, and the one frame that delivers the edge. The
 * engine discards an edge nothing consumed by the end of the frame it was armed in,
 * so the frame is what makes the press reach the game.
 *
 * Every action but `modify` is read as a press edge, so this fires it exactly once.
 * `modify` is read as a level and is held with {@link withModify} instead.
 */
export function pressAction(h: Harness, action: ActionName): Promise<void> {
  return h.tap(keyFor(action));
}

/**
 * Run `body` with the `modify` action held, as a player holding Shift does.
 *
 * `modify` is read as a level rather than as an edge: what the game reads is whether
 * its key is down at the moment it reads it, so it modifies whatever act it is held
 * across — which means `body` must run the frame that resolves the press. The
 * release is in a `finally`, so a failing body cannot leave the key down under the
 * check that runs next.
 */
export async function withModify<T>(
  h: Harness,
  body: () => T | Promise<T>,
): Promise<T> {
  const key = keyFor("modify");
  h.hold(key);
  try {
    return await body();
  } finally {
    h.release(key);
  }
}

/**
 * Show a menu screen and hand back the choices it presents, in order.
 *
 * `setScreen` moves to the screen exactly as reaching it in play does, and
 * `menuButtons` is a pure reading of the state, so the choices come back without the
 * check advancing anything.
 */
export function openMenu(h: Harness, screen: Screen): MenuButton[] {
  h.debug.setScreen(screen);
  return h.debug.menuButtons();
}

/**
 * Open or close a read-only overlay, and confirm the snapshot agrees.
 *
 * Both overlays are inert (`specs/hud.md`): opening one changes what is drawn and
 * nothing else, so this is an arrangement rather than an act.
 */
export function setOverlay(
  h: Harness,
  overlay: OverlayName,
  open: boolean,
): void {
  h.debug.setOverlay(overlay, open);
}

/* -------------------------------------------------------------------------- */
/* Colour, read off the rendered canvas                                       */
/* -------------------------------------------------------------------------- */
//
// The palette is the build's own (`specs/overview.md`), so nothing here knows a
// colour: the samplers compare what was painted against what else was painted, or
// against the background the build declared.

/** A sampled colour, each channel 0–255. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * The rendered colour at a logical point, averaged over a small cluster.
 *
 * The centre pixel plus four neighbours `spread` units out, so one stray
 * anti-aliased pixel cannot swing the reading. Sample at least two logical pixels
 * inside an edge: an edge is anti-aliased and blends toward whatever is behind it,
 * and only an interior pixel is the fill.
 */
export function sampleColor(h: Harness, x: number, y: number, spread = 2): Rgb {
  const points: Point[] = [
    { x, y },
    { x: x + spread, y },
    { x: x - spread, y },
    { x, y: y + spread },
    { x, y: y - spread },
  ];
  let r = 0;
  let g = 0;
  let b = 0;
  for (const [pr, pg, pb] of h.pixels(points)) {
    r += pr;
    g += pg;
    b += pb;
  }
  return { r: r / points.length, g: g / points.length, b: b / points.length };
}

/** Euclidean distance between two colours, 0 to about 441. */
export function colorDistance(a: Rgb, b: Rgb): number {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

/** A colour's luminance. */
export function luminance(c: Rgb): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/**
 * The build's exported `BACKGROUND`, rasterized: the colour the engine clears the
 * whole canvas to each frame, read back through the same canvas implementation the
 * harness samples with, so a pixel the game never drew over compares against it
 * exactly.
 *
 * The fill is repeated rather than applied once so a translucent colour reads as the
 * engine leaves it: the engine composites its clear over the previous frame every
 * frame, which converges on the colour's own channels, and a single fill over a
 * transparent canvas would not.
 */
export function clearColor(): Rgb {
  const probe = createCanvas(1, 1);
  const ctx = probe.getContext("2d");
  ctx.fillStyle = BACKGROUND;
  for (let i = 0; i < 255; i += 1) ctx.fillRect(0, 0, 1, 1);
  const { data } = ctx.getImageData(0, 0, 1, 1);
  return { r: data[0]!, g: data[1]!, b: data[2]! };
}

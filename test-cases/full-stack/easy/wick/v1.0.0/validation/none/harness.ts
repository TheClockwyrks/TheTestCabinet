// Wick — the case's half of the validator harness. CASE-PROVIDED.
//
// Every check in this suite is an ordinary vitest test that drives the built site
// IN A REAL BROWSER. There is nothing to import: an engineless run seeds no
// `src/` at all, so the build wrote its own frame loop, its own canvas fit, its
// own keyboard, its own audio with its two loops, its own loading of the produced
// files, and its own `window.__wick` — and the only place all of that exists is
// a page that has loaded the bundle. So the project serves `dist/`, loads it in
// Chromium, and reaches the game the way anything reaches it: over the surface
// `specs/instrumentation.md` told the build to install.
//
// THE MACHINERY THAT DOES THAT IS NOT WICK'S. Serving the build, connecting to
// the one browser, opening a page per harness, injecting the draw-command
// recorder and the counting audio probe, bracketing each driven frame around one
// `step(1)` of the build's surface, reading pixels and draw calls back out, and
// writing the evidence a review point declares — every engineless case needs
// exactly that, and it lives once, in `@clockwyrks/case-harness`, staged beside
// this file as `./case-harness/`. What is left here is what is genuinely Wick's:
// the shape of its snapshot, the operations `specs/instrumentation.md` requires,
// the audio probe that NAMES a cue, the camera's arithmetic, and the isolated
// night a scenario poses.
//
// The seam is one call. `createCaseHarness` takes the case's TYPES as type
// arguments and the case's VALUES as one object, and hands back the machinery
// with Wick's names and Wick's types on it. `createHarness` below wraps what
// comes back so that every drive also reads the named-cue log, and the suites
// next door import `createHarness`, `captureReplay`, `isolate`, `placeEnemy` and
// the rest from `../harness` without knowing which half of the machinery each
// belongs to.
//
// A FRAME IS THE UNIT. `specs/instrumentation.md` has `step(ticks)` run whole
// frames of the build's loop, each a tick of `TICK_DT` (`1/60`) seconds on
// `playing` and no tick on any other screen, so a count of stepped frames
// converts to simulated seconds with no rounding. Every duration in this project
// is written as a frame count for that reason, and `advance(seconds)` on the
// surface is the one operation that poses a partial frame.
//
// EVERYTHING CROSSING INTO THE PAGE IS ASYNC. That is the whole of the difference
// between a suite here and its counterpart under an engine: `await h.snapshot()`
// rather than reading the state in process, `await h.debug.setHp(40)` rather
// than `debug.setHp(state, 40)`. The scenarios, the tolerances, and the
// assertions are the same ones, because they are the case's rather than the
// runtime's.

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "playwright";
import {
  createCaseHarness,
  imageDraws,
  mouseGlide,
  mousePress,
  mouseRelease,
  touchGlide,
  touchPress,
  touchRelease,
  type DrawCall,
  type Harness as BaseHarness,
  type HarnessOptions,
  type ImageDraw,
  type UntilOptions,
  type UntilResult as BaseUntilResult,
} from "./case-harness/index";
import { fail } from "./assert";
import {
  BINDINGS,
  BLIT_TOL,
  CUE_NAMES,
  HANDLE,
  OVERLAY_KEY,
  REQUIRED_OPS,
  STAGE_CX,
  STAGE_CY,
  STAGE_H,
  STAGE_W,
  SWITCH_NAMES,
  TICK_HZ,
  TICK_MS,
  UNBOUND_KEY,
  WHEEL_ROW,
  type Action,
  type CanvasSize,
  type EnemyId,
  type EvolutionId,
  type Facing,
  type GemTier,
  type NextDrop,
  type OfferId,
  type PassiveId,
  type PassiveLevels,
  type PickupKind,
  type ProjectileWeapon,
  type PuddleWeapon,
  type ScreenName,
  type SwitchName,
  type WeaponId,
  type ZoneKind,
} from "./constants";
import {
  BASE_MAX_HP,
  BASE_WEAPON_IDS,
  ENEMY_FIELDS,
  evolutionOf,
  GEM_FIELDS,
  HIT_ENTRY_FIELDS,
  MAX_WEAPON_LEVEL,
  MOVE_SPEED,
  PASSIVE_IDS,
  PASSIVE_SLOT_FIELDS,
  PASSIVE_SLOTS,
  PASSIVES,
  PICKUP_FIELDS,
  PICKUP_RADIUS,
  PLAYER_FIELDS,
  PROJECTILE_FIELDS,
  RUN_FIELDS,
  SNAPSHOT_FIELDS,
  WEAPON_SLOT_FIELDS,
  WEAPON_SLOTS,
  xpToNext,
  ZONE_FIELDS,
} from "./constants";
import { drawnText } from "./case-harness/index";

/* -------------------------------------------------------------------------- */
/* The contract the build owes                                                */
/* -------------------------------------------------------------------------- */
//
// The snapshot, as `specs/instrumentation.md` documents it under "Snapshot
// shape": "The shape is fixed, and every field is present whatever the screen."
// Declared here from that document and never imported from a build: a validator
// that took its types from the build under test would compile against whatever
// the build chose to report.

/** The lamplighter, as `run.player` reports it. */
export interface PlayerView {
  x: number;
  y: number;
  facing: Facing;
  hp: number;
}

/** One held weapon: "`weapons: [{ id, level, cooldown }]`". */
export interface WeaponSlotView {
  id: WeaponId;
  level: number;
  /** The seconds until it next fires. */
  cooldown: number;
}

/** One held passive: "`passives: [{ id, level }]`". */
export interface PassiveSlotView {
  id: PassiveId;
  level: number;
}

/** One live enemy, as `run.enemies` reports it. */
export interface EnemyView {
  id: number;
  type: EnemyId;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  /** The unit heading it moves along. */
  heading: { x: number; y: number };
  /** Seconds since it spawned. */
  age: number;
  /** Seconds until it can hit the lamplighter again. */
  contactCooldown: number;
}

/** One re-hit entry: an enemy hit and "the seconds until each may be hit again". */
export interface HitEntry {
  enemy: number;
  cooldown: number;
}

/** One projectile, as `run.projectiles` reports it. */
export interface ProjectileView {
  id: number;
  weapon: WeaponId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  ax: number;
  ay: number;
  radius: number;
  /** The damage per hit the shape carries. */
  damage: number;
  /** Seconds left. */
  ttl: number;
  pierce: number;
  hits: HitEntry[];
}

/** One zone, as `run.zones` reports it. `width` and `height` "appear on a slash alone". */
export interface ZoneView {
  id: number;
  weapon: WeaponId;
  kind: ZoneKind;
  /** The shape's center. */
  x: number;
  y: number;
  /** A strike's is its `area`, a burst's its Flare radius, a slash's `0`. */
  radius: number;
  width?: number;
  height?: number;
  damage: number;
  /** "`null` for a zone that never expires." */
  ttl: number | null;
  hits: HitEntry[];
}

/** One gem: "`gems: [{ id, tier, x, y, attracted }]`". */
export interface GemView {
  id: number;
  tier: GemTier;
  x: number;
  y: number;
  attracted: boolean;
}

/** One pickup: "`pickups: [{ id, kind, x, y }]`". */
export interface PickupView {
  id: number;
  kind: PickupKind;
  x: number;
  y: number;
}

/** What the open chest overlay reports, or `null`. */
export type ChestResult =
  | { kind: "evolve"; weapon: EvolutionId }
  | { kind: "level"; item: OfferId; level: number }
  | { kind: "heal" }
  | null;

/** The `run` object of a snapshot. */
export interface RunView {
  tick: number;
  /** `tick / TICK_HZ`, seconds. */
  time: number;
  level: number;
  xp: number;
  /** `XP_BASE + XP_STEP × (level − 1)`. */
  xpToNext: number;
  kills: number;
  player: PlayerView;
  /** Seconds left of the lamplighter's hurt flash. */
  hurtFlash: number;
  maxHp: number;
  armor: number;
  /** Units per second. */
  moveSpeed: number;
  pickupRadius: number;
  weapons: WeaponSlotView[];
  passives: PassiveSlotView[];
  enemies: EnemyView[];
  projectiles: ProjectileView[];
  zones: ZoneView[];
  gems: GemView[];
  pickups: PickupView[];
  /** The open level-up overlay's offers. */
  offers: OfferId[];
  /** The candidate pool on `levelup`, else empty. */
  pool: OfferId[];
  /** What `setNextOffers` queued. */
  nextOffers: OfferId[] | null;
  pendingLevelUps: number;
  chestResult: ChestResult;
  spawnTimer: number;
  /** `min(19, floor(time / SPAWN_WINDOW))`. */
  spawnWindow: number;
  /** Run-clock seconds, ascending. */
  firedEvents: number[];
  aliveCommons: number;
  nextId: number;
  /** The posed outcomes, each `null` while none is posed. */
  nextSpawnAngle: number | null;
  nextSwarmAngle: number | null;
  nextPuddleOffset: { x: number; y: number } | null;
  nextStrikeTarget: number | null;
  nextChestItem: string | null;
  nextDrop: NextDrop | null;
}

/**
 * The state a snapshot reports, as `specs/instrumentation.md` documents it under
 * "Snapshot shape".
 */
export interface WickSnapshot {
  version: number;
  screen: ScreenName;
  menuIndex: number;
  /** The tab the almanac is showing; `0` on every other screen. */
  almanacTab: number;
  /** The almanac list's first visible row; `0` on every other screen. */
  almanacScroll: number;
  /** Whether the frame loop advances the simulation from the wall clock. */
  autoStep: boolean;
  spawning: boolean;
  events: boolean;
  despawning: boolean;
  enemyMotion: boolean;
  enemyContact: boolean;
  weaponFire: boolean;
  effectMotion: boolean;
  drops: boolean;
  progression: boolean;
  run: RunView;
  muted: boolean;
  /** Frame time waiting for the next tick, in seconds. */
  accumulator: number;
  /** Accumulated simulation time, in seconds. */
  simTime: number;
}

/**
 * One rectangle of a menu, "in stage coordinates, `0` to `STAGE_W` across and
 * `0` to `STAGE_H` down, which are the coordinates the pointer is read in"
 * (specs/instrumentation.md — `menuRects`).
 */
export interface RectView {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The operations a check poses the night through. Every one crosses into the
 * page, so every one answers a promise; an argument outside its domain REJECTS,
 * which is the specification's "the call throws" seen from this side.
 *
 * `version` is a plain property of the surface rather than an operation, so it
 * is not on this interface: the proxy behind `h.debug` forwards every name as a
 * call, and a check reads the version through {@link surfaceVersion} instead.
 */
export interface WickDebugApi {
  /** Take the game off real time, and give it back. Changes no game state. */
  setAutoStep(auto: boolean): Promise<void>;
  /**
   * Run whole frames of the build's loop, a tick each on `playing`.
   *
   * Prefer {@link Harness.step}, which brackets each frame for the recorder,
   * the audio probes, and the frame counter. This is here for the check that
   * reflects the surface.
   */
  step(ticks?: number): Promise<void>;
  /** Run one frame worth `seconds` of delta time, through the accumulator. */
  advance(seconds: number): Promise<void>;
  /** Restore every declared field to its title-screen value. */
  reset(): Promise<void>;
  /** A pure read of the running game. */
  snapshot(): Promise<WickSnapshot>;
  /** Set `screen`, with every menu index at `0`; nothing else changes. */
  setScreen(name: ScreenName): Promise<void>;
  /**
   * The current screen's vertical menu, in menu order; empty on a screen with
   * no menu. On `almanac` these are the visible entry rows.
   *
   * Prefer {@link menuRects}, which types what comes back over the wire.
   */
  menuRects(): Promise<RectView[]>;
  /**
   * The almanac's tab bar, in `ALMANAC_TABS` order; empty on every other
   * screen. Prefer {@link tabRects}.
   */
  tabRects(): Promise<RectView[]>;
  /** On `levelup`, accept the offer at `index`. */
  choose(index: number): Promise<void>;
  setSpawning(on: boolean): Promise<void>;
  setEvents(on: boolean): Promise<void>;
  setDespawning(on: boolean): Promise<void>;
  setEnemyMotion(on: boolean): Promise<void>;
  setEnemyContact(on: boolean): Promise<void>;
  setWeaponFire(on: boolean): Promise<void>;
  setEffectMotion(on: boolean): Promise<void>;
  /** Hold the drop a death leaves: a gem, a bread or draft, a chest. */
  setDrops(on: boolean): Promise<void>;
  /** Hold the level a gain earns; `xp` still rises while it is off. */
  setProgression(on: boolean): Promise<void>;
  /** Set `tick`, `0` to `MAX_POSED_TICK`; nothing else changes. */
  setTick(tick: number): Promise<void>;
  setSpawnTimer(seconds: number): Promise<void>;
  /** Pose the angle the next spawn point is drawn at, `0` up to `360`. */
  setNextSpawnAngle(degrees: number): Promise<void>;
  /** Pose the direction of the next gnat swarm, `0` up to `360`. */
  setNextSwarmAngle(degrees: number): Promise<void>;
  /** Pose where the next firing's first puddle lands, about the lamplighter. */
  setNextPuddleOffset(dx: number, dy: number): Promise<void>;
  /** Pose the enemy the next Spark firing's first strike lands on. */
  setNextStrikeTarget(id: number): Promise<void>;
  /** Pose the item the next chest levels, when its level rule applies. */
  setNextChestItem(id: string): Promise<void>;
  /** Pose what the next common kill drops in place of its roll. */
  setNextDrop(kind: NextDrop): Promise<void>;
  setPlayerPosition(x: number, y: number): Promise<void>;
  setFacing(facing: Facing): Promise<void>;
  /** Set `hp`, at most `maxHp`; at or below `0` ends the run on the next tick. */
  setHp(hp: number): Promise<void>;
  setLevel(level: number): Promise<void>;
  setXp(xp: number): Promise<void>;
  setKills(kills: number): Promise<void>;
  setPendingLevelUps(count: number): Promise<void>;
  /** Queue `1` to `OFFER_COUNT` distinct ids for the next overlay. */
  setNextOffers(ids: readonly OfferId[]): Promise<void>;
  /** Put weapon `id` at `level` in `slot`, `0` to `weapons.length`. */
  setWeapon(slot: number, id: WeaponId, level: number): Promise<void>;
  setWeaponCooldown(slot: number, seconds: number): Promise<void>;
  removeWeapon(slot: number): Promise<void>;
  /** Put passive `id` at `level` in `slot`, `0` to `passives.length`. */
  setPassive(slot: number, id: PassiveId, level: number): Promise<void>;
  removePassive(slot: number): Promise<void>;
  /** Spawn one enemy through the real spawn path. On `playing` and `paused`. */
  spawnEnemy(type: EnemyId, x: number, y: number): Promise<void>;
  setEnemyPosition(id: number, x: number, y: number): Promise<void>;
  /** Set an enemy's `hp`, above `0` and at most its `maxHp`. */
  setEnemyHp(id: number, hp: number): Promise<void>;
  /** Set an enemy's heading to the unit vector of `(hx, hy)`. */
  setEnemyHeading(id: number, hx: number, hy: number): Promise<void>;
  setEnemyAge(id: number, seconds: number): Promise<void>;
  setEnemyContactCooldown(id: number, seconds: number): Promise<void>;
  /** Remove one enemy: nothing drops, nothing counts, no cue. */
  removeEnemy(id: number): Promise<void>;
  clearEnemies(): Promise<void>;
  /** Add one projectile with the figures its weapon would give one fired now. */
  spawnProjectile(
    weapon: ProjectileWeapon,
    x: number,
    y: number,
    vx: number,
    vy: number,
    pierce: number,
  ): Promise<void>;
  clearProjectiles(): Promise<void>;
  /** Add one puddle zone with the figures its weapon would give one now. */
  spawnPuddle(weapon: PuddleWeapon, x: number, y: number): Promise<void>;
  /** Remove every zone; an aura or Chandelier set still held returns next tick. */
  clearZones(): Promise<void>;
  spawnGem(tier: GemTier, x: number, y: number): Promise<void>;
  setGemAttracted(id: number, attracted: boolean): Promise<void>;
  clearGems(): Promise<void>;
  spawnPickup(kind: PickupKind, x: number, y: number): Promise<void>;
  clearPickups(): Promise<void>;
}

/* -------------------------------------------------------------------------- */
/* The harness, bound to this case                                            */
/* -------------------------------------------------------------------------- */

/**
 * The page global this case's own audio probe installs itself on.
 *
 * The HARNESS's instrumentation, injected by `audio-init.js` before a line of
 * the build runs; no seeded specification names it. The shared kit's probe at
 * `__tcabAudio` counts sounds, which is enough for a case whose audio points ask
 * whether a frame sounded. Wick's ask WHICH of fifteen cues sounded and which of
 * two loops is running, so a second probe names each sound by the produced file
 * it played (`specs/assets.md` fixes the file per cue), and every drive below
 * reads its log.
 */
export const AUDIO_PROBE_GLOBAL = "__wickAudio";

/**
 * How long an ARMED {@link createHarness} waits for the build's fifteen cue
 * files to finish decoding before it gives up waiting.
 *
 * A build decodes its audio asynchronously, and a scenario that raised an event
 * before its cue's clip arrived would read silence from a build that was
 * simply still starting up. The wait is a poll that returns the instant the
 * fifteenth file lands, so a healthy build pays nothing; a build that never
 * decodes anything spends the ceiling once per harness and then fails its cue
 * points on their own terms. Only a harness that asked to be armed waits: one
 * handed no gesture can open no audio, and would spend the whole ceiling for a
 * check that was never going to listen.
 */
export const AUDIO_LOAD_TIMEOUT_MS = 15_000;

/**
 * The shared harness, with Wick's snapshot, Wick's surface and Wick's figures
 * bound into it.
 *
 * `projectRoot` comes from THIS module and must never come from the package's:
 * the package is staged one directory deeper than this file, and a produced
 * replay or still is addressed by the running suite's path relative to the
 * project root. Taken from the package it would address every output one level
 * too deep — and silently, because a writer that raised on a failed write would
 * be blaming the build for the host's problem, so neither of them raises.
 */
const kit = createCaseHarness<WickSnapshot, WickDebugApi>({
  slug: "wick",
  handle: HANDLE,
  requiredOps: REQUIRED_OPS,
  // `step(ticks)`: a number of whole frames of the build's OWN loop, each a tick
  // of the build's fixed length on `playing`. The package's shared list of
  // required operations stops short of naming the step operation, and this
  // case's `REQUIRED_OPS` in `constants.ts` is what a surface fault reports
  // against.
  step: { kind: "count", op: "step" },
  stage: { width: STAGE_W, height: STAGE_H },
  tickHz: TICK_HZ,
  // A GENUINE browser gesture, so the build's audio can open: a build is free to
  // open its audio context from a real DOM event alone (both are conformant), so
  // a key delivered any other way would leave a perfectly good build silent.
  // `UNBOUND_KEY` is bound to nothing (specs/controls.md), so arming changes no
  // game state.
  arm: { kind: "key", code: UNBOUND_KEY },
  // `specs/controls.md` makes touch one of the three ways every menu is driven,
  // so the context reports a touchscreen: a contact arrives as
  // `pointerType: "touch"` and `navigator.maxTouchPoints` is non-zero, which is
  // the device a build that answers a finger has to believe it is on.
  hasTouch: true,
  // Read the screen the build stood the game up on, BEFORE the opening reset.
  // `specs/ui.md` says of the title screen "The game opens here", which is a
  // fact about what a fresh game OPENS on and not about what a `reset` puts it
  // back to — and every check runs after the reset, so that half of the
  // requirement would be invisible without a reading taken first.
  readOpeningSnapshot: true,
  // Fifteen seconds, because the ceiling is not really on the build: it is on
  // the host. This project holds four pages of one browser open at once, the
  // machine that runs it is running a model's build under it, and a full-stack
  // build decodes some ninety produced sprites and fifteen sounds before it is
  // ready. Fifteen costs a healthy build nothing, because the poll returns the
  // instant the global appears.
  surfaceTimeoutMs: 15_000,
  // This case's own probe, beside the kit's two, read relative to this file.
  extraInitScripts: ["audio-init.js"],
  projectRoot: dirname(fileURLToPath(import.meta.url)),
});

export const {
  captureReplay,
  captureStill,
  watchCues,
  fitViewport,
  failSurface,
  SURFACE_REQUIREMENT,
  seconds,
} = kit;

/**
 * Everything a check reads off one page running this build.
 *
 * A bound alias of the shared harness's interface, so every
 * `import { type Harness } from "../harness"` next door goes on naming a harness
 * whose `snapshot()` is a {@link WickSnapshot} and whose `debug` is a
 * {@link WickDebugApi}.
 */
export type Harness = BaseHarness<WickSnapshot, WickDebugApi>;

/** What a sweep found: whether the predicate ever held, and where it stopped. */
export type UntilResult = BaseUntilResult<WickSnapshot>;

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
  ConstantClock,
  darkestOf,
  differingPoints,
  distance,
  drawnPoints,
  drawnText,
  drawOps,
  drewText,
  imageDraws,
  imageRef,
  JitterClock,
  luminance,
  luminanceMask,
  maskDifference,
  meanColor,
  pixelsDiffering,
  pointsNear,
  retable,
  rgbOf,
  sampleColor,
  sampleDisc,
  samplePatch,
  SequenceClock,
  setsOf,
  stepUntilBed,
  stepUntilSound,
  textDraws,
  thinReplay,
  DRAW_METHODS,
  MAX_REPLAY_FRAMES,
  DEFAULT_REPLAY_BACKGROUND as REPLAY_BACKGROUND,
} from "./case-harness/index";

/* -------------------------------------------------------------------------- */
/* Named cues                                                                 */
/* -------------------------------------------------------------------------- */
//
// WHAT IS OBSERVED, AND WHY IT IS THE FAIR READING. `specs/ui.md` requires one
// cue per event, played on the tick or the frame its event happens, "and at
// most once on that tick", under fifteen fixed names — and `specs/assets.md`
// fixes the file each name plays. So the injected probe watches the two roads a
// browser can take a produced `.wav` to the speakers along, carries the file's
// name from the fetch to the `start()`, and the harness brackets each drive
// around its log, so a sound is attributed to the frames that produced it. A
// build that layers a synthesized flourish under a cue emits two sounds, one
// named and one not; a check counts the NAMED ones, because the name is what the
// specification fixed and the layer is the build's business.
//
// WHAT A DRIVE ATTRIBUTES. A drive of one frame — `tap`, `step(1)`,
// `stepWatching`, `frameCalls` — stamps each sound with exactly that frame. A
// drive of several frames stamps them with the span: `first` is the first frame
// the drive ran and `frame` the last, so a check that is ABOUT the frame steps
// one at a time, and a check that is only about whether a scenario sounded may
// step in a batch.
//
// A POSE SOUNDS NOTHING. "A cue is played by a tick or a frame, never by a pose
// of the debug surface." So a cue raised by a pose sounds on the next frame
// STEPPED, not at the call — arrange, then step, then read. A check that is
// about the pose itself reads {@link soundsSince} across the pose alone.

/** One sound the build emitted, as the probe logs it. */
export interface Sound {
  /** One of the fifteen cue names, the basename of a file that is none of them, or `null`. */
  name: string | null;
  /** The URL it was decoded from or played at, or `null`. */
  url: string | null;
  /** Whether its source was set to loop when it started. */
  loop: boolean;
}

/** A sound, stamped with the frames of the drive that produced it. */
export interface NamedCue extends Sound {
  /** The last frame of the drive it sounded on, 1-based as {@link Harness.frame} counts. */
  frame: number;
  /** The first frame of that drive; equal to `frame` for a drive of one. */
  first: number;
}

/** The named-cue log's state, per harness. */
interface CueLog {
  /** How many sounds the probe held when this log last read it. */
  cursor: number;
  /** Where {@link watchNamedCues} attaches. */
  sinks: NamedCue[][];
}

/** Each harness's named-cue log, kept off the object so a spread carries it. */
const cueLogs = new WeakMap<object, CueLog>();

/** The named-cue log of a harness this case's `createHarness` made, or the point fails. */
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

/** The probe's shape, as far as this side reads it. */
interface AudioProbe {
  count(): number;
  since(from: number): Sound[];
  decoded(): string[];
  looping(): string[];
  loopSources(name: string): number;
}

/** Call one operation of the probe in the page, and answer what it returned. */
function probe<T>(
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
        throw new Error(`wick: the audio probe ${global} is not installed`);
      }
      return audio[name]!(...rest) as T;
    },
    [AUDIO_PROBE_GLOBAL, op, args] as const,
  );
}

/**
 * Collect every sound the build emits from now on, named and stamped with the
 * frames of the drive it sounded on.
 *
 * Async, unlike the kit's `watchCues`, because attaching reads the probe's
 * count so that nothing emitted BEFORE this call lands in the collector.
 */
export async function watchNamedCues(h: Harness): Promise<NamedCue[]> {
  const log = cueLogOf(h);
  if (log.sinks.length === 0) {
    log.cursor = await probe<number>(h.page, "count");
  }
  const heard: NamedCue[] = [];
  log.sinks.push(heard);
  return heard;
}

/** The cues in `cues` named `name`. */
export function cuesNamed(cues: readonly NamedCue[], name: string): NamedCue[] {
  return cues.filter((cue) => cue.name === name);
}

/** The cues whose drive covered `frame`. */
export function cuesOnFrame(
  cues: readonly NamedCue[],
  frame: number,
): NamedCue[] {
  return cues.filter((cue) => cue.first <= frame && frame <= cue.frame);
}

/** The distinct names heard on `frame`, in the order first heard. */
export function namesOnFrame(
  cues: readonly NamedCue[],
  frame: number,
): string[] {
  const names: string[] = [];
  for (const cue of cuesOnFrame(cues, frame)) {
    if (cue.name !== null && !names.includes(cue.name)) names.push(cue.name);
  }
  return names;
}

/** How many sounds the build has emitted since the page loaded. */
export function soundCount(h: Harness): Promise<number> {
  return probe<number>(h.page, "count");
}

/**
 * The sounds emitted since the log held `from` of them.
 *
 * What a check about a POSE reads: take the count, pose, read the sounds since.
 */
export function soundsSince(h: Harness, from: number): Promise<Sound[]> {
  return probe<Sound[]>(h.page, "since", from);
}

/**
 * The cues sounding as loops at this moment, each named once.
 *
 * "`music` is looping on every frame exactly when `screen` is `playing`,
 * `levelup`, `chest`, or `paused`" and "`hum` is looping on every frame exactly
 * when `screen` is `playing` and a held weapon is `halo` or `corona`"
 * (specs/ui.md), which is what this reads.
 */
export function loopingCues(h: Harness): Promise<string[]> {
  return probe<string[]>(h.page, "looping");
}

/** Whether `name` is looping right now. */
export async function isLooping(h: Harness, name: string): Promise<boolean> {
  return (await loopingCues(h)).includes(name);
}

/** How many sources are sounding as loops of `name` right now. */
export function loopSourcesOf(h: Harness, name: string): Promise<number> {
  return probe<number>(h.page, "loopSources", name);
}

/** The cues whose files the build has decoded so far, oldest first. */
export function decodedCues(h: Harness): Promise<string[]> {
  return probe<string[]>(h.page, "decoded");
}

/** Wait, under a bound, for every one of the fifteen cue files to decode. */
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
 * Advance until `predicate` holds, over `run`, sampling every `poll` frames.
 *
 * The kit's own sweep, restated here so that each poll goes through the WRAPPED
 * drive and its sounds are stamped with that poll's frames. The first read is
 * taken BEFORE anything is driven, so a sweep reports a hit at zero frames when
 * the predicate already held — capture the state the scenario needs before the
 * sweep, not from the sweep.
 */
async function sweep(
  read: () => Promise<WickSnapshot>,
  run: (count: number) => Promise<WickSnapshot>,
  predicate: (snapshot: WickSnapshot) => boolean,
  options: UntilOptions,
): Promise<UntilResult> {
  const max = options.maxFrames ?? options.maxTicks ?? 600;
  const poll = Math.max(1, options.poll ?? 1);
  let snapshot = await read();
  if (predicate(snapshot)) {
    return { hit: true, frames: 0, ticks: 0, snapshot };
  }
  let count = 0;
  while (count < max) {
    const stride = Math.min(poll, max - count);
    snapshot = await run(stride);
    count += stride;
    if (predicate(snapshot)) {
      return { hit: true, frames: count, ticks: count, snapshot };
    }
  }
  return { hit: false, frames: count, ticks: count, snapshot };
}

/**
 * Stamp what the probe logged since the log's last read with the frames of one
 * drive, `first` through `frame`, and hand it to every watcher.
 *
 * Nothing is read when no watcher is attached, so a check that never asks about
 * audio pays no extra crossing.
 */
async function settleCues(
  page: Page,
  log: CueLog,
  first: number,
  frame: number,
): Promise<void> {
  if (log.sinks.length === 0) return;
  const read = await page.evaluate(
    ([global, from]) => {
      const audio = (window as unknown as Record<string, AudioProbe>)[global];
      return { plays: audio.since(from), count: audio.count() };
    },
    [AUDIO_PROBE_GLOBAL, log.cursor] as const,
  );
  log.cursor = read.count;
  for (const play of read.plays) {
    for (const sink of log.sinks) {
      sink.push({ ...play, frame, first: Math.min(first, frame) });
    }
  }
}

/**
 * Open a page on the build, take the game off its own clock, and give every
 * drive the named-cue log.
 *
 * The kit's harness does everything but the log. What comes back here is that
 * harness with every member that runs frames wrapped so that, once a watcher is
 * attached, the sounds the probe logged during the drive are stamped with the
 * drive's frames and handed to every watcher. Nothing is read when no watcher is
 * attached, so a check that never asks about audio pays no extra crossing.
 *
 * AND, for a harness created with `armAudio`, the wait for the build's own cue
 * files. The arming is the kit's: it presses `UNBOUND_KEY` before the opening
 * `reset`, which is what lets the page open an audio context at all. What the
 * kit cannot know is whether THIS case's fifteen produced files have arrived, so
 * that wait belongs here, and here is the one place it costs a check nothing —
 * before the harness is handed over, with no scenario yet posed to go stale.
 * See {@link AUDIO_LOAD_TIMEOUT_MS}.
 */
export async function createHarness(
  options?: HarnessOptions,
): Promise<Harness> {
  const base = await kit.createHarness(options);
  // Armed, so the clips are on their way; unarmed, there is nothing to wait for
  // and a build that decodes nothing must not cost a check the whole ceiling.
  if (options?.armAudio ?? false) await waitForCues(base.page);
  const log: CueLog = { cursor: 0, sinks: [] };

  /** Run `drive`, then settle the sounds it produced onto its frames. */
  const driven = async <T>(drive: () => Promise<T>): Promise<T> => {
    const first = base.frame() + 1;
    const result = await drive();
    await settleCues(base.page, log, first, base.frame());
    return result;
  };

  const h: Harness = {
    ...base,
    advance: (count) => driven(() => base.advance(count)),
    step: (count) => driven(() => base.step(count)),
    skip: (count) => driven(() => base.skip(count)),
    until: (predicate, untilOptions = {}) =>
      sweep(
        () => h.snapshot(),
        (count) => h.step(count),
        predicate,
        untilOptions,
      ),
    stepUntil: (predicate, untilOptions = {}) =>
      sweep(
        () => h.snapshot(),
        (count) => h.step(count),
        predicate,
        untilOptions,
      ),
    skipUntil: (predicate, untilOptions = {}) =>
      driven(() => base.skipUntil(predicate, untilOptions)),
    async stepWatching(count, watch) {
      const seen: WickSnapshot[] = [];
      for (let i = 0; i < count; i += 1) {
        const snapshot = await h.step(1);
        seen.push(snapshot);
        if (watch?.(snapshot, i + 1) === true) break;
      }
      return seen;
    },
    runFor: (ms) => driven(() => base.runFor(ms)),
    tap: (code) => driven(() => base.tap(code)),
    holdFor: (code, count) => driven(() => base.holdFor(code, count)),
    clickPointer: (x, y, button) =>
      driven(() => base.clickPointer(x, y, button)),
    frameCalls: () => driven(() => base.frameCalls()),
  };
  cueLogs.set(h, log);
  return h;
}

/** The surface's `version` property, read without invoking anything. */
export async function surfaceVersion(h: Harness): Promise<unknown> {
  return (await h.probe([])).version;
}

/**
 * Pose one partial frame worth `seconds` of delta time through the surface's
 * `advance`, and read what it left.
 *
 * The one drive the kit does not count: `advance` runs a frame of the build's
 * loop through the ACCUMULATOR rather than a whole tick, which is what the
 * clock checks are about, and the harness's frame counter and the recorder
 * count whole stepped frames alone. So `h.frame()` does not move here, and a
 * cue this frame raises is stamped with the last counted frame on both ends.
 */
export async function advanceBy(
  h: Harness,
  seconds: number,
): Promise<WickSnapshot> {
  const log = cueLogOf(h);
  await h.debug.advance(seconds);
  await settleCues(h.page, log, h.frame(), h.frame());
  return h.snapshot();
}

/* -------------------------------------------------------------------------- */
/* Reading a snapshot                                                         */
/* -------------------------------------------------------------------------- */
//
// Each of these names a reading rather than leaving every suite to spell it,
// and the ones that FAIL when the reading is not there fail the point: a build
// whose snapshot reports no enemies list at all is a build whose surface cannot
// be driven, and `writing-debug-apis-and-validators` puts that on the point
// rather than leaving it undecided.

/** The lamplighter. */
export function player(snapshot: WickSnapshot): PlayerView {
  return snapshot.run.player;
}

/**
 * The 1-based ticks of `history` on which the lamplighter's `hp` fell from the
 * tick before, reading `start` as the tick before the first.
 *
 * The reading a contact schedule is decided by, and one that says nothing about
 * how much a hit took: a hit is the only thing that lowers `hp` on a night
 * where recovery is `BASE_RECOVERY` and nothing heals, so the ticks it fell on
 * are the ticks a hit landed on.
 */
export function ticksHpFell(
  start: WickSnapshot,
  history: readonly WickSnapshot[],
): number[] {
  const fell: number[] = [];
  let previous = player(start).hp;
  for (const [index, snapshot] of history.entries()) {
    const hp = player(snapshot).hp;
    if (hp < previous) fell.push(index + 1);
    previous = hp;
  }
  return fell;
}

/** The nine switches, as the snapshot reports them. */
export function switchesOf(
  snapshot: WickSnapshot,
): Record<SwitchName, boolean> {
  const out = {} as Record<SwitchName, boolean>;
  for (const name of SWITCH_NAMES) out[name] = snapshot[name];
  return out;
}

/** The enemy with `id`, or `undefined`. */
export function enemyById(
  snapshot: WickSnapshot,
  id: number,
): EnemyView | undefined {
  return (snapshot.run.enemies ?? []).find((enemy) => enemy.id === id);
}

/** The enemy with `id`, failing the point when it is gone. */
export function mustEnemy(snapshot: WickSnapshot, id: number): EnemyView {
  const enemy = enemyById(snapshot, id);
  if (enemy === undefined) {
    fail(
      `an enemy with id ${id} in snapshot().run.enemies`,
      (snapshot.run.enemies ?? []).map((held) => held.id),
    );
  }
  return enemy;
}

/** Every enemy of `type`, in id order. */
export function enemiesOf(snapshot: WickSnapshot, type: EnemyId): EnemyView[] {
  return (snapshot.run.enemies ?? [])
    .filter((enemy) => enemy.type === type)
    .sort((a, b) => a.id - b.id);
}

/** The projectile with `id`, or `undefined`. */
export function projectileById(
  snapshot: WickSnapshot,
  id: number,
): ProjectileView | undefined {
  return (snapshot.run.projectiles ?? []).find((shape) => shape.id === id);
}

/** The projectile with `id`, failing the point when it is gone. */
export function mustProjectile(
  snapshot: WickSnapshot,
  id: number,
): ProjectileView {
  const shape = projectileById(snapshot, id);
  if (shape === undefined) {
    fail(
      `a projectile with id ${id} in snapshot().run.projectiles`,
      (snapshot.run.projectiles ?? []).map((held) => held.id),
    );
  }
  return shape;
}

/** Every projectile of `weapon`, in id order. */
export function projectilesOf(
  snapshot: WickSnapshot,
  weapon: WeaponId,
): ProjectileView[] {
  return (snapshot.run.projectiles ?? [])
    .filter((shape) => shape.weapon === weapon)
    .sort((a, b) => a.id - b.id);
}

/** The zone with `id`, or `undefined`. */
export function zoneById(
  snapshot: WickSnapshot,
  id: number,
): ZoneView | undefined {
  return (snapshot.run.zones ?? []).find((zone) => zone.id === id);
}

/** The zone with `id`, failing the point when it is gone. */
export function mustZone(snapshot: WickSnapshot, id: number): ZoneView {
  const zone = zoneById(snapshot, id);
  if (zone === undefined) {
    fail(
      `a zone with id ${id} in snapshot().run.zones`,
      (snapshot.run.zones ?? []).map((held) => held.id),
    );
  }
  return zone;
}

/** Every zone of `kind`, in id order. */
export function zonesOfKind(
  snapshot: WickSnapshot,
  kind: ZoneKind,
): ZoneView[] {
  return (snapshot.run.zones ?? [])
    .filter((zone) => zone.kind === kind)
    .sort((a, b) => a.id - b.id);
}

/** Every zone of `weapon`, in id order. */
export function zonesOf(snapshot: WickSnapshot, weapon: WeaponId): ZoneView[] {
  return (snapshot.run.zones ?? [])
    .filter((zone) => zone.weapon === weapon)
    .sort((a, b) => a.id - b.id);
}

/** The gem with `id`, or `undefined`. */
export function gemById(
  snapshot: WickSnapshot,
  id: number,
): GemView | undefined {
  return (snapshot.run.gems ?? []).find((gem) => gem.id === id);
}

/** The pickup with `id`, or `undefined`. */
export function pickupById(
  snapshot: WickSnapshot,
  id: number,
): PickupView | undefined {
  return (snapshot.run.pickups ?? []).find((pickup) => pickup.id === id);
}

/** The slot index holding weapon `id`, or `-1`. */
export function weaponSlot(snapshot: WickSnapshot, id: WeaponId): number {
  return (snapshot.run.weapons ?? []).findIndex((held) => held.id === id);
}

/** The held weapon `id`, or `undefined`. */
export function weaponIn(
  snapshot: WickSnapshot,
  id: WeaponId,
): WeaponSlotView | undefined {
  return (snapshot.run.weapons ?? []).find((held) => held.id === id);
}

/** The slot index holding passive `id`, or `-1`. */
export function passiveSlot(snapshot: WickSnapshot, id: PassiveId): number {
  return (snapshot.run.passives ?? []).findIndex((held) => held.id === id);
}

/** The held passive `id`, or `undefined`. */
export function passiveIn(
  snapshot: WickSnapshot,
  id: PassiveId,
): PassiveSlotView | undefined {
  return (snapshot.run.passives ?? []).find((held) => held.id === id);
}

/**
 * The levels held, by passive id, for the derived-stat formulas of
 * `constants.ts`: "a passive not held is level `0`".
 */
export function passiveLevels(snapshot: WickSnapshot): PassiveLevels {
  const levels: PassiveLevels = {};
  for (const held of snapshot.run.passives ?? []) levels[held.id] = held.level;
  return levels;
}

/** Whether the run holds nothing alive and nothing dropped. */
export function worldIsEmpty(snapshot: WickSnapshot): boolean {
  const run = snapshot.run;
  return (
    (run.enemies ?? []).length === 0 &&
    (run.projectiles ?? []).length === 0 &&
    (run.zones ?? []).length === 0 &&
    (run.gems ?? []).length === 0 &&
    (run.pickups ?? []).length === 0
  );
}

/** The re-hit entry a shape holds for `enemyId`, or `undefined`. */
export function hitEntry(
  shape: ProjectileView | ZoneView,
  enemyId: number,
): HitEntry | undefined {
  return (shape.hits ?? []).find((entry) => entry.enemy === enemyId);
}

/**
 * The `n` nearest enemies, in the order `specs/weapons.md` fixes: "the live
 * enemy whose center is the smallest Euclidean distance from the player's
 * center, ties broken by the lowest enemy `id`", and "the `n` nearest enemies
 * are the first `n` in that same ordering". With no `n`, every enemy in that
 * order.
 */
export function nearestEnemies(
  snapshot: WickSnapshot,
  n?: number,
): EnemyView[] {
  const at = snapshot.run.player;
  const ordered = [...(snapshot.run.enemies ?? [])]
    .map((enemy) => ({
      enemy,
      gap: Math.hypot(enemy.x - at.x, enemy.y - at.y),
    }))
    .sort((a, b) => a.gap - b.gap || a.enemy.id - b.enemy.id)
    .map((entry) => entry.enemy);
  return n === undefined ? ordered : ordered.slice(0, n);
}

/**
 * "A direction toward an enemy is the unit vector from the player's center to
 * the enemy's center, and when the two centers coincide the facing direction
 * is used instead" (specs/weapons.md).
 */
export function directionToward(snapshot: WickSnapshot, target: XY): XY {
  const at = snapshot.run.player;
  return unitToward(at, target) ?? facingVector(at.facing);
}

/* ---- What a tick created --------------------------------------------------- */
//
// "A pose that creates an entity gives it the next id from `nextId`", and an
// enemy "spawns with the next id from `nextId`, so ids ascend in spawn order and
// each is used once per run" (specs/instrumentation.md, specs/enemies.md). So
// everything a tick or a pose created since a snapshot was taken is exactly the
// entries whose id is at least that snapshot's `nextId`, and a check about what
// a firing produced reads them off the tick's snapshot without guessing which
// entries were already there.

/** The entries of `after` created since `before` was read, in id order. */
export function createdSince<T extends { id: number }>(
  before: WickSnapshot,
  after: readonly T[],
): T[] {
  return after
    .filter((entry) => entry.id >= before.run.nextId)
    .sort((a, b) => a.id - b.id);
}

/** The projectiles created since `before`, in id order. */
export function newProjectiles(
  before: WickSnapshot,
  after: WickSnapshot,
): ProjectileView[] {
  return createdSince(before, after.run.projectiles ?? []);
}

/** The zones created since `before`, in id order. */
export function newZones(
  before: WickSnapshot,
  after: WickSnapshot,
): ZoneView[] {
  return createdSince(before, after.run.zones ?? []);
}

/** The enemies spawned since `before`, in id order. */
export function newEnemies(
  before: WickSnapshot,
  after: WickSnapshot,
): EnemyView[] {
  return createdSince(before, after.run.enemies ?? []);
}

/** The gems dropped since `before`, in id order. */
export function newGems(before: WickSnapshot, after: WickSnapshot): GemView[] {
  return createdSince(before, after.run.gems ?? []);
}

/** The pickups dropped since `before`, in id order. */
export function newPickups(
  before: WickSnapshot,
  after: WickSnapshot,
): PickupView[] {
  return createdSince(before, after.run.pickups ?? []);
}

/* -------------------------------------------------------------------------- */
/* Geometry                                                                   */
/* -------------------------------------------------------------------------- */

/** A point on the plane or the stage. */
export interface XY {
  x: number;
  y: number;
}

/** The Euclidean distance between two points. */
export function distanceBetween(a: XY, b: XY): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * The unit vector from `from` toward `to`, or `null` when the two coincide,
 * which is when the specification falls back to the facing direction.
 */
export function unitToward(from: XY, to: XY): XY | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return null;
  return { x: dx / length, y: dy / length };
}

/** The unit vector along `facing`: "`+x` for `"right"` and `-x` for `"left"`". */
export function facingVector(facing: Facing): XY {
  return { x: facing === "right" ? 1 : -1, y: 0 };
}

/**
 * The lamplighter's displacement on each tick of `ticks`, each against the
 * snapshot before it, starting from `from`: what a check about a per-tick step
 * of specs/world.md's "each tick the position advances by the velocity times
 * `TICK_DT`" reads.
 */
export function tickSteps(
  from: WickSnapshot,
  ticks: readonly WickSnapshot[],
): XY[] {
  const steps: XY[] = [];
  let before = from.run.player;
  for (const snapshot of ticks) {
    const at = snapshot.run.player;
    steps.push({ x: at.x - before.x, y: at.y - before.y });
    before = at;
  }
  return steps;
}

/** The lamplighter's displacement from `from` to `to`. */
export function displacement(from: WickSnapshot, to: WickSnapshot): XY {
  return {
    x: to.run.player.x - from.run.player.x,
    y: to.run.player.y - from.run.player.y,
  };
}

/** A point `units` from `from` along the direction at `degrees`. */
export function alongAngle(from: XY, degrees: number, units: number): XY {
  const radians = (degrees * Math.PI) / 180;
  return {
    x: from.x + Math.cos(radians) * units,
    y: from.y + Math.sin(radians) * units,
  };
}

/** The angle of `to` seen from `from`, in degrees normalized into `[0, 360)`. */
export function angleFrom(from: XY, to: XY): number {
  const degrees = (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
  return ((degrees % 360) + 360) % 360;
}

/**
 * Where a world point draws on the stage: "`(wx − player.x + STAGE_CX,
 * wy − player.y + STAGE_CY)`" (specs/world.md — "The camera and the view").
 */
export function stagePoint(snapshot: WickSnapshot, wx: number, wy: number): XY {
  const at = snapshot.run.player;
  return { x: wx - at.x + STAGE_CX, y: wy - at.y + STAGE_CY };
}

/** The world point under a stage point: the camera formula inverted. */
export function worldPoint(snapshot: WickSnapshot, sx: number, sy: number): XY {
  const at = snapshot.run.player;
  return { x: sx - STAGE_CX + at.x, y: sy - STAGE_CY + at.y };
}

/**
 * The images a frame drew at `size` on the stage, within `BLIT_TOL` on each
 * side: "a sprite `24` pixels wide stands `24` units wide in the world"
 * (specs/assets.md), so a sprite is told by the size it was drawn at rather than
 * by its file, which a bundler may inline, or by its source's natural size,
 * which a build that packs its sheets into one atlas would not keep. A sprite
 * mirrored through a negative scale reports a negative width, so the sizes are
 * compared unsigned.
 */
export function spriteDraws(
  calls: readonly DrawCall[],
  size: CanvasSize,
): ImageDraw[] {
  return imageDraws(calls).filter(
    (draw) =>
      Math.abs(Math.abs(draw.dw) - size.width) <= BLIT_TOL &&
      Math.abs(Math.abs(draw.dh) - size.height) <= BLIT_TOL,
  );
}

/** The draw of `draws` whose centre is nearest `at`, or `undefined` of none. */
export function drawNearest(
  draws: readonly ImageDraw[],
  at: XY,
): ImageDraw | undefined {
  let best: ImageDraw | undefined;
  let gap = Number.POSITIVE_INFINITY;
  for (const draw of draws) {
    const d = Math.hypot(draw.cx - at.x, draw.cy - at.y);
    if (d < gap) {
      gap = d;
      best = draw;
    }
  }
  return best;
}

/* -------------------------------------------------------------------------- */
/* Scenario helpers                                                           */
/* -------------------------------------------------------------------------- */
//
// Each of these poses a situation through `window.__wick` and then lets the
// real simulation run. `writing-debug-apis-and-validators` puts every COMPOUND
// sequence here rather than on the surface: the surface carries atomic poses,
// and the arrangements a check needs are assembled from them in one place every
// check shares.
//
// A VALIDATOR POSES AN ISOLATED NIGHT. Everything a check's requirement does not
// concern is removed before its scenario is staged, rather than parked somewhere
// harmless, and every faculty the requirement does not exercise is held:
// containment leans on the game's own rules holding, and a broken build is
// broken in exactly those rules. {@link isolate} is the shape of that — it
// resets to the idle run, stands the game on `playing`, empties the world, and
// turns every one of the nine driver switches off, `drops` and `progression`
// among them, so no kill a scenario makes litters the field and no experience a
// scenario gains spends a level under it. A check then turns on exactly the
// faculties it is about, and holds NOTHING in a state chosen to keep it quiet:
// the level an isolated night stands at is the idle run's `1`, not a figure
// picked to outrun the build's own `xpToNext`.

/** What {@link isolate} arranges. Every field is optional; each defaults below. */
export interface IsolateOptions {
  /** The level to pose. Left at the idle run's `1` by default. */
  level?: number;
  /** Put Taper at level `1` in the first slot, as a fresh run holds it. Off by default. */
  taper?: boolean;
  /**
   * The faculties to turn back on once every switch is off: exactly the ones
   * the check is about. Defaults to none.
   */
  on?: readonly SwitchName[];
}

/**
 * Pose an isolated night: the idle run, standing on `playing`, with nothing
 * alive, nothing dropped, no slot held, and every driver switch off.
 *
 * The order is the one the operations' own definitions force: the reset first,
 * so nothing a previous section left is inherited, the idle run stands, and
 * every switch comes back on as `reset` restores them; `setScreen("playing")`
 * next, which "sets `screen` to `name` ... Nothing else changes"; then every
 * switch off and every entity kind cleared, which a conformant `reset` has
 * already left empty and which this states rather than assumes. Nothing here
 * decides an outcome: every hit, kill, drop, level-up, and ending a check reads
 * comes from the frames it steps afterwards.
 *
 * The run is on `playing` at tick `0` with the lamplighter at the origin
 * facing right at full health, and nothing runs until something steps it.
 */
export async function isolate(
  h: Harness,
  options: IsolateOptions = {},
): Promise<WickSnapshot> {
  await h.debug.reset();
  await h.debug.setScreen("playing");
  await holdAll(h);
  await h.debug.clearEnemies();
  await h.debug.clearProjectiles();
  await h.debug.clearZones();
  await h.debug.clearGems();
  await h.debug.clearPickups();
  if (options.taper === true) await h.debug.setWeapon(0, "taper", 1);
  if (options.level !== undefined) await h.debug.setLevel(options.level);
  if (options.on !== undefined) await enable(h, ...options.on);
  return h.snapshot();
}

/** Set one driver switch by name. */
export async function setSwitch(
  h: Harness,
  name: SwitchName,
  on: boolean,
): Promise<void> {
  switch (name) {
    case "spawning":
      return h.debug.setSpawning(on);
    case "events":
      return h.debug.setEvents(on);
    case "despawning":
      return h.debug.setDespawning(on);
    case "enemyMotion":
      return h.debug.setEnemyMotion(on);
    case "enemyContact":
      return h.debug.setEnemyContact(on);
    case "weaponFire":
      return h.debug.setWeaponFire(on);
    case "effectMotion":
      return h.debug.setEffectMotion(on);
    case "drops":
      return h.debug.setDrops(on);
    case "progression":
      return h.debug.setProgression(on);
  }
}

/** Turn the named faculties on: what a check does for exactly the ones it is about. */
export async function enable(
  h: Harness,
  ...names: readonly SwitchName[]
): Promise<void> {
  for (const name of names) await setSwitch(h, name, true);
}

/** Turn the named faculties off. */
export async function disable(
  h: Harness,
  ...names: readonly SwitchName[]
): Promise<void> {
  for (const name of names) await setSwitch(h, name, false);
}

/** Turn every driver switch off. */
export async function holdAll(h: Harness): Promise<void> {
  await disable(h, ...SWITCH_NAMES);
}

/** Turn every driver switch on, as the game is played. */
export async function releaseAll(h: Harness): Promise<void> {
  await enable(h, ...SWITCH_NAMES);
}

/**
 * Begin a fresh run through the surface, from a reset: the direct route into
 * play for every check that is not about the menus, with every switch on and
 * Taper alone in the first slot, exactly as a player's run starts.
 *
 * The three calls are the sequence `specs/instrumentation.md` names under
 * `setScreen`: "a fresh run is `reset`, this pose to `playing`, and
 * `setWeapon(0, \"taper\", 1)`". The surface poses one thing per call, so the
 * arrangement lives here rather than behind one operation.
 */
export async function startRun(h: Harness): Promise<WickSnapshot> {
  await h.debug.reset();
  await h.debug.setScreen("playing");
  await h.debug.setWeapon(0, "taper", 1);
  return h.snapshot();
}

/**
 * Start a run the way a player does: reset to the title, and press `confirm`
 * on the highlighted `LIGHT THE LAMP`. For the checks that are ABOUT the real
 * route into play; everything else enters through {@link startRun} and never
 * touches a menu, so a build with a broken title and a working tick fails the
 * navigation points and passes the rest. The frame the press runs is the run's
 * first tick.
 */
export async function startRunFromTitle(h: Harness): Promise<WickSnapshot> {
  await h.debug.reset();
  return pressConfirm(h);
}

/**
 * Set `screen` and read what the pose left.
 *
 * The pose sets the screen alone, so what the screen shows is whatever the
 * caller arranged first: this is the thin name over the operation, and the
 * sequences that reach a screen through the game's own systems are
 * {@link startRun}, {@link openLevelUp}, {@link openChest}, and the endings.
 */
export async function poseScreen(
  h: Harness,
  screen: ScreenName,
): Promise<WickSnapshot> {
  await h.debug.setScreen(screen);
  return h.snapshot();
}

/* ---- The loadout ---------------------------------------------------------- */

/**
 * Hold weapon `id` at `level`, appended after the slots held unless `slot`
 * names one, and answer the slot it went into. Its cooldown timer is `0`, so
 * it fires on the next `playing` tick `weaponFire` is on.
 */
export async function holdWeapon(
  h: Harness,
  id: WeaponId,
  level = 1,
  slot?: number,
): Promise<number> {
  const at = slot ?? ((await h.snapshot()).run.weapons ?? []).length;
  await h.debug.setWeapon(at, id, level);
  return at;
}

/** Hold passive `id` at `level`, appended unless `slot` names one; answers the slot. */
export async function holdPassive(
  h: Harness,
  id: PassiveId,
  level = 1,
  slot?: number,
): Promise<number> {
  const at = slot ?? ((await h.snapshot()).run.passives ?? []).length;
  await h.debug.setPassive(at, id, level);
  return at;
}

/** Make the weapon in `slot` due on the next tick: its timer to `0`. */
export function armWeapon(h: Harness, slot: number): Promise<void> {
  return h.debug.setWeaponCooldown(slot, 0);
}

/** What one firing tick produced, beside the snapshots either side of it. */
export interface Firing {
  /** The slot the weapon fired from. */
  slot: number;
  /** The state before the firing tick, with the weapon held and due. */
  before: WickSnapshot;
  /** The state the firing tick left. */
  after: WickSnapshot;
  /** The projectiles that tick created, in id order. */
  projectiles: ProjectileView[];
  /** The zones that tick created, in id order. */
  zones: ZoneView[];
}

/**
 * Hold weapon `id` at `level`, due at once, turn `weaponFire` on, and run the
 * tick it fires on: "On acquisition the timer is `0`, so a weapon fires on the
 * first `playing` tick it is held" (specs/weapons.md).
 *
 * `weaponFire` stays on afterwards, so the cooldown counts and the weapon fires
 * again on its own rhythm; a check that wants one firing alone turns it back
 * off. Every target the weapon aims at is posed by the check before this call,
 * and what the tick did with them is read off `after`.
 */
export async function fireWeapon(
  h: Harness,
  id: WeaponId,
  level = 1,
): Promise<Firing> {
  const slot = await holdWeapon(h, id, level);
  await armWeapon(h, slot);
  await enable(h, "weaponFire");
  const before = await h.snapshot();
  const after = await h.step(1);
  return {
    slot,
    before,
    after,
    projectiles: newProjectiles(before, after),
    zones: newZones(before, after),
  };
}

/* ---- Placing entities ----------------------------------------------------- */

/**
 * The entity a pose created: the one carrying the id `nextId` held before the
 * call, or failing that the one that was not there before, or the point fails.
 */
function created<T extends { id: number }>(
  what: string,
  before: readonly T[],
  after: readonly T[],
  wantedId: number,
): T {
  const byId = after.find((entry) => entry.id === wantedId);
  if (byId !== undefined) return byId;
  const known = new Set(before.map((entry) => entry.id));
  const fresh = after.filter((entry) => !known.has(entry.id));
  if (fresh.length === 1) return fresh[0] as T;
  return fail(
    `${what} with the next id (${wantedId}) in the snapshot after the pose`,
    after.map((entry) => entry.id),
  );
}

/** Spawn one enemy at a world point and answer it as the snapshot reports it. */
export async function placeEnemy(
  h: Harness,
  type: EnemyId,
  x: number,
  y: number,
): Promise<EnemyView> {
  const before = await h.snapshot();
  await h.debug.spawnEnemy(type, x, y);
  const after = await h.snapshot();
  return created(
    `an enemy of type ${type}`,
    before.run.enemies ?? [],
    after.run.enemies ?? [],
    before.run.nextId,
  );
}

/** Spawn one enemy `dx, dy` from the lamplighter's center. */
export async function placeEnemyNear(
  h: Harness,
  type: EnemyId,
  dx: number,
  dy: number,
): Promise<EnemyView> {
  const at = (await h.snapshot()).run.player;
  return placeEnemy(h, type, at.x + dx, at.y + dy);
}

/** Add one projectile and answer it as the snapshot reports it. */
export async function placeProjectile(
  h: Harness,
  weapon: ProjectileWeapon,
  x: number,
  y: number,
  vx: number,
  vy: number,
  pierce: number,
): Promise<ProjectileView> {
  const before = await h.snapshot();
  await h.debug.spawnProjectile(weapon, x, y, vx, vy, pierce);
  const after = await h.snapshot();
  return created(
    `a projectile of ${weapon}`,
    before.run.projectiles ?? [],
    after.run.projectiles ?? [],
    before.run.nextId,
  );
}

/** Add one puddle and answer it as the snapshot reports it. */
export async function placePuddle(
  h: Harness,
  weapon: PuddleWeapon,
  x: number,
  y: number,
): Promise<ZoneView> {
  const before = await h.snapshot();
  await h.debug.spawnPuddle(weapon, x, y);
  const after = await h.snapshot();
  return created(
    `a puddle of ${weapon}`,
    before.run.zones ?? [],
    after.run.zones ?? [],
    before.run.nextId,
  );
}

/** Place one unattracted gem and answer it as the snapshot reports it. */
export async function placeGem(
  h: Harness,
  tier: GemTier,
  x: number,
  y: number,
): Promise<GemView> {
  const before = await h.snapshot();
  await h.debug.spawnGem(tier, x, y);
  const after = await h.snapshot();
  return created(
    `a ${tier} gem`,
    before.run.gems ?? [],
    after.run.gems ?? [],
    before.run.nextId,
  );
}

/** Place one pickup and answer it as the snapshot reports it. */
export async function placePickup(
  h: Harness,
  kind: PickupKind,
  x: number,
  y: number,
): Promise<PickupView> {
  const before = await h.snapshot();
  await h.debug.spawnPickup(kind, x, y);
  const after = await h.snapshot();
  return created(
    `a ${kind} pickup`,
    before.run.pickups ?? [],
    after.run.pickups ?? [],
    before.run.nextId,
  );
}

/* ---- The keys ------------------------------------------------------------- */
//
// Real key events, through Chromium's own input pipeline, because the keyboard
// belongs to the runtime layer the build wrote and `specs/instrumentation.md`
// carries no operation for it: "a dispatched keyboard event moves the
// lamplighter and works the menus exactly as a player's key does". A tap is
// down, ONE frame, up, so exactly one frame passes per tap and a press edge is
// seen whichever of the two conformant ways a build reads one.

/** Raise `confirm` with `Enter`: starts a run on the title, accepts an offer. One frame. */
export function pressConfirm(h: Harness): Promise<WickSnapshot> {
  return h.tap("Enter");
}

/** Raise `back` with `Escape`. One frame. */
export function pressBack(h: Harness): Promise<WickSnapshot> {
  return h.tap("Escape");
}

/** Raise `pause` with `KeyP`: pauses on `playing`, resumes on `paused`. One frame. */
export function pressPause(h: Harness): Promise<WickSnapshot> {
  return h.tap("KeyP");
}

/** Raise `mute` with `KeyM`. One frame. */
export function pressMute(h: Harness): Promise<WickSnapshot> {
  return h.tap("KeyM");
}

/** Raise `up` with `ArrowUp`, as a menu edge. One frame. */
export function pressUp(h: Harness): Promise<WickSnapshot> {
  return h.tap("ArrowUp");
}

/** Raise `down` with `ArrowDown`, as a menu edge. One frame. */
export function pressDown(h: Harness): Promise<WickSnapshot> {
  return h.tap("ArrowDown");
}

/**
 * Raise `action` through the `binding`-th key `BINDINGS` gives it, counted from
 * `0`. What a check about a second binding presses: "The two keys bound to an
 * action are interchangeable" (specs/controls.md). One frame.
 */
export function pressAction(
  h: Harness,
  action: Action,
  binding = 0,
): Promise<WickSnapshot> {
  const code = BINDINGS[action][binding];
  if (code === undefined) {
    fail(
      `a binding ${binding} of the ${action} action in specs/controls.md`,
      BINDINGS[action],
    );
  }
  return h.tap(code);
}

/** Toggle the diagnostics overlay with `Backquote`, outside the action registry. One frame. */
export function pressOverlayToggle(h: Harness): Promise<WickSnapshot> {
  return h.tap(OVERLAY_KEY);
}

/**
 * Hold every key in `codes` down together for `frames` frames, then release
 * them all, and read what the frames left. What a check about a diagonal or a
 * pair of opposed keys drives.
 */
export async function holdKeys(
  h: Harness,
  codes: readonly string[],
  frames: number,
): Promise<WickSnapshot> {
  for (const code of codes) await h.hold(code);
  try {
    return await h.step(frames);
  } finally {
    for (const code of codes) await h.release(code);
  }
}

/**
 * Hold every key in `codes` down together for `frames` frames, one frame at a
 * time, then release them all, and hand back the snapshot each frame left in
 * order. What a check about a tick-over-tick figure drives: the lamplighter's
 * step on every tick of a hold, or `facing` on every tick of one.
 */
export async function holdKeysWatching(
  h: Harness,
  codes: readonly string[],
  frames: number,
): Promise<WickSnapshot[]> {
  for (const code of codes) await h.hold(code);
  try {
    return await h.stepWatching(frames);
  } finally {
    for (const code of codes) await h.release(code);
  }
}

/* ---- Synthetic key events ------------------------------------------------- */
//
// Two facts about the keyboard layer can only be reached with an event the
// harness BUILDS rather than one Chromium types: "That layer maps each key in
// `BINDINGS` to its action in `ACTIONS` by `KeyboardEvent.code`" and "A key
// event whose `repeat` flag is set arms no edge" (specs/controls.md). Chromium
// derives `key` from `code` and sets `repeat` itself, so a check about either
// dispatches a `KeyboardEvent` of its own, which the same specification
// sanctions: "a dispatched keyboard event moves the lamplighter and works the
// menus exactly as a player's key does" (specs/instrumentation.md).
//
// The event is dispatched on the focused element, bubbling, which is where a
// typed key lands and the path every listener a build may have attached sits
// on: the element itself, `document`, and `window`.

/** What a dispatched key event carries beyond its `code`. */
export interface KeyEventOptions {
  /** The event's `key`. Defaults to `code`, as a plain keyboard reports an arrow. */
  key?: string;
  /** The event's `repeat` flag. Off by default. */
  repeat?: boolean;
}

/**
 * Dispatch one `keydown` or `keyup` for `code` on the page's focused element,
 * without stepping a frame. Every held key Chromium holds stays held.
 */
export async function dispatchKey(
  h: Harness,
  type: "keydown" | "keyup",
  code: string,
  options: KeyEventOptions = {},
): Promise<void> {
  await h.page.evaluate(
    ([kind, init]) => {
      const active = document.activeElement;
      const target =
        active instanceof HTMLElement && active !== document.documentElement
          ? active
          : document.body;
      target.dispatchEvent(
        new KeyboardEvent(kind, {
          ...init,
          bubbles: true,
          cancelable: true,
          composed: true,
        }),
      );
    },
    [
      type,
      { code, key: options.key ?? code, repeat: options.repeat ?? false },
    ] as const,
  );
}

/**
 * Press `code` through a dispatched `keydown` carrying `options`, run the one
 * frame that delivers it, and release it with the matching `keyup`; the frame
 * between the two is what makes it a press either conformant reading sees, as
 * {@link Harness.tap} explains.
 */
export async function tapDispatched(
  h: Harness,
  code: string,
  options: KeyEventOptions = {},
): Promise<WickSnapshot> {
  await dispatchKey(h, "keydown", code, options);
  try {
    return await h.step(1);
  } finally {
    await dispatchKey(h, "keyup", code, { key: options.key });
  }
}

/* ---- The pointer ---------------------------------------------------------- */
//
// WHAT THE SPECIFICATION FIXES. "The pointer is read in the stage's own
// coordinates, `0` to `STAGE_W` across and `0` to `STAGE_H` down, whatever the
// canvas's size on the page and wherever the letterbox bars fall, and wheel
// travel is read in those same units", and under an engineless configuration
// "the runtime layer you write maps both the event's client position and the
// event's wheel travel through the same fit it draws under" (specs/controls.md —
// "The pointer"). So a check names a point in the SAME units it names a sprite's
// position in, and the conversion into the page's CSS pixels lives here.
//
// A REAL MOUSE, FOR THE REASON THE KEYBOARD IS A REAL KEYBOARD. The pointer
// belongs to the runtime layer the build wrote, and `specs/instrumentation.md`
// carries no operation that poses one. These drive Chromium's own mouse, so a
// build reading the pointer from its own `pointermove`, `pointerdown` and
// `wheel` handlers sees exactly what a player's hand produces — and a build that
// listens on its canvas rather than on the window is served too, which is why
// the wheel helper rests the pointer on the stage before it turns.
//
// A FRAME IS WHERE THE RULES APPLY. The three pointer rules run "on every frame,
// after that frame's press edges and before its update", so a move or a wheel
// event alone changes nothing until a frame reads it. Each helper below moves
// the mouse and then runs exactly ONE frame, and answers what that frame left.
// A check that must read the state between the parts of a gesture drives
// `mousePress`, `mouseGlide` and `mouseRelease` instead, a frame per part.

/** Fail the point unless `value` is the rectangle list `op` owes. */
function asRects(value: unknown, op: string): RectView[] {
  if (!Array.isArray(value)) {
    fail(
      `${op} to report a list of rectangles (specs/instrumentation.md — "Menus")`,
      value,
    );
  }
  return value.map((entry) => {
    const rect = entry as Partial<RectView> | null;
    if (
      typeof rect?.x !== "number" ||
      typeof rect.y !== "number" ||
      typeof rect.width !== "number" ||
      typeof rect.height !== "number"
    ) {
      fail(
        `every rectangle ${op} reports to carry x, y, width and height in stage coordinates`,
        entry,
      );
    }
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
}

/**
 * "The rectangles of the current screen's vertical menu, in menu order" — one
 * per item on `title`, `levelup`, `paused`, `fallen` and `dawn`, one per VISIBLE
 * entry row on `almanac`, and an empty list on `howto`, `playing` and `chest`.
 */
export async function menuRects(h: Harness): Promise<RectView[]> {
  return asRects(await h.debug.menuRects(), "menuRects()");
}

/**
 * "The rectangles of the almanac's tab bar on `almanac`, one per tab in
 * `ALMANAC_TABS` order"; an empty list on every other screen.
 */
export async function tabRects(h: Harness): Promise<RectView[]> {
  return asRects(await h.debug.tabRects(), "tabRects()");
}

/** The middle of a rectangle: the point a hover or a click aims at. */
export function centerOf(rect: RectView): XY {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/** Whether `at` lies inside `rect`, which is where it selects that item. */
export function rectContains(rect: RectView, at: XY): boolean {
  return (
    at.x >= rect.x &&
    at.x <= rect.x + rect.width &&
    at.y >= rect.y &&
    at.y <= rect.y + rect.height
  );
}

/** The index of the rectangle `at` lies inside, or `-1` for none. */
export function rectIndexAt(rects: readonly RectView[], at: XY): number {
  return rects.findIndex((rect) => rectContains(rect, at));
}

/**
 * A stage point inside no rectangle the current screen reports, which is where
 * "the pointer inside no rectangle changes nothing" holds.
 *
 * Found by sweeping the stage rather than named as a figure, because WHERE a
 * build lays its menu out is the build's: the specification fixes only that the
 * items occupy disjoint rectangles, so the one thing a check may rely on is that
 * some point of a `1280 x 720` stage is outside all of them.
 */
export async function pointerRest(h: Harness): Promise<XY> {
  const claimed = [...(await menuRects(h)), ...(await tabRects(h))];
  const stride = 16;
  for (let y = stride / 2; y < STAGE_H; y += stride) {
    for (let x = stride / 2; x < STAGE_W; x += stride) {
      const at = { x, y };
      if (rectIndexAt(claimed, at) === -1) return at;
    }
  }
  fail("a stage point inside none of the screen's rectangles", claimed);
}

/**
 * Rest the pointer on a stage point and run the one frame that reads it, and
 * answer what that frame left.
 */
export async function hoverAt(h: Harness, at: XY): Promise<WickSnapshot> {
  await h.movePointer(at.x, at.y);
  return h.step(1);
}

/**
 * Move the real mouse onto a stage point, press it, lift it, and run the ONE
 * frame that reads all three, and answer what that frame left.
 *
 * `specs/controls.md` makes a press arm an item and its release inside the same
 * rectangle take it, and the rules run "on every frame, after that frame's
 * press edges": a whole click delivered between two frames therefore lands its
 * hover, its press and its release on one frame, which is what a real click
 * between two frames does. A check that needs the parts of the gesture APART —
 * a press held across a frame, a drag, a lift somewhere else — drives
 * {@link pressAt}, {@link glideTo} and {@link liftAt} instead, a frame each.
 */
export async function clickAt(h: Harness, at: XY): Promise<WickSnapshot> {
  const css = h.css(at.x, at.y);
  await h.page.mouse.move(css.x, css.y);
  await h.page.mouse.down();
  await h.page.mouse.up();
  return h.step(1);
}

/**
 * Press the real mouse at a stage point and run the one frame that reads it,
 * leaving the button DOWN.
 *
 * The half of a click a check about arming needs: "a primary press edge inside
 * the rectangle of the item at `menuIndex` `i` sets `menuIndex` to `i` ... and
 * arms that item" (specs/controls.md), with the release still to come.
 */
export async function pressAt(h: Harness, at: XY): Promise<WickSnapshot> {
  await mousePress(h, at.x, at.y);
  return h.snapshot();
}

/** Travel the held mouse to a stage point, one driven frame. */
export async function glideTo(h: Harness, at: XY): Promise<WickSnapshot> {
  await mouseGlide(h, at.x, at.y);
  return h.snapshot();
}

/** Lift the real mouse where it stands, one driven frame. */
export async function liftAt(h: Harness): Promise<WickSnapshot> {
  await mouseRelease(h);
  return h.snapshot();
}

/* ---- Touch ---------------------------------------------------------------- */
//
// A REAL CONTACT, for the reason the mouse is a real mouse. `specs/controls.md`
// rule 3 makes a landing the press edge and a lift the release edge, and rule 1
// makes a contact never hover, so a check about touch has to make the build's
// own input layer see a finger arrive, travel and lift. These drive Chromium's
// touch pipeline through the harness's shared drivers, one driven frame per
// part, so a caller counting frames can add them up.

/** Land a real contact at a stage point, run the frame that reads it. */
export async function touchLandAt(h: Harness, at: XY): Promise<WickSnapshot> {
  await touchPress(h, at.x, at.y);
  return h.snapshot();
}

/** Travel the held contact to a stage point, run the frame that reads it. */
export async function touchGlideTo(h: Harness, at: XY): Promise<WickSnapshot> {
  await touchGlide(h, at.x, at.y);
  return h.snapshot();
}

/** Lift the contact where it stands, run the frame that reads it. */
export async function touchLift(h: Harness): Promise<WickSnapshot> {
  await touchRelease(h);
  return h.snapshot();
}

/**
 * Land a contact at a stage point and lift it there: two driven frames.
 *
 * "A touch contact landing inside a rectangle is that rectangle's press edge
 * and lifting is its release edge" (specs/controls.md), and the two are
 * separately observable, so the tap runs a frame for each.
 */
export async function touchTapAt(h: Harness, at: XY): Promise<WickSnapshot> {
  await touchLandAt(h, at);
  return touchLift(h);
}

/**
 * Turn the wheel by `rows` rows of the almanac's list, downward positive, and
 * run the one frame that reads it.
 *
 * `rows` is multiplied by `WHEEL_ROW` (`100`) to give the travel in STAGE units,
 * which "a frame's travel is ... divided by" to give the rows the list moves,
 * and that travel is taken into the CSS pixels the page's wheel events carry
 * through the harness's own fit — the same conversion, inverted, that the build
 * applies to `deltaY`. Fractional `rows` is therefore how a check poses the
 * remainder the rule discards.
 *
 * The pointer is rested first, on `at` or on a point inside none of the screen's
 * rectangles, because a build is free to listen for the wheel on its canvas
 * alone; resting it somewhere the hover rule ignores is what leaves `menuIndex`
 * to the wheel check's own scenario.
 */
export async function wheelBy(
  h: Harness,
  rows: number,
  at?: XY,
): Promise<WickSnapshot> {
  const rest = at ?? (await pointerRest(h));
  await h.movePointer(rest.x, rest.y);
  await h.page.mouse.wheel(0, rows * WHEEL_ROW * h.viewport().cssScale);
  return h.step(1);
}

/* ---- The overlays and the endings ----------------------------------------- */
//
// Each is reached through the REAL path: a chest at the lamplighter's feet and
// the tick that collects it, a queued level-up and the tick that opens it, a
// gem at the center and the tick that collects it, `hp` at `0` and the tick
// that ends the run fallen, the clock at `MAX_POSED_TICK` and the tick that
// reaches dawn. `setScreen` poses the screen field and nothing else, so it
// reaches none of them and no check uses it to.

/**
 * Pose a chest at the lamplighter's center and run the tick that collects it:
 * the real collection, the real result, and `screen` `chest` on a conformant
 * build.
 */
export async function openChest(h: Harness): Promise<WickSnapshot> {
  const at = (await h.snapshot()).run.player;
  await h.debug.spawnPickup("chest", at.x, at.y);
  return h.step(1);
}

/**
 * Queue `count` level-ups and run the tick that opens the overlay: "A `playing`
 * tick that ends with `pendingLevelUps` above `0` runs to completion and then
 * opens the overlay".
 */
export async function openLevelUp(
  h: Harness,
  count = 1,
): Promise<WickSnapshot> {
  await h.debug.setPendingLevelUps(count);
  return h.step(1);
}

/**
 * Pose a gem of `tier` at the lamplighter's center and run the tick that
 * collects it: the real gain path, from which a level-up is derived.
 */
export async function collectGem(
  h: Harness,
  tier: GemTier,
): Promise<WickSnapshot> {
  const at = (await h.snapshot()).run.player;
  await h.debug.spawnGem(tier, at.x, at.y);
  return h.step(1);
}

/** Pose a pickup of `kind` at the lamplighter's center and run the tick that collects it. */
export async function collectPickup(
  h: Harness,
  kind: PickupKind,
): Promise<WickSnapshot> {
  const at = (await h.snapshot()).run.player;
  await h.debug.spawnPickup(kind, at.x, at.y);
  return h.step(1);
}

/**
 * Step one frame at a time until the game stands on `screen`, under a bound.
 *
 * The first read is taken before anything is driven, so a game already on
 * `screen` is a hit at zero frames: establish the screen the scenario starts
 * on before sweeping for the one it should reach.
 */
export function stepUntilScreen(
  h: Harness,
  screen: ScreenName,
  maxFrames = 60,
): Promise<UntilResult> {
  return h.stepUntil((snapshot) => snapshot.screen === screen, {
    maxFrames,
    poll: 1,
  });
}

/* -------------------------------------------------------------------------- */
/* The idle run, the pool, and the documented projection                     */
/* -------------------------------------------------------------------------- */
//
// Three readings the instrumentation checks share. Each is the specification's
// figure restated as a value a check compares against, never a build's: the
// idle run `specs/state.md` lists, the candidate pool `specs/progression.md`
// computes from the slots, and the documented fields of `specs/instrumentation.md`
// picked off whatever else a build chose to report beside them.

/**
 * The idle run of `specs/state.md`: "tick `0`, level `1`, no experience, no
 * kills, the lamplighter at the world origin facing right with `BASE_MAX_HP`
 * (`100`) health, no weapons, no passives, nothing alive, nothing dropped, no
 * offers, no level-ups earned, no chest result, the spawn timer at `0`, no
 * events fired, and the next id `0`", with `hurtFlash` `0` as the idle-run table
 * gives it — with the derived fields each formula
 * gives an empty loadout, and `weapons` as the caller says (a fresh run holds
 * "Taper at level `1` and cooldown `0` in the first weapon slot").
 */
export function idleRun(weapons: readonly WeaponSlotView[] = []): RunView {
  return {
    tick: 0,
    time: 0,
    level: 1,
    xp: 0,
    xpToNext: xpToNext(1),
    kills: 0,
    player: { x: 0, y: 0, facing: "right", hp: BASE_MAX_HP },
    hurtFlash: 0,
    maxHp: BASE_MAX_HP,
    armor: 0,
    moveSpeed: MOVE_SPEED,
    pickupRadius: PICKUP_RADIUS,
    weapons: [...weapons],
    passives: [],
    enemies: [],
    projectiles: [],
    zones: [],
    gems: [],
    pickups: [],
    offers: [],
    pool: [],
    nextOffers: null,
    pendingLevelUps: 0,
    chestResult: null,
    spawnTimer: 0,
    spawnWindow: 0,
    firedEvents: [],
    aliveCommons: 0,
    nextId: 0,
    nextSpawnAngle: null,
    nextSwarmAngle: null,
    nextPuddleOffset: null,
    nextStrikeTarget: null,
    nextChestItem: null,
    nextDrop: null,
  };
}

/** The weapon slot a fresh run starts with: "Taper at level `1` and cooldown `0`". */
export const FRESH_TAPER: WeaponSlotView = {
  id: "taper",
  level: 1,
  cooldown: 0,
};

/**
 * The candidate pool `specs/progression.md` computes "from the slots as they
 * stand": every held base weapon below `MAX_WEAPON_LEVEL` and every held passive
 * below its max as a `+1`; with a weapon slot free, every base weapon not held
 * whose evolution is not held; with a passive slot free, every passive not held
 * — "each id once, in `BASE_WEAPON_IDS` order then `PASSIVE_IDS` order"
 * (specs/instrumentation.md).
 */
export function candidatePool(snapshot: WickSnapshot): OfferId[] {
  const weapons = snapshot.run.weapons ?? [];
  const passives = snapshot.run.passives ?? [];
  const heldWeapon = (id: WeaponId): WeaponSlotView | undefined =>
    weapons.find((slot) => slot.id === id);
  const pool: OfferId[] = [];
  for (const id of BASE_WEAPON_IDS) {
    const held = heldWeapon(id);
    if (held !== undefined) {
      if (held.level < MAX_WEAPON_LEVEL) pool.push(id);
      continue;
    }
    const evolved = evolutionOf(id);
    const evolvedHeld = evolved !== null && heldWeapon(evolved) !== undefined;
    if (weapons.length < WEAPON_SLOTS && !evolvedHeld) pool.push(id);
  }
  for (const id of PASSIVE_IDS) {
    const held = passives.find((slot) => slot.id === id);
    if (held !== undefined) {
      if (held.level < PASSIVES[id].maxLevel) pool.push(id);
      continue;
    }
    if (passives.length < PASSIVE_SLOTS) pool.push(id);
  }
  return pool;
}

/** Pick the named fields off `value`, in that order, dropping everything else. */
function pick<T extends object>(
  value: T,
  fields: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const source = value as Record<string, unknown>;
  for (const field of fields) out[field] = source[field];
  return out;
}

/**
 * The `run` object reduced to the fields `specs/instrumentation.md` documents,
 * nested entries included, so a comparison against a figure the specification
 * states is not thrown by a field a build reports beside them. A missing field
 * is carried as `undefined` and fails the comparison it belongs to.
 */
export function documentedRun(run: RunView): Record<string, unknown> {
  const out = pick(run, RUN_FIELDS);
  const list = <T extends object>(
    entries: readonly T[] | undefined,
    fields: readonly string[],
  ): Record<string, unknown>[] | undefined =>
    Array.isArray(entries)
      ? entries.map((entry) => pick(entry, fields))
      : undefined;
  if (run.player !== undefined && run.player !== null) {
    out.player = pick(run.player, PLAYER_FIELDS);
  }
  out.weapons = list(run.weapons, WEAPON_SLOT_FIELDS);
  out.passives = list(run.passives, PASSIVE_SLOT_FIELDS);
  out.enemies = list(run.enemies, ENEMY_FIELDS)?.map((enemy) => ({
    ...enemy,
    heading:
      typeof enemy.heading === "object" && enemy.heading !== null
        ? pick(enemy.heading, ["x", "y"])
        : enemy.heading,
  }));
  out.projectiles = list(run.projectiles, PROJECTILE_FIELDS)?.map((shape) => ({
    ...shape,
    hits: list(shape.hits as HitEntry[] | undefined, HIT_ENTRY_FIELDS),
  }));
  out.zones = list(run.zones, ZONE_FIELDS)?.map((zone, index) => {
    const source = (run.zones ?? [])[index] as ZoneView;
    const picked: Record<string, unknown> = {
      ...zone,
      hits: list(zone.hits as HitEntry[] | undefined, HIT_ENTRY_FIELDS),
    };
    if (source.width !== undefined) picked.width = source.width;
    if (source.height !== undefined) picked.height = source.height;
    return picked;
  });
  out.gems = list(run.gems, GEM_FIELDS);
  out.pickups = list(run.pickups, PICKUP_FIELDS);
  return out;
}

/** The whole snapshot reduced the same way, `run` included. */
export function documentedSnapshot(
  snapshot: WickSnapshot,
): Record<string, unknown> {
  const out = pick(snapshot, SNAPSHOT_FIELDS);
  if (snapshot.run !== undefined && snapshot.run !== null) {
    out.run = documentedRun(snapshot.run);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* The diagnostics overlay                                                    */
/* -------------------------------------------------------------------------- */
//
// "The overlay is part of the runtime layer you write. It draws the registered
// sources, the backtick key ... shows and hides it, it is off when the game
// starts" (specs/instrumentation.md). It fixes no medium: a build is free to draw
// the overlay on its canvas or to lay it over the page as elements, and both are
// conformant, so a reading of what the overlay SHOWS takes both — the text runs
// the last closed frame drew, and the text the document carries.

/** What the page is showing as text: the last frame's drawn runs, and the document's own text. */
export interface Readout {
  /** Every run of text the last closed frame drew, in draw order. */
  runs: string[];
  /** `document.body.innerText`, the text of whatever the build laid over the page. */
  dom: string;
}

/** Read the text on show: the last closed frame's drawn runs and the document's text. */
export async function readout(h: Harness): Promise<Readout> {
  const runs = drawnText(await h.lastCalls());
  const dom = await h.page.evaluate(() => document.body.innerText ?? "");
  return { runs, dom };
}

/**
 * The runs `after` shows beyond `before`, as a multiset difference, joined with
 * the document text `after` carries beyond `before`'s: what a toggle ADDED.
 */
export function addedText(before: Readout, after: Readout): string[] {
  const counts = new Map<string, number>();
  for (const run of before.runs) counts.set(run, (counts.get(run) ?? 0) + 1);
  const added: string[] = [];
  for (const run of after.runs) {
    const left = counts.get(run) ?? 0;
    if (left > 0) counts.set(run, left - 1);
    else added.push(run);
  }
  const beforeLines = new Set(before.dom.split("\n"));
  for (const line of after.dom.split("\n")) {
    if (line.trim() !== "" && !beforeLines.has(line)) added.push(line);
  }
  return added;
}

/** Whether `a` and `b` show the same text, run for run and line for line. */
export function sameReadout(a: Readout, b: Readout): boolean {
  return addedText(a, b).length === 0 && addedText(b, a).length === 0;
}

/**
 * `text` folded for a loose match: lower-cased, with every space, dash, and
 * underscore removed, so `enemyMotion`, `enemy motion`, and `enemy-motion` are
 * one word. The specification fixes the facts an overlay shows and not their
 * spelling.
 */
export function folded(text: string): string {
  return text.toLowerCase().replace(/[\s_-]+/g, "");
}

/**
 * The documented snapshot less `simTime`: what a POSE is answerable for.
 *
 * A check that a pose "leaves the state as it was" compares this on either side
 * of the call. `simTime` is left out because the specification puts it outside
 * the state a pose governs: "`simTime` and `muted` stand outside that: `simTime`
 * rises by every frame's delta time on every screen" (specs/instrumentation.md,
 * "A render-free core"), and the build's own loop keeps running frames in real
 * time while the clock is held. What a pose may not change is everything else.
 */
export function posedState(snapshot: WickSnapshot): Record<string, unknown> {
  const state = documentedSnapshot(snapshot);
  delete state.simTime;
  return state;
}

/* -------------------------------------------------------------------------- */
/* Bracketing a call inside the page                                          */
/* -------------------------------------------------------------------------- */
//
// WHY A CALL IS EVER BRACKETED THIS WAY. `specs/instrumentation.md` leaves the
// build's own frame loop running while the clock is held: "the build's own loop
// keeps running frames in real time, each reading the keys, reconciling the
// loops, mirroring `muted`, and rendering", and "`simTime` rises by the delta
// time of every frame, whatever the screen". A real-time frame that lands
// between two crossings of this boundary therefore adds its own delta to
// `simTime` and may start a looping cue, and a check that read the state with
// one `snapshot()` crossing before a call and another after it would be reading
// that frame as well as the call. Nothing the page's own `requestAnimationFrame`
// runs can interleave with ONE synchronous evaluation, so a pair of readings
// taken inside one is of the call alone.
//
// Only two readings need it: `simTime`, which every frame moves, and the sounds
// a POSE is answerable for, which the next frame reconciles. Every other figure
// — a position, a timer, a held slot, a screen, the run clock — is untouched by
// a held frame and is read the ordinary way.

/** What one bracketed call left, read either side of it inside the page. */
export interface Bracketed {
  /** The state as the call found it. */
  before: WickSnapshot;
  /** The state the call left. */
  after: WickSnapshot;
  /** Every sound the build emitted between the two readings. */
  sounds: Sound[];
}

/** What a bracketed call is made under. */
export interface BracketOptions {
  /**
   * A key held down for the call and released after it, as a dispatched
   * `KeyboardEvent` raised inside the same evaluation, so no frame of the
   * build's own loop can read its press edge before the bracketed one does.
   * "A dispatched keyboard event moves the lamplighter and works the menus
   * exactly as a player's key does" (specs/instrumentation.md).
   */
  hold?: string;
}

/**
 * Call one operation on the surface with the state and the audio probe read
 * either side of it, all inside one synchronous evaluation.
 *
 * The call goes through the build's own `window.__wick`, exactly as `h.debug`
 * sends it, so nothing about what the operation sees differs; what differs is
 * that no frame of the build's own loop can run between the two readings.
 */
export async function bracket(
  h: Harness,
  op: keyof WickDebugApi,
  args: readonly unknown[] = [],
  options: BracketOptions = {},
): Promise<Bracketed> {
  return (await h.page.evaluate(
    ([handle, audioGlobal, name, rest, held]) => {
      const globals = window as unknown as Record<
        string,
        Record<string, (...a: unknown[]) => unknown>
      >;
      const api = globals[handle];
      if (api === undefined) {
        throw new Error(`wick: the surface ${handle} is not installed`);
      }
      const active = document.activeElement;
      const target =
        active instanceof HTMLElement && active !== document.documentElement
          ? active
          : document.body;
      const key = (kind: string, code: string): void => {
        target.dispatchEvent(
          new KeyboardEvent(kind, {
            code,
            key: code,
            repeat: false,
            bubbles: true,
            cancelable: true,
            composed: true,
          }),
        );
      };
      const audio = globals[audioGlobal];
      const from = audio === undefined ? 0 : (audio.count!() as number);
      if (held !== null) key("keydown", held);
      const before = api.snapshot!();
      try {
        api[name]!(...rest);
      } finally {
        if (held !== null) key("keyup", held);
      }
      const after = api.snapshot!();
      const sounds = audio === undefined ? [] : audio.since!(from);
      return { before, after, sounds };
    },
    [
      HANDLE,
      AUDIO_PROBE_GLOBAL,
      op as string,
      args,
      options.hold ?? null,
    ] as const,
  )) as Bracketed;
}

/**
 * Run `frames` frames of the build's `step` with the state read either side of
 * them, all inside one synchronous evaluation, each frame opened and closed as
 * one recorded frame so a capture wrapped around this call films every one.
 *
 * {@link Harness.step} already runs its frames inside one evaluation; what this
 * adds is the reading taken BEFORE the first of them in that same evaluation,
 * which is what a `simTime` figure over a stretch of frames needs. The harness's
 * own frame counter does not move, so a check that reads `h.frame()` drives with
 * {@link Harness.step} instead.
 */
export async function stepBracketed(
  h: Harness,
  frames: number,
): Promise<{ before: WickSnapshot; after: WickSnapshot }> {
  return (await h.page.evaluate(
    ([handle, recorderGlobal, count, deltaMs]) => {
      const globals = window as unknown as Record<
        string,
        Record<string, (...a: unknown[]) => unknown>
      >;
      const api = globals[handle];
      if (api === undefined) {
        throw new Error(`wick: the surface ${handle} is not installed`);
      }
      const rec = globals[recorderGlobal];
      const before = api.snapshot!();
      for (let i = 0; i < (count as number); i += 1) {
        rec?.begin!();
        api.step!(1);
        rec?.end!(deltaMs);
      }
      const after = api.snapshot!();
      return { before, after };
    },
    [HANDLE, h.config.recorderGlobal, frames, TICK_MS] as const,
  )) as { before: WickSnapshot; after: WickSnapshot };
}

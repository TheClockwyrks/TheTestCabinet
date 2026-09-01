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
// exactly that, and it lives once, in `@test-cabinet/case-harness`, staged beside
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
  type Harness as BaseHarness,
  type HarnessOptions,
  type UntilOptions,
  type UntilResult as BaseUntilResult,
} from "./case-harness/index";
import { fail } from "./assert";
import {
  BINDINGS,
  CUE_NAMES,
  DEFAULT_SEED,
  HANDLE,
  OVERLAY_KEY,
  REQUIRED_OPS,
  STAGE_CX,
  STAGE_CY,
  STAGE_H,
  STAGE_W,
  SWITCH_NAMES,
  TICK_HZ,
  UNBOUND_KEY,
  type Action,
  type EnemyId,
  type EvolutionId,
  type Facing,
  type GemTier,
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
}

/**
 * The state a snapshot reports, as `specs/instrumentation.md` documents it under
 * "Snapshot shape".
 */
export interface WickSnapshot {
  version: number;
  screen: ScreenName;
  menuIndex: number;
  /** Whether the frame loop advances the simulation from the wall clock. */
  autoStep: boolean;
  spawning: boolean;
  events: boolean;
  despawning: boolean;
  enemyMotion: boolean;
  enemyContact: boolean;
  weaponFire: boolean;
  effectMotion: boolean;
  run: RunView;
  muted: boolean;
  /** Frame time waiting for the next tick, in seconds. */
  accumulator: number;
  /** Accumulated simulation time, in seconds. */
  simTime: number;
  rngState: number;
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
  /** Restore every declared field to its title-screen value and reseed. */
  reset(options?: { seed?: number }): Promise<void>;
  /** A pure read of the running game. */
  snapshot(): Promise<WickSnapshot>;
  /** Enter a screen exactly as the real transition into it does. */
  setScreen(name: ScreenName): Promise<void>;
  /** On `levelup`, accept the offer at `index`. */
  choose(index: number): Promise<void>;
  setSpawning(on: boolean): Promise<void>;
  setEvents(on: boolean): Promise<void>;
  setDespawning(on: boolean): Promise<void>;
  setEnemyMotion(on: boolean): Promise<void>;
  setEnemyContact(on: boolean): Promise<void>;
  setWeaponFire(on: boolean): Promise<void>;
  setEffectMotion(on: boolean): Promise<void>;
  /** Set `tick`, `0` to `MAX_POSED_TICK`; nothing else changes. */
  setTick(tick: number): Promise<void>;
  setSpawnTimer(seconds: number): Promise<void>;
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
 * How long {@link Harness.armAudio} waits for the build's fifteen cue files to
 * finish decoding before it gives up waiting.
 *
 * A build decodes its audio asynchronously, and a scenario that raised an event
 * before its cue's clip arrived would read silence from a build that was
 * simply still starting up. The wait is a poll that returns the instant the
 * fifteenth file lands, so a healthy build pays nothing; a build that never
 * decodes anything spends the ceiling once per harness and then fails its cue
 * points on their own terms.
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
  // The seed the opening `reset` fixes, so a scenario driven from a fresh
  // harness is reproducible from that line on. `specs/instrumentation.md`
  // defaults `options.seed` to `DEFAULT_SEED` itself, and the harness passes it
  // explicitly so the call the build sees is the same one whether or not a check
  // named a seed of its own. The check that is ABOUT the default calls
  // `reset()` with no argument itself.
  defaultSeed: DEFAULT_SEED,
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
 */
export async function createHarness(
  options?: HarnessOptions,
): Promise<Harness> {
  const base = await kit.createHarness(options);
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
    async armAudio() {
      await base.armAudio();
      await waitForCues(base.page);
    },
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

/** The seven switches, as the snapshot reports them. */
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
// broken in exactly those rules. {@link isolate} is the shape of that — it opens
// a fresh run, empties the world, drops the starting weapon, turns every driver
// switch off, and lifts the level out of reach of any gain a scenario's kills
// produce. A check then turns on exactly the faculties it is about.

/**
 * The level {@link isolate} poses the run at.
 *
 * `xpToNext(50)` is `495`, so no gem a scenario's kills drop and collect
 * crosses a threshold and opens an overlay in the middle of a check that is not
 * about level-ups. A check that reads `level` poses its own with `setLevel`
 * after isolating. This is the harness's own figure, not the specification's.
 */
export const ISOLATE_LEVEL = 50;

/** What {@link isolate} arranges. Every field is optional; each defaults below. */
export interface IsolateOptions {
  /** The seed the reset is given. Defaults to `DEFAULT_SEED`. */
  seed?: number;
  /** The level to pose. Defaults to {@link ISOLATE_LEVEL}. */
  level?: number;
  /** Keep the Taper a fresh run starts with, instead of removing it. Off by default. */
  keepTaper?: boolean;
  /**
   * The faculties to turn back on once every switch is off: exactly the ones
   * the check is about. Defaults to none.
   */
  on?: readonly SwitchName[];
}

/**
 * Open a fresh run and pose an isolated night on it.
 *
 * The order is the one the operations' own definitions force: the reset first,
 * so nothing a previous section left is inherited and every switch comes back
 * on as `reset` restores them; `setScreen("playing")` next, which "begins a
 * fresh run exactly as `LIGHT THE LAMP` ... do[es]" with Taper alone in the
 * first slot; then, over the running session, every switch off, every entity
 * kind cleared, every held slot emptied, and the level lifted. Nothing here
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
  await h.debug.reset({ seed: options.seed ?? DEFAULT_SEED });
  await h.debug.setScreen("playing");
  await holdAll(h);
  await h.debug.clearEnemies();
  await h.debug.clearProjectiles();
  await h.debug.clearZones();
  await h.debug.clearGems();
  await h.debug.clearPickups();
  const opened = await h.snapshot();
  if (options.keepTaper !== true) {
    for (
      let slot = (opened.run.weapons ?? []).length - 1;
      slot >= 0;
      slot -= 1
    ) {
      await h.debug.removeWeapon(slot);
    }
  }
  for (
    let slot = (opened.run.passives ?? []).length - 1;
    slot >= 0;
    slot -= 1
  ) {
    await h.debug.removePassive(slot);
  }
  await h.debug.setLevel(options.level ?? ISOLATE_LEVEL);
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
 */
export async function startRun(
  h: Harness,
  seed: number = DEFAULT_SEED,
): Promise<WickSnapshot> {
  await h.debug.reset({ seed });
  await h.debug.setScreen("playing");
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
export async function startRunFromTitle(
  h: Harness,
  seed: number = DEFAULT_SEED,
): Promise<WickSnapshot> {
  await h.debug.reset({ seed });
  return pressConfirm(h);
}

/** Enter `screen` exactly as the real transition does, and read what it left. */
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

/* ---- The overlays and the endings ----------------------------------------- */
//
// Each is reached through the REAL path: a chest at the lamplighter's feet and
// the tick that collects it, a queued level-up and the tick that opens it, a
// gem at the center and the tick that collects it. `setScreen("levelup")` and
// the `fallen`/`dawn` rows of `setScreen` serve the screen-copy checks alone.

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

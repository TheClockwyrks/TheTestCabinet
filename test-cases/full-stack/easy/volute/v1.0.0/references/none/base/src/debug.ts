// Volute — the debugging and automation surface, `window.__volute`
// (specs/instrumentation.md).
//
// It is installed as soon as the game has initialized, and it is inert during
// normal play: nothing below runs until something calls it.
//
// EVERY OPERATION IS A READ OR A POSE. A pose ARRANGES THE HALL and never
// fabricates an outcome: it puts the game into a situation, and the game's own
// tick — the real advance, the real strike, the real extraction — is what runs
// from there. So a scenario driven from code behaves exactly like one played by
// hand, and every insertion, extraction, score, chain step, mark, cell, clear and
// ending a scenario reads comes from the ticks it ran, not from the call that set
// it up.
//
// NO OPERATION DECLINES. Each applies at the call whatever the screen: the screen
// showing, the interlude running and where the train stands are how a PLAYER
// reaches a thing and are not an operation's conditions. A numeric argument
// outside a range the specification FIXES AS A CONSTANT names no state the hall
// has, so the call THROWS rather than snapping to the nearest legal value; an
// angle names a heading whatever its value, so it is normalized rather than
// refused. A bound that reads a LIVE figure of the run — the level's quota — is a
// rule of the run rather than a domain, so the value given is applied whatever
// the run stands at. A call naming nothing the
// game holds a state for — an argument that is not a number, or a screen, charge,
// mark or machinery kind outside the set that names them — THROWS, so a caller
// never reads a call that did nothing as a call that did. Nothing here refuses
// quietly by handing back the value it was already holding.
//
// THE TWO CLOCK OPERATIONS reach past the state into the runtime, because this
// build stands on no engine and nothing outside it owns its clock. Everything else
// about driving a browser game stays absent: there is no key press (the runtime's
// registered actions are driven by dispatching real key events at the page) and no
// overlay control (the runtime draws the panel and owns the backtick key).

import {
  CELLS,
  CHAIN_RESET,
  CHARGE_IDS,
  DEFAULT_SEED,
  LEVEL_COUNT,
  MACHINERY_KINDS,
  PATH_LENGTH,
  PRESSURE_MAX,
  PRESSURE_MIN,
  SCREENS,
  VOLUTE_DEBUG_VERSION,
  VOLUTE_HANDLE,
} from "./constants";
import type { ChargeId, MachineryKind, ScreenName } from "./constants";
import { pointAt } from "./channel";
import { newReport } from "./events";
import { inDanger, fire as fireCore, grantMachinery } from "./sim";
import { levelSpec, normalizeAngle, startLevel, toTitle } from "./state";
import { effectiveFeed, resegment, spaced } from "./train";
import type { CueName } from "./constants";
import type { FxEvent } from "./events";
import type { VoluteState } from "./types";

/**
 * What the surface needs from the layer beneath it.
 *
 * Narrower than the whole runtime on purpose: the surface reaches past the state
 * only for the clock, for the cues a pose leaves for the next tick to sound, and
 * for the live effects a re-opened hall clears. `src/runtime.ts` satisfies it
 * without knowing this file exists.
 */
export interface DebugHost {
  /** The game's state, live. */
  readonly state: VoluteState;
  /** Take the game off the wall clock, or give it back. */
  setAutoStep(enabled: boolean): void;
  /** Run whole simulation ticks, each the full tick followed by a render. */
  step(ticks: number): void;
  /** Hold a cue a pose raised until the next tick sounds it. */
  queueCue(cue: CueName): void;
  /** Play an effect over the hall. */
  spawnFx(event: FxEvent): void;
  /** Drop every live effect. */
  clearEffects(): void;
}

/** One core, as `poseTrain` takes it: `[s, charge, mark]`. */
export type PosedCore = [number, string, string | null];

/** One core of the train, as `snapshot` reports it. */
export interface TrainSnapshot {
  s: number;
  x: number;
  y: number;
  charge: ChargeId;
  mark: MachineryKind | null;
  /** `0` is the lead segment, rising toward the tail. */
  segment: number;
}

/** One segment, as `snapshot` reports it. */
export interface SegmentSnapshot {
  count: number;
  /** The recoil hold's seconds left. */
  hold: number;
}

/** One projectile, as `snapshot` reports it. */
export interface ProjectileSnapshot {
  x: number;
  y: number;
  angle: number;
  charge: ChargeId;
}

/** The plain, JSON-serializable view `snapshot()` returns. */
export interface VoluteSnapshot {
  version: number;
  screen: ScreenName;
  score: number;
  level: number;
  cells: number;
  quotaRemaining: number;
  /** The level's quota less `quotaRemaining`. */
  emitted: number;
  pressure: number;
  /** The effective feed speed, in units per second. */
  feedSpeed: number;
  chainStep: number;
  chainTimer: number;
  interlude: number;
  danger: boolean;
  train: TrainSnapshot[];
  segments: SegmentSnapshot[];
  injector: {
    aim: number;
    cooldown: number;
    loaded: ChargeId | null;
    queued: ChargeId | null;
  };
  projectiles: ProjectileSnapshot[];
  machinery: { kind: MachineryKind; remaining: number } | null;
  /** Whether the inlet emits. */
  emission: boolean;
  /** Whether the train advances. */
  feed: boolean;
  /** Whether the frame loop advances the simulation. */
  autoStep: boolean;
  muted: boolean;
  simTime: number;
  rngState: number;
}

/** The surface `window.__volute` carries. */
export interface VoluteDebugApi {
  version: number;
  setAutoStep(enabled: boolean): void;
  step(ticks?: number): void;
  reset(options?: { seed?: number }): void;
  /** Bring every reported reading into agreement with the hall as it stands. */
  reconcile(): void;
  snapshot(): VoluteSnapshot;
  setScreen(name: string): void;
  setLevel(level: number): void;
  setScore(n: number): void;
  setCells(n: number): void;
  setChainStep(k: number): void;
  startLevel(level: number): void;
  poseTrain(cores: readonly PosedCore[]): void;
  clearTrain(): void;
  setLoaded(charge: string): void;
  setQueued(charge: string): void;
  setAim(angleDegrees: number): void;
  fire(): void;
  setPressure(value: number): void;
  setQuotaRemaining(n: number): void;
  setEmission(enabled: boolean): void;
  setFeed(enabled: boolean): void;
  grantMachinery(kind: string): void;
  pause(): void;
  resume(): void;
}

/** A charge id. A value naming none of the five fails loudly. */
function mustCharge(where: string, value: unknown): ChargeId {
  if (!CHARGE_IDS.includes(value as ChargeId)) {
    throw new Error(
      `${where}: charge must be one of ${CHARGE_IDS.join(", ")}; got ${String(value)}`,
    );
  }
  return value as ChargeId;
}

/**
 * A core's mark: one of the four machinery kinds, or `null` for an unmarked
 * core. Anything else names no mark and fails loudly.
 */
function mustMark(where: string, value: unknown): MachineryKind | null {
  if (value === null || value === undefined) return null;
  if (!MACHINERY_KINDS.includes(value as MachineryKind)) {
    throw new Error(
      `${where}: mark must be null or one of ${MACHINERY_KINDS.join(", ")}; got ${String(value)}`,
    );
  }
  return value as MachineryKind;
}

/** The three kinds `grantMachinery` grants; `bore` is not one of them. */
const TIMED_KINDS: readonly MachineryKind[] = [
  "choke",
  "backflow",
  "sightline",
];

/** One of the three timed kinds. A name outside them fails loudly. */
function mustTimedKind(value: unknown): MachineryKind {
  if (!TIMED_KINDS.includes(value as MachineryKind)) {
    throw new Error(
      `grantMachinery: kind must be one of ${TIMED_KINDS.join(", ")}; got ${String(value)}`,
    );
  }
  return value as MachineryKind;
}

/** A screen name. A name outside the seven names no screen and fails loudly. */
function mustScreen(value: unknown): ScreenName {
  if (!SCREENS.includes(value as ScreenName)) {
    throw new Error(
      `setScreen: name must be one of ${SCREENS.join(", ")}; got ${String(value)}`,
    );
  }
  return value as ScreenName;
}

/**
 * A finite number. Anything else is not a figure the game has a state for, so
 * the call fails loudly rather than quietly keeping the value it already held.
 */
function mustNumber(where: string, name: string, value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(
      `${where}: ${name} must be a finite number; got ${String(value)}`,
    );
  }
  return value;
}

/**
 * A finite number inside a range the specification FIXES AS A CONSTANT. That
 * range is the argument's domain rather than a rule of the run, so a value
 * outside it names no state the hall has and the call fails loudly rather than
 * snapping to the nearest legal value.
 */
function mustRange(
  where: string,
  name: string,
  value: unknown,
  lo: number,
  hi: number,
): number {
  const n = mustNumber(where, name, value);
  if (n < lo || n > hi) {
    throw new Error(`${where}: ${name} must be ${lo} through ${hi}; got ${n}`);
  }
  return n;
}

/**
 * A finite number no greater than a maximum the specification FIXES AS A
 * CONSTANT. The maximum is the argument's domain rather than a rule of the run,
 * so a value past it names no state the hall has and the call fails loudly
 * rather than snapping back to it.
 */
function mustAtMost(
  where: string,
  name: string,
  value: unknown,
  hi: number,
): number {
  const n = mustNumber(where, name, value);
  if (n > hi) {
    throw new Error(`${where}: ${name} must be at most ${hi}; got ${n}`);
  }
  return n;
}

/** A finite number, or `fallback` when the argument was left out entirely. */
function mustNumberOr(
  where: string,
  name: string,
  value: unknown,
  fallback: number,
): number {
  return value === undefined ? fallback : mustNumber(where, name, value);
}

/** Build the surface over one live state and the runtime driving it. */
export function createDebugApi(host: DebugHost): VoluteDebugApi {
  const state: VoluteState = host.state;

  return {
    version: VOLUTE_DEBUG_VERSION,

    /**
     * Take the game off real time, and give it back.
     *
     * `false` stops the frame loop feeding the wall clock's delta into the tick
     * accumulator, so the hall advances only when `step` says so; `true` returns it
     * to running itself, which is how a build starts and how it is played. Drawing
     * is unaffected either way.
     */
    setAutoStep(enabled) {
      host.setAutoStep(Boolean(enabled));
    },

    /**
     * Run `ticks` whole simulation ticks, immediately and in order, each the full
     * tick followed by a render.
     *
     * Stepping while the game is still stepping automatically ADDS to what the wall
     * clock is already doing, so a scenario that must be reproducible calls
     * `setAutoStep(false)` first.
     */
    step(ticks = 1) {
      host.step(mustNumberOr("step", "ticks", ticks, 1));
    },

    /**
     * Restore every declared field to its title-screen value and reseed the
     * generator.
     *
     * `muted` is deliberately untouched: muting is a player preference the runtime
     * owns, and a reset is not a reason to start making noise again. Whether the
     * game is stepping itself is not restored either — `setAutoStep` is how that is
     * said, and a driver resetting mid-scenario means to re-pose the hall, not to
     * hand it back to real time.
     */
    reset(options) {
      toTitle(state);
      state.rngState =
        mustNumberOr("reset", "options.seed", options?.seed, DEFAULT_SEED) >>>
        0;
      host.clearEffects();
    },

    /**
     * Bring every reported reading into agreement with the hall as it stands,
     * without advancing anything.
     *
     * Most of what this surface reports is worked out at the read — `emitted`,
     * `feedSpeed`, `danger`, each core's point on the channel and its segment
     * index — so a pose leaves nothing of those behind. The SEGMENTS are the
     * exception: this build keeps them, and a write to the cores can leave them
     * describing a channel that no longer stands. `resegment` is the same rule
     * the tick builds them by, reading the spacing between consecutive cores and
     * nothing else, so no core moves, no time is spent, nothing sounds, and
     * running it twice leaves what running it once left.
     */
    reconcile() {
      resegment(state);
    },

    /** A pure read of the running game. It changes nothing. */
    snapshot() {
      return snapshot(state);
    },

    /**
     * Set the screen, and change nothing else.
     *
     * No level is opened, no channel is seeded, no timer is started, and no
     * interlude is set: the ending a screen names holds whatever the run behind
     * it stands at, which is what lets a caller pose one and dismiss it.
     */
    setScreen(name) {
      state.screen = mustScreen(name);
    },

    /**
     * Set the level in play, and change nothing else.
     *
     * The level's feed speed and its charge set follow at once, because both are
     * read off `state.level` where they are needed rather than copied out of it.
     */
    setLevel(level) {
      state.level = Math.round(
        mustRange("setLevel", "level", level, 1, LEVEL_COUNT),
      );
    },

    /** Set the run's score, which the specification fixes at `0` or above. */
    setScore(n) {
      state.score = Math.round(
        mustRange("setScore", "n", n, 0, Number.MAX_SAFE_INTEGER),
      );
    },

    /**
     * Set the cells remaining, which the specification fixes at `0` through
     * `CELLS`.
     *
     * It ends no run: `setCells(0)` leaves the screen where it stands, and the
     * ending a spent last cell reaches comes from the ticks run after the pose.
     */
    setCells(n) {
      state.cells = Math.round(mustRange("setCells", "n", n, 0, CELLS));
    },

    /**
     * Set the chain step an extraction scores at, which the specification fixes
     * at `1` or above, and restart the window that returns it to `1`.
     *
     * The window is restarted because that is what a step above `1` means: the
     * step is the standing value of a chain that is still running, and a step
     * posed under a window already at `0` would hold for the rest of the level.
     */
    setChainStep(k) {
      state.chainStep = Math.round(
        mustRange("setChainStep", "k", k, 1, Number.MAX_SAFE_INTEGER),
      );
      state.chainTimer = CHAIN_RESET;
    },

    /** Open `level`, exactly as the interlude before it opens it. */
    startLevel(level) {
      startLevel(
        state,
        Math.round(mustRange("startLevel", "level", level, 1, LEVEL_COUNT)),
      );
      host.clearEffects();
    },

    /**
     * Replace every core on the channel with the cores given.
     *
     * The train orders them by descending arc position whatever order the list
     * arrived in, two cores at the same position keeping the order the list gave
     * them. Segments follow from the spacing and every recoil hold is cleared, so a
     * posed train advances on the tick after the call.
     */
    poseTrain(cores) {
      const posed = [...(cores ?? [])].map((core, index) => ({
        charge: mustCharge(`poseTrain: core ${index}`, core?.[1]),
        s: mustAtMost("poseTrain", `core ${index}'s s`, core?.[0], PATH_LENGTH),
        mark: mustMark(`poseTrain: core ${index}`, core?.[2]),
        hold: 0,
      }));
      posed.sort((a, b) => b.s - a.s);
      state.cores = posed;
      resegment(state);
    },

    /**
     * Remove every core from the channel and every projectile.
     *
     * Nothing extracts, nothing scores, and no cell is spent: the cores are simply
     * gone, with no removal and so no recoil, no pressure drop and no grant.
     */
    clearTrain() {
      state.cores = [];
      state.segments = [];
      state.projectiles = [];
    },

    /** Set the charge the injector holds loaded. The generator is untouched. */
    setLoaded(charge) {
      state.loaded = mustCharge("setLoaded", charge);
    },

    /** Set the charge the injector holds queued. The generator is untouched. */
    setQueued(charge) {
      state.queued = mustCharge("setQueued", charge);
    },

    /** Set the aim, normalized into `[0, 360)`, and do nothing else. */
    setAim(angleDegrees) {
      state.aim = normalizeAngle(
        mustNumber("setAim", "angleDegrees", angleDegrees),
      );
    },

    /**
     * Release the loaded core along the current aim, through the same path the
     * fire control takes.
     *
     * Any cooldown outstanding at the call is cleared first, so the call always
     * launches, and a call made while the injector holds no loaded core draws one
     * first. The flight, the strike, the insertion and any extraction the insertion
     * causes come from the ticks that follow.
     */
    fire() {
      state.fireCooldown = 0;
      const report = newReport();
      fireCore(state, report);
      for (const cue of report.cues) host.queueCue(cue);
      for (const event of report.fx) host.spawnFx(event);
    },

    /** Set the pressure, whose range the specification fixes as a constant. */
    setPressure(value) {
      state.pressure = mustRange(
        "setPressure",
        "value",
        value,
        PRESSURE_MIN,
        PRESSURE_MAX,
      );
    },

    /**
     * Set the cores the inlet has left to emit this level.
     *
     * The count of cores emitted this level is the level's quota less what remains,
     * so which of the following emissions carry a mark, and which kind each mark is,
     * follow the new value.
     *
     * The level's quota does NOT bound the argument. It is a live figure of the
     * run rather than a domain the specification fixes, so the count given is the
     * count the inlet is left with and the hall runs from there.
     */
    setQuotaRemaining(n) {
      state.quotaRemaining = Math.round(
        mustRange("setQuotaRemaining", "n", n, 0, Number.MAX_SAFE_INTEGER),
      );
    },

    /**
     * Hold the inlet, or let it go again.
     *
     * Independent of the quota, so a hall whose quota is untouched and whose
     * inlet is held emits nothing and is never cleared for an exhausted quota.
     */
    setEmission(enabled) {
      state.emission = Boolean(enabled);
    },

    /**
     * Hold the train where it stands, or let it advance again.
     *
     * Step 2 of the tick alone: every other step runs unchanged while the train
     * is held, so a strike still seats, a removal still recoils, and the inlet
     * still emits.
     */
    setFeed(enabled) {
      state.feed = Boolean(enabled);
    },

    /**
     * Grant one of the three timed kinds, exactly as extracting a run holding a
     * mark of that kind grants it.
     *
     * `bore` is not granted here: it removes cores and scores the moment it
     * resolves, and no pose decides an outcome, so a bore is reached by posing a
     * run that carries a `bore` mark and letting the ticks extract it.
     */
    grantMachinery(kind) {
      const report = newReport();
      grantMachinery(state, mustTimedKind(kind), report);
      for (const cue of report.cues) host.queueCue(cue);
      for (const event of report.fx) host.spawnFx(event);
    },

    /** Pose the pause control. */
    pause() {
      state.screen = "paused";
    },

    /** Pose the pause control again. */
    resume() {
      state.screen = "playing";
    },
  };
}

/** The whole snapshot, read straight off the state. */
export function snapshot(state: VoluteState): VoluteSnapshot {
  const train: TrainSnapshot[] = [];
  let segment = 0;
  for (let i = 0; i < state.cores.length; i += 1) {
    const core = state.cores[i];
    if (i > 0 && !spaced(state.cores[i - 1], core)) segment += 1;
    const point = pointAt(core.s);
    train.push({
      s: core.s,
      x: point.x,
      y: point.y,
      charge: core.charge,
      mark: core.mark,
      segment,
    });
  }

  return {
    version: VOLUTE_DEBUG_VERSION,
    screen: state.screen,
    score: state.score,
    level: state.level,
    cells: state.cells,
    quotaRemaining: state.quotaRemaining,
    emitted: levelSpec(state.level).quota - state.quotaRemaining,
    pressure: state.pressure,
    feedSpeed: effectiveFeed(state),
    chainStep: state.chainStep,
    chainTimer: state.chainTimer,
    interlude: state.interlude,
    danger: inDanger(state),
    train,
    segments: state.segments.map((entry) => ({
      count: entry.count,
      hold: entry.hold,
    })),
    injector: {
      aim: state.aim,
      cooldown: state.fireCooldown,
      loaded: state.loaded,
      queued: state.queued,
    },
    projectiles: state.projectiles.map((projectile) => ({
      x: projectile.x,
      y: projectile.y,
      angle: projectile.angle,
      charge: projectile.charge,
    })),
    machinery:
      state.machinery === null
        ? null
        : {
            kind: state.machinery.kind,
            remaining: state.machinery.remaining,
          },
    emission: state.emission,
    feed: state.feed,
    autoStep: state.autoStep,
    muted: state.muted,
    simTime: state.simTime,
    rngState: state.rngState >>> 0,
  };
}

/**
 * Install the surface on `window.__volute` and return the function that removes it
 * again, while the installed object is still the one this call published.
 */
export function installDebugApi(host: DebugHost): () => void {
  const api = createDebugApi(host);
  const target = globalThis as unknown as Record<string, unknown>;
  target[VOLUTE_HANDLE] = api;
  return () => {
    if (target[VOLUTE_HANDLE] === api) delete target[VOLUTE_HANDLE];
  };
}

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
// NO POSE DECLINES. Each applies at the call whatever the screen, and an argument
// outside its range is clamped to the nearest legal value or normalized.
//
// THE TWO CLOCK OPERATIONS reach past the state into the runtime, because this
// build stands on no engine and nothing outside it owns its clock. Everything else
// about driving a browser game stays absent: there is no key press (the runtime's
// registered actions are driven by dispatching real key events at the page) and no
// overlay control (the runtime draws the panel and owns the backtick key).

import {
  CHARGE_IDS,
  DEFAULT_SEED,
  LEVEL_COUNT,
  MACHINERY_KINDS,
  PATH_LENGTH,
  PRESSURE_MAX,
  PRESSURE_MIN,
  VOLUTE_DEBUG_VERSION,
  VOLUTE_HANDLE,
} from "./constants";
import type { ChargeId, MachineryKind, ScreenName } from "./constants";
import { pointAt } from "./channel";
import { newReport } from "./events";
import { inDanger, fire as fireCore, grantMachinery } from "./sim";
import {
  levelSpec,
  normalizeAngle,
  startLevel,
  startRun,
  toTitle,
} from "./state";
import { clamp, effectiveFeed, resegment, spaced } from "./train";
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
  snapshot(): VoluteSnapshot;
  start(): void;
  startLevel(level: number): void;
  poseTrain(cores: readonly PosedCore[]): void;
  clearTrain(): void;
  setLoaded(charge: string): void;
  setQueued(charge: string): void;
  fire(angleDegrees: number): void;
  setPressure(value: number): void;
  setQuotaRemaining(n: number): void;
  grantMachinery(kind: string): void;
  pause(): void;
  resume(): void;
}

/** A charge id, or the first of the five when the argument names none. */
function asCharge(value: unknown): ChargeId {
  return CHARGE_IDS.includes(value as ChargeId)
    ? (value as ChargeId)
    : CHARGE_IDS[0];
}

/** A machinery kind, or `null` when the argument names none. */
function asMark(value: unknown): MachineryKind | null {
  return MACHINERY_KINDS.includes(value as MachineryKind)
    ? (value as MachineryKind)
    : null;
}

/** A finite number, or a stated fallback. */
function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
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
      host.step(asNumber(ticks, 1));
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
      state.rngState = asNumber(options?.seed, DEFAULT_SEED) >>> 0;
      host.clearEffects();
    },

    /** A pure read of the running game. It changes nothing. */
    snapshot() {
      return snapshot(state);
    },

    /**
     * Pose exactly what the start control on the title does: the score `0`, the
     * cells full, and level `1` opened as `startLevel` opens it.
     *
     * The generator's state and `simTime` stay as they are, so a run from a known
     * seed is a `reset` followed by this.
     */
    start() {
      startRun(state);
      host.clearEffects();
    },

    /** Open `level`, exactly as the interlude before it opens it. */
    startLevel(level) {
      startLevel(state, clamp(Math.round(asNumber(level, 1)), 1, LEVEL_COUNT));
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
      const posed = [...(cores ?? [])].map((core) => ({
        charge: asCharge(core?.[1]),
        s: Math.min(PATH_LENGTH, asNumber(core?.[0], 0)),
        mark: asMark(core?.[2]),
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
      state.loaded = asCharge(charge);
    },

    /** Set the charge the injector holds queued. The generator is untouched. */
    setQueued(charge) {
      state.queued = asCharge(charge);
    },

    /**
     * Aim at `angleDegrees` and release the loaded core along it, through the same
     * path the fire control takes.
     *
     * Any cooldown outstanding at the call is cleared first, so the call always
     * launches, and a call made while the injector holds no loaded core draws one
     * first. The flight, the strike, the insertion and any extraction the insertion
     * causes come from the ticks that follow.
     */
    fire(angleDegrees) {
      state.aim = normalizeAngle(asNumber(angleDegrees, state.aim));
      state.fireCooldown = 0;
      const report = newReport();
      fireCore(state, report);
      for (const cue of report.cues) host.queueCue(cue);
      for (const event of report.fx) host.spawnFx(event);
    },

    /** Set the pressure, clamped to its range. */
    setPressure(value) {
      state.pressure = clamp(
        asNumber(value, state.pressure),
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
     */
    setQuotaRemaining(n) {
      state.quotaRemaining = clamp(
        Math.round(asNumber(n, 0)),
        0,
        levelSpec(state.level).quota,
      );
    },

    /**
     * Grant a kind exactly as extracting a run holding a mark of that kind grants
     * it: the three timed kinds become the active machinery at their full duration,
     * and `bore` resolves at once, centered on the head core's position.
     */
    grantMachinery(kind) {
      const report = newReport();
      grantMachinery(state, asMark(kind) ?? MACHINERY_KINDS[0], report);
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

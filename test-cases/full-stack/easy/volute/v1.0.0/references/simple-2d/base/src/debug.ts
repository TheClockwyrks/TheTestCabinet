// Volute — the debugging and automation surface (specs/instrumentation.md).
//
// `initialize` returns it beside the state, as the pair `[state, debug]`, and the
// engine hands that same value back from `engine.debug`. Nothing is installed on
// the page: the engine handle is the whole route to it. It is inert during normal
// play — nothing below runs until something calls it.
//
// EVERY OPERATION IS A READING OR A POSE, and both are written in the shape of
// `update`, because the engine holds the state by value and nothing holds a
// writable one. A pose takes the current state and returns the next, and a caller
// drives it through `engine.apply((s) => debug.startLevel(s, 1))`; a reading takes the
// state and returns what it read, as `debug.snapshot(engine.state)`.
//
// A POSE ARRANGES THE HALL and never fabricates an outcome: it puts the game into
// a situation, and the game's own ticks — the real advance, the real strike, the
// real extraction — are what run from there. So a scenario driven from code
// behaves exactly like one played by hand, and every insertion, extraction,
// score, chain step, mark, cell, clear and ending a scenario reads comes from the
// ticks it ran, not from the call that set it up. A pose sounds nothing and plays
// no effect either: the cues and the effects a scenario sees come from the ticks
// run after it.
//
// NO POSE DECLINES. Each applies at the call whatever the screen, and an argument
// outside its range is clamped to the nearest legal value or normalized.

import {
  CELLS,
  CHAIN_RESET,
  CHARGE_IDS,
  LEVEL_COUNT,
  MACHINERY_KINDS,
  PATH_LENGTH,
  PRESSURE_MAX,
  PRESSURE_MIN,
  SCREENS,
  VOLUTE_DEBUG_VERSION,
} from "./constants";
import type { ChargeId, MachineryKind, ScreenName } from "./constants";
import type { DeepReadonly } from "ts-essentials";
import { pointAt } from "./channel";
import {
  clamp,
  freeze,
  resegment,
  spaced,
  thaw,
  type DraftCore,
} from "./draft";
import { newReport } from "./events";
import type { VoluteDebugApi, VoluteState } from "./game";
import { levelSpec, normalizeAngle, startLevel, toTitle } from "./level";
import {
  fire,
  grantTimedMachinery,
  inDanger,
  type TimedMachineryKind,
} from "./sim";
import { effectiveFeed } from "./train";

/** One core, as `poseTrain` takes it: `[s, charge, mark]`. */
export type PosedCore = readonly [number, string, string | null];

/** One core of the train, as `snapshot` reports it. */
export interface TrainSnapshot {
  s: number;
  /** The field point the arc position gives on the channel. */
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

/** The plain, JSON-serializable view `snapshot` returns. */
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
  muted: boolean;
  simTime: number;
  /** The charge posed for the next emission, and `null` while none stands. */
  nextEmitted: ChargeId | null;
}

/** A charge id, or the first of the five when the argument names none. */
function asCharge(value: unknown): ChargeId {
  return CHARGE_IDS.includes(value as ChargeId)
    ? (value as ChargeId)
    : CHARGE_IDS[0];
}

/** A charge id, or `null` when the argument names none. */
function asChargeOrNull(value: unknown): ChargeId | null {
  return CHARGE_IDS.includes(value as ChargeId) ? (value as ChargeId) : null;
}

/** A machinery kind, or `null` when the argument names none. */
function asMark(value: unknown): MachineryKind | null {
  return MACHINERY_KINDS.includes(value as MachineryKind)
    ? (value as MachineryKind)
    : null;
}

/** The three timed kinds a grant may name; anything else is taken as `choke`. */
const TIMED_KINDS: readonly TimedMachineryKind[] = [
  "choke",
  "backflow",
  "sightline",
];

/** A timed machinery kind, or `choke` when the argument names none. */
function asTimedKind(value: unknown): TimedMachineryKind {
  return TIMED_KINDS.includes(value as TimedMachineryKind)
    ? (value as TimedMachineryKind)
    : TIMED_KINDS[0];
}

/** A screen name, or `title` when the argument names none. */
function asScreen(value: unknown): ScreenName {
  return SCREENS.includes(value as ScreenName)
    ? (value as ScreenName)
    : SCREENS[0];
}

/** A finite number, or a stated fallback. */
function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** The whole snapshot, read straight off the state. */
export function snapshot(state: DeepReadonly<VoluteState>): VoluteSnapshot {
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
        : { kind: state.machinery.kind, remaining: state.machinery.remaining },
    emission: state.emission,
    feed: state.feed,
    muted: state.muted,
    simTime: state.simTime,
    nextEmitted: state.nextEmitted,
  };
}

/**
 * What re-opening the hall does to the picture drawn over it.
 *
 * The effects playing over the field — the flashes and the particle systems — are
 * presentation rather than state, so they live outside `VoluteState` and a pose
 * that returns a new state cannot reach them. `reset`, `start` and `startLevel`
 * each put a DIFFERENT hall on the field, though, and specs/instrumentation.md is
 * explicit that after a `reset` "anything else the build keeps across ticks is
 * derived from" the declared fields. A burst still playing over a hall that no
 * longer exists is derived from nothing, so those three operations drop it.
 */
export type ReopenHall = () => void;

/** The surface `initialize` returns beside the state it built. */
export function createDebugApi(reopen: ReopenHall): VoluteDebugApi {
  return {
    version: VOLUTE_DEBUG_VERSION,

    /**
     * Restore every declared field to its title-screen value.
     *
     * `muted` is deliberately untouched: muting is a player preference the
     * runtime owns, and a reset is not a reason to start making noise again. So
     * are `emission` and `feed`, which belong to the caller driving the game
     * rather than to the run being played, so a reset inside a posed scenario
     * leaves the hall held exactly as the scenario held it.
     */
    reset(state) {
      const draft = thaw(state);
      toTitle(draft);
      reopen();
      return freeze(draft);
    },

    /** A pure reading of the running game. It poses nothing. */
    snapshot,

    /**
     * Set the screen, and change nothing else: no level is opened, no channel is
     * seeded, no timer is started, and no interlude is set.
     */
    setScreen(state, name) {
      const draft = thaw(state);
      draft.screen = asScreen(name);
      return freeze(draft);
    },

    /**
     * Set the level in play, and change nothing else.
     *
     * The level's feed speed and its charge set follow the new value at once,
     * because both are read off `level` wherever they are wanted rather than
     * copied into the state when a level opens.
     */
    setLevel(state, level) {
      const draft = thaw(state);
      draft.level = clamp(Math.round(asNumber(level, 1)), 1, LEVEL_COUNT);
      return freeze(draft);
    },

    /** Set the run's score, clamped to at least `0`. */
    setScore(state, n) {
      const draft = thaw(state);
      draft.score = Math.max(0, Math.round(asNumber(n, draft.score)));
      return freeze(draft);
    },

    /**
     * Set the cells remaining, clamped to `0` through `CELLS`.
     *
     * It ends no run: `setCells(0)` leaves the screen exactly as it stands, and
     * the ending a spent last cell reaches comes from the ticks that follow.
     */
    setCells(state, n) {
      const draft = thaw(state);
      draft.cells = clamp(Math.round(asNumber(n, draft.cells)), 0, CELLS);
      return freeze(draft);
    },

    /**
     * Set the chain step, and restart the window that returns it to `1`, so the
     * posed step holds for `CHAIN_RESET` of play from the call.
     */
    setChainStep(state, k) {
      const draft = thaw(state);
      draft.chainStep = Math.max(1, Math.round(asNumber(k, draft.chainStep)));
      draft.chainTimer = CHAIN_RESET;
      return freeze(draft);
    },

    /** Open `level`, exactly as the interlude before it opens it. */
    startLevel(state, level) {
      const draft = thaw(state);
      startLevel(draft, clamp(Math.round(asNumber(level, 1)), 1, LEVEL_COUNT));
      reopen();
      return freeze(draft);
    },

    /**
     * Replace every core on the channel with the cores given.
     *
     * The train orders them by descending arc position whatever order the list
     * arrived in, two cores at the same position keeping the order the list gave
     * them. Segments follow from the spacing and every recoil hold is cleared, so
     * a posed train advances on the tick after the call.
     */
    poseTrain(state, cores) {
      const draft = thaw(state);
      const posed: DraftCore[] = [...(cores ?? [])].map((core) => ({
        charge: asCharge(core?.[1]),
        s: Math.min(PATH_LENGTH, asNumber(core?.[0], 0)),
        mark: asMark(core?.[2]),
        hold: 0,
      }));
      // A stable sort, which every engine's `Array.prototype.sort` is, so two
      // cores at one arc position keep the order the list gave them.
      posed.sort((a, b) => b.s - a.s);
      draft.cores = posed;
      resegment(draft);
      return freeze(draft);
    },

    /**
     * Remove every core from the channel and every projectile.
     *
     * Nothing extracts, nothing scores, and no cell is spent: the cores are
     * simply gone, with no removal and so no recoil, no pressure drop and no
     * grant.
     */
    clearTrain(state) {
      const draft = thaw(state);
      draft.cores = [];
      draft.projectiles = [];
      return freeze(draft);
    },

    /** Set the charge the injector holds loaded, and nothing else. */
    setLoaded(state, charge) {
      const draft = thaw(state);
      draft.loaded = asCharge(charge);
      return freeze(draft);
    },

    /** Set the charge the injector holds queued, and nothing else. */
    setQueued(state, charge) {
      const draft = thaw(state);
      draft.queued = asCharge(charge);
      return freeze(draft);
    },

    /**
     * Pose the charge of the next core the inlet emits, or clear the pose with
     * `null`.
     *
     * The next emission carries it in place of the draw, whatever the channel
     * holds, and consumes it; the inlet's gate, the quota and the mark cadence
     * are untouched, so a posed charge waits behind a held inlet.
     */
    setNextEmitted(state, charge) {
      const draft = thaw(state);
      draft.nextEmitted = asChargeOrNull(charge);
      return freeze(draft);
    },

    /**
     * Set the aim, normalized into `[0, 360)`, and do nothing else: no core is
     * released, the cooldown is untouched, and the loaded and queued cores stay
     * as they are.
     */
    setAim(state, angleDegrees) {
      const draft = thaw(state);
      draft.aim = normalizeAngle(asNumber(angleDegrees, draft.aim));
      return freeze(draft);
    },

    /**
     * Release the loaded core along the CURRENT aim, through the same path the
     * fire control takes.
     *
     * Any cooldown outstanding at the call is cleared first, so the call always
     * launches, and a call made while the injector holds no loaded core draws one
     * first. The aim is read and never written — `setAim` is what points the
     * injector. The flight, the strike, the insertion and any extraction the
     * insertion causes come from the ticks that follow, and so does the sound:
     * the cues this raises are dropped, because a pose sounds nothing.
     */
    fire(state) {
      const draft = thaw(state);
      draft.fireCooldown = 0;
      fire(draft, newReport());
      return freeze(draft);
    },

    /** Set the pressure, clamped to its range. */
    setPressure(state, value) {
      const draft = thaw(state);
      draft.pressure = clamp(
        asNumber(value, draft.pressure),
        PRESSURE_MIN,
        PRESSURE_MAX,
      );
      return freeze(draft);
    },

    /**
     * Set the cores the inlet has left to emit this level.
     *
     * The count of cores emitted this level is the level's quota less what
     * remains, so which of the following emissions carry a mark, and which kind
     * each mark is, follow the new value.
     */
    setQuotaRemaining(state, n) {
      const draft = thaw(state);
      draft.quotaRemaining = clamp(
        Math.round(asNumber(n, 0)),
        0,
        levelSpec(draft.level).quota,
      );
      return freeze(draft);
    },

    /**
     * Hold the inlet, and let it go again.
     *
     * Independent of the quota: a hall whose quota is untouched and whose inlet
     * is held emits nothing and is never cleared for an exhausted quota, which is
     * how a scenario poses a channel holding only the cores it is about.
     */
    setEmission(state, enabled) {
      const draft = thaw(state);
      draft.emission = enabled !== false;
      return freeze(draft);
    },

    /**
     * Hold the train where it stands, and let it advance again.
     *
     * Step 2 of the tick order alone: every other step runs unchanged, so a
     * projectile still flies and seats, a removal still recoils what is behind
     * it, pressure still moves, and the inlet still emits.
     */
    setFeed(state, enabled) {
      const draft = thaw(state);
      draft.feed = enabled !== false;
      return freeze(draft);
    },

    /**
     * Grant one of the three TIMED kinds exactly as extracting a run holding a
     * mark of that kind grants it: it becomes the active machinery at its full
     * duration, replacing whatever was active and restarting its timer.
     *
     * `bore` is not granted here. It removes cores and scores the moment it
     * resolves, and no pose decides an outcome, so a caller that wants a bore
     * poses a run carrying a `bore` mark and lets the ticks extract it.
     */
    grantMachinery(state, kind) {
      const draft = thaw(state);
      grantTimedMachinery(draft, asTimedKind(kind), newReport());
      return freeze(draft);
    },

    /** Pose the pause control. */
    pause(state) {
      const draft = thaw(state);
      draft.screen = "paused";
      return freeze(draft);
    },

    /** Pose the pause control again. */
    resume(state) {
      const draft = thaw(state);
      draft.screen = "playing";
      return freeze(draft);
    },
  };
}
